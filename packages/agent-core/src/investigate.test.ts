import { describe, expect, it, vi } from "vitest";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  FileSystemReader,
  ModelInfo,
  PermissionMode,
  ProjectFile,
} from "@paleonyx/shared-types";
import type { ChatModelProvider } from "@paleonyx/runtime";
import { investigate } from "./investigate.js";
import { BudgetTracker, DEFAULT_BUDGET_LIMITS } from "./budget.js";
import type { CommandResult } from "./tools/run-command.js";

class FakeFs implements FileSystemReader {
  async listFiles(): Promise<ProjectFile[]> {
    return [{ path: "a.ts" }];
  }
  async readFile(path: string): Promise<string> {
    if (path === "missing.ts") throw new Error("no such file");
    return "const x = 1;\n";
  }
}

/** Replays a scripted sequence of model responses, one per call. */
class ScriptedProvider implements ChatModelProvider {
  readonly model: ModelInfo;
  calls = 0;

  constructor(
    private readonly script: ChatCompletionResult[],
    supportsToolCalling = true
  ) {
    this.model = {
      id: "scripted",
      label: "Scripted",
      provider: "test",
      capabilities: {
        contextWindow: 8192,
        supportsToolCalling,
        supportsStreaming: false,
        supportsVision: false,
        isLocal: true,
      },
    };
  }

  async chat(_request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const next = this.script[this.calls] ?? { content: "done", finishReason: "stop" as const };
    this.calls += 1;
    return next;
  }

  async *chatStream() {
    yield { delta: "", done: true };
  }
}

function commandResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    stdout: "ok",
    stderr: "",
    exitCode: 0,
    timedOut: false,
    truncated: false,
    durationMs: 5,
    ...overrides,
  };
}

function run(
  provider: ChatModelProvider,
  options: {
    permissionMode?: PermissionMode;
    runCommand?: (program: string, args: string[]) => Promise<CommandResult>;
    allowlist?: readonly string[];
  } = {}
) {
  return investigate({
    provider,
    fs: new FakeFs(),
    messages: [{ role: "user", content: "go" }],
    budget: new BudgetTracker(DEFAULT_BUDGET_LIMITS),
    permissionMode: options.permissionMode ?? "can-run-commands",
    commandAllowlist: options.allowlist ?? ["cargo test"],
    runCommand: options.runCommand,
  });
}

describe("capability gating", () => {
  it("skips the loop entirely for providers without tool calling", async () => {
    // Declared capability, not discovered by watching a call fail
    // (CLAUDE.md §4).
    const provider = new ScriptedProvider([], false);
    const outcome = await run(provider);
    expect(outcome.kind).toBe("ready");
    expect(provider.calls).toBe(0);
  });
});

describe("gathering information", () => {
  it("reads a file the agent asks for, then finishes", async () => {
    const provider = new ScriptedProvider([
      {
        content: "",
        toolCalls: [{ id: "1", name: "readFile", arguments: { path: "a.ts" } }],
        finishReason: "tool_calls",
      },
      { content: "I have what I need", finishReason: "stop" },
    ]);

    const outcome = await run(provider);
    expect(outcome.kind).toBe("ready");
    expect(outcome.steps).toHaveLength(1);
    expect(outcome.steps[0]?.ok).toBe(true);
    expect(outcome.steps[0]?.detail).toContain("const x = 1");
  });

  it("records a failed read without stopping the loop", async () => {
    // A missing file is something the agent can recover from by trying
    // another path; refusing to continue would be worse than useless.
    const provider = new ScriptedProvider([
      {
        content: "",
        toolCalls: [{ id: "1", name: "readFile", arguments: { path: "missing.ts" } }],
        finishReason: "tool_calls",
      },
      { content: "moving on", finishReason: "stop" },
    ]);

    const outcome = await run(provider);
    expect(outcome.kind).toBe("ready");
    expect(outcome.steps[0]?.ok).toBe(false);
  });

  it("stops at the iteration cap rather than looping forever", async () => {
    // A model that only ever asks for more must not run indefinitely.
    const alwaysCalls: ChatCompletionResult = {
      content: "",
      toolCalls: [{ id: "1", name: "readFile", arguments: { path: "a.ts" } }],
      finishReason: "tool_calls",
    };
    const provider = new ScriptedProvider(Array(50).fill(alwaysCalls));

    const outcome = await investigate({
      provider,
      fs: new FakeFs(),
      messages: [{ role: "user", content: "go" }],
      budget: new BudgetTracker(DEFAULT_BUDGET_LIMITS),
      permissionMode: "suggest-only",
      commandAllowlist: [],
      maxIterations: 3,
    });

    expect(outcome.kind).toBe("ready");
    expect(outcome.steps).toHaveLength(3);
  });

  it("stops when the budget runs out", async () => {
    const alwaysCalls: ChatCompletionResult = {
      content: "",
      toolCalls: [{ id: "1", name: "readFile", arguments: { path: "a.ts" } }],
      finishReason: "tool_calls",
    };
    const outcome = await investigate({
      provider: new ScriptedProvider(Array(50).fill(alwaysCalls)),
      fs: new FakeFs(),
      messages: [{ role: "user", content: "go" }],
      budget: new BudgetTracker({ maxToolCalls: 2, maxTokens: 1000 }),
      permissionMode: "suggest-only",
      commandAllowlist: [],
      maxIterations: 20,
    });

    expect(outcome.kind).toBe("blocked");
    if (outcome.kind === "blocked") expect(outcome.reason).toBe("budget-exhausted");
  });
});

