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

  it("refuses a command outside the allowlist and stops", async () => {
    // Stopping matters: left running, a model could try variations until
    // one happened to match.
    const runCommand = vi.fn();
    const provider = new ScriptedProvider([
      {
        content: "",
        toolCalls: [
          { id: "1", name: "runCommand", arguments: { program: "rm", args: ["-rf", "."] } },
        ],
        finishReason: "tool_calls",
      },
    ]);

    const outcome = await run(provider, { runCommand });
    expect(runCommand).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("blocked");
    if (outcome.kind === "blocked") {
      expect(outcome.reason).toBe("permission-denied");
      expect(outcome.message).toContain("rm -rf .");
    }
  });

  it("refuses commands when the permission mode forbids them", async () => {
    const runCommand = vi.fn();
    const provider = new ScriptedProvider([wantsCargoTest]);

    const outcome = await run(provider, { runCommand, permissionMode: "auto-apply" });
    expect(runCommand).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("blocked");
  });

  it("refuses commands when the host cannot run processes at all", async () => {
    // No runner supplied — the web harness. Distinct from a permission
    // mode that forbids it, and it must not silently appear to succeed.
    const provider = new ScriptedProvider([wantsCargoTest]);
    const outcome = await run(provider, { permissionMode: "can-run-commands" });
    expect(outcome.kind).toBe("blocked");
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
    expect(outcome.kind).toBe("blocked");
  });

  it("does not offer the command tool when it cannot be used", async () => {
    const provider = new ScriptedProvider([{ content: "ok", finishReason: "stop" }]);
    const chatSpy = vi.spyOn(provider, "chat");
    await run(provider, { permissionMode: "suggest-only" });

    const tools = chatSpy.mock.calls[0]?.[0].tools ?? [];
    expect(tools.map((t) => t.name)).toEqual(["readFile"]);
  });
});