describe("running commands", () => {
  const wantsCargoTest: ChatCompletionResult = {
    content: "",
    toolCalls: [
      { id: "1", name: "runCommand", arguments: { program: "cargo", args: ["test"] } },
    ],
    finishReason: "tool_calls",
  };

  it("runs an allowlisted command and feeds the output back", async () => {
    const runCommand = vi.fn().mockResolvedValue(commandResult({ stdout: "3 passed" }));
    const provider = new ScriptedProvider([
      wantsCargoTest,
      { content: "tests pass", finishReason: "stop" },
    ]);

    const outcome = await run(provider, { runCommand });
    expect(runCommand).toHaveBeenCalledWith("cargo", ["test"]);
    expect(outcome.kind).toBe("ready");
    expect(outcome.steps[0]?.detail).toContain("3 passed");
  });

  it("treats a failing test suite as information, not a tool failure", async () => {
    // The whole reason for running tests is to read the failure.
    const runCommand = vi
      .fn()
      .mockResolvedValue(commandResult({ exitCode: 1, stdout: "1 failed" }));
    const provider = new ScriptedProvider([
      wantsCargoTest,
      { content: "found it", finishReason: "stop" },
    ]);

    const outcome = await run(provider, { runCommand });
    expect(outcome.kind).toBe("ready");
    expect(outcome.steps[0]?.ok).toBe(true);
    expect(outcome.steps[0]?.detail).toContain("exited with code 1");
  });

  it("refuses a command outside the allowlist and runs nothing further", async () => {
    // The guard is against probing: left running, a model could try
    // variations until one happened to match. What must hold is that
    // the command never runs and no second one is attempted.
    const runCommand = vi.fn();
    const provider = new ScriptedProvider([
      {
        content: "",
        toolCalls: [
          { id: "1", name: "runCommand", arguments: { program: "rm", args: ["-rf", "."] } },
        ],
        finishReason: "tool_calls",
      },
      {
        content: "",
        toolCalls: [
          { id: "2", name: "runCommand", arguments: { program: "rm", args: ["-rf", "/"] } },
        ],
        finishReason: "tool_calls",
      },
    ]);

    const outcome = await run(provider, { runCommand });
    expect(runCommand).not.toHaveBeenCalled();
    // Gathering ends here, so the second attempt is never even asked for.
    expect(outcome.steps).toHaveLength(1);
    expect(outcome.steps[0]?.ok).toBe(false);
    expect(outcome.steps[0]?.summary).toContain("rm -rf .");
  });

  /**
   * A refusal ends gathering without abandoning the task.
   *
   * Observed: the agent read the file it needed, guessed at `npm run
   * preview`, and the whole run died on the guess — despite already
   * holding everything required to answer.
   */
  it("still answers from what it gathered before the refusal", async () => {
    const runCommand = vi.fn();
    const provider = new ScriptedProvider([
      {
        content: "",
        toolCalls: [{ id: "1", name: "readFile", arguments: { path: "index.html" } }],
        finishReason: "tool_calls",
      },
      {
        content: "",
        toolCalls: [
          { id: "2", name: "runCommand", arguments: { program: "npm", args: ["run", "preview"] } },
        ],
        finishReason: "tool_calls",
      },
    ]);

    const outcome = await run(provider, { runCommand });
    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") return;
    // The read survives, and the model is told to answer with it.
    expect(outcome.steps[0]?.ok).toBe(true);
    expect(outcome.steps[1]?.ok).toBe(false);
    expect(outcome.messages.at(-1)?.content).toMatch(/no further commands will be run/i);
  });

  it("refuses commands when the permission mode forbids them", async () => {
    const runCommand = vi.fn();
    const provider = new ScriptedProvider([wantsCargoTest]);

    const outcome = await run(provider, { runCommand, permissionMode: "auto-apply" });
    expect(runCommand).not.toHaveBeenCalled();
    // Gathering ends; the refusal is recorded and the task still answers.
    expect(outcome.steps.at(-1)?.ok).toBe(false);
    expect(outcome.kind).toBe("ready");
  });

  it("refuses commands when the host cannot run processes at all", async () => {
    // No runner supplied — the web harness. Distinct from a permission
    // mode that forbids it, and it must not silently appear to succeed.
    const provider = new ScriptedProvider([wantsCargoTest]);
    const outcome = await run(provider, { permissionMode: "can-run-commands" });
    expect(outcome.steps.at(-1)?.ok).toBe(false);
    expect(outcome.steps.at(-1)?.summary).toMatch(/not enabled/i);
    expect(outcome.kind).toBe("ready");
  });

  it("rejects a malformed command request instead of guessing", async () => {
    const runCommand = vi.fn();
    const provider = new ScriptedProvider([
      {
        content: "",
        toolCalls: [
          { id: "1", name: "runCommand", arguments: { program: "cargo", args: [1, 2] } },
        ],
        finishReason: "tool_calls",
      },
    ]);

    const outcome = await run(provider, { runCommand });
    expect(runCommand).not.toHaveBeenCalled();
    expect(outcome.steps.at(-1)?.ok).toBe(false);
    expect(outcome.kind).toBe("ready");
  });

  it("does not offer the command tool when it cannot be used", async () => {
    const provider = new ScriptedProvider([{ content: "ok", finishReason: "stop" }]);
    const chatSpy = vi.spyOn(provider, "chat");
    await run(provider, { permissionMode: "suggest-only" });

    const tools = chatSpy.mock.calls[0]?.[0].tools ?? [];
    // Asserts the absence of the command tool rather than an exact list,
    // so adding a read-only tool later cannot fail a test about permissions.
    expect(tools.map((t) => t.name)).not.toContain("runCommand");
  });
});

describe("discovering what exists", () => {
  it("lists the project's files when asked", async () => {
    // Without this the agent can only read paths it already knows, so
    // "is there a test suite?" can only be answered by guessing names.
    const provider = new ScriptedProvider([
      {
        content: "",
        toolCalls: [{ id: "1", name: "listFiles", arguments: {} }],
        finishReason: "tool_calls",
      },
      { content: "no tests here", finishReason: "stop" },
    ]);

    const outcome = await run(provider);
    expect(outcome.kind).toBe("ready");
    expect(outcome.steps[0]?.ok).toBe(true);
    expect(outcome.steps[0]?.detail).toContain("a.ts");
  });

  it("offers listFiles even without command permission", async () => {
    // Seeing what exists is a read, so it is available wherever reading
    // is — it does not depend on the command-running mode.
    const provider = new ScriptedProvider([{ content: "ok", finishReason: "stop" }]);
    const chatSpy = vi.spyOn(provider, "chat");
    await run(provider, { permissionMode: "read-only" });

    const tools = chatSpy.mock.calls[0]?.[0].tools ?? [];
    expect(tools.map((t) => t.name)).toContain("listFiles");
  });
});
