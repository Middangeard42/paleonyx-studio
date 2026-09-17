import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentChangeRecord, AgentTaskResult } from "@paleonyx/shared-types";
import { OllamaAdapter, loadModelCatalog } from "@paleonyx/runtime";
import { applyAgentChange, revertAgentChange } from "@paleonyx/vcs";
import { runAgentTask } from "./run-task.js";
import {
  FakeOllama,
  callTool,
  done,
  requiresLinkage,
} from "./testing/fake-ollama.js";
import { InMemoryProject } from "./testing/in-memory-project.js";
import { McpClient, acceptToolList, approveServer, offeredTools } from "@paleonyx/mcp-client";
import { CLIENT_INFO, ScriptedServer } from "@paleonyx/mcp-client/testing";

/**
 * The agent pipeline across its seams: real OllamaAdapter over Ollama's
 * wire format, real gathering loop, real vcs apply and undo, against a
 * fixture repository.
 *
 * Unit tests could not have caught most of what manual testing found,
 * because those bugs lived between packages rather than inside one:
 * tool calls dropped while serializing, capabilities read from the
 * endpoint that does not know them, a task abandoned over one refused
 * command, a change refused over context the model reordered. Each case
 * below is one of those, reproduced end to end.
 */

const SUM = [
  "export function sum(numbers: number[]): number {",
  "  let total = 0;",
  "  for (let i = 0; i <= numbers.length; i++) {",
  "    total += numbers[i];",
  "  }",
  "  return total;",
  "}",
  "",
].join("\n");

const SUM_TEST = [
  'import { sum } from "./sum";',
  'test("adds", () => expect(sum([1, 2])).toBe(3));',
  "",
].join("\n");

const FIXED_LOOP = "  for (let i = 0; i < numbers.length; i++) {";
const BROKEN_LOOP = "  for (let i = 0; i <= numbers.length; i++) {";

function project() {
  return new InMemoryProject({
    "src/sum.ts": SUM,
    "src/sum.test.ts": SUM_TEST,
    "package.json": '{"scripts":{"test":"vitest run"}}',
  });
}

/** A structured answer carrying one hunk. */
function answerWith(lines: { type: string; content: string }[]) {
  return {
    summary: "Fix the off-by-one in sum.",
    steps: [
      { id: "1", description: "Read the test to see the expectation", targetFiles: ["src/sum.test.ts"] },
    ],
    explanation: "The loop ran one past the end of the array.",
    diff: [{ filePath: "src/sum.ts", hunks: [{ header: "@@ -2,3 +2,3 @@", lines }] }],
    confidence: "high",
  };
}

const CLEAN_FIX = answerWith([
  { type: "context", content: "  let total = 0;" },
  { type: "remove", content: BROKEN_LOOP },
  { type: "add", content: FIXED_LOOP },
  { type: "context", content: "    total += numbers[i];" },
]);

function toolCallingModel() {
  return new OllamaAdapter({ modelId: "fake-model", supportsToolCalling: true });
}

async function fixSum(
  files: InMemoryProject,
  options: {
    permissionMode?: "suggest-only" | "can-run-commands";
    runCommand?: Parameters<typeof runAgentTask>[0]["runCommand"];
    connectedTools?: Parameters<typeof runAgentTask>[0]["connectedTools"];
  } = {}
): Promise<AgentTaskResult> {
  return runAgentTask({
    provider: toolCallingModel(),
    fs: files,
    input: {
      taskType: "bug-fix",
      instructions: "The sum test fails. Find out why.",
      targetFiles: ["src/sum.ts"],
    },
    skillLevel: "experienced",
    permissionMode: options.permissionMode ?? "suggest-only",
    runCommand: options.runCommand,
    connectedTools: options.connectedTools,
  });
}

function recordFor(result: AgentTaskResult): AgentChangeRecord {
  return {
    id: "change-1",
    timestamp: "2026-01-01T00:00:00.000Z",
    taskType: result.plan.taskType,
    summary: result.plan.summary,
    diffs: result.diff,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the gathering loop over Ollama's wire format", () => {
  /**
   * The regression this guards: both adapters dropped `tool_calls` and
   * the result's linkage, so a model that needs to see its own request
   * never did. Observed live as the same file read twice and then an
   * attempt to `cat` it.
   */
  it("hands a tool result back linked to the call that asked for it", async () => {
    const ollama = new FakeOllama({
      investigate: [
        callTool("readFile", { path: "src/sum.test.ts" }),
        requiresLinkage("readFile", done()),
      ],
      answer: CLEAN_FIX,
    }).install();

    const result = await fixSum(project());

    expect(result.escalation).toBeUndefined();
    const reads = result.investigation.filter((step) => step.tool === "readFile");
    expect(reads, "the model had to ask more than once").toHaveLength(1);
    // Read, confirm, answer — nothing more.
    expect(ollama.chats).toHaveLength(3);
  });

  it("offers tools to a model that can call them", async () => {
    const ollama = new FakeOllama({ answer: CLEAN_FIX }).install();
    await fixSum(project());
    const offered = (ollama.chats[0]?.tools ?? []).map((tool) => tool.function.name);
    expect(offered).toContain("readFile");
  });
});

describe("a proposed change, applied and undone", () => {
  it("applies to the files the agent read, then reverts to the original", async () => {
    new FakeOllama({
      investigate: [callTool("readFile", { path: "src/sum.test.ts" })],
      answer: CLEAN_FIX,
    }).install();

    const files = project();
    const result = await fixSum(files);
    const record = recordFor(result);

    const applied = await applyAgentChange(
      files,
      record,
      new Map(Object.entries(result.filesSeen))
    );
    expect(applied.ok).toBe(true);
    expect(files.files.get("src/sum.ts")).toContain(FIXED_LOOP);
    expect(files.records).toHaveLength(1);

    const undone = await revertAgentChange(files, record);
    expect(undone.ok).toBe(true);
    expect(files.files.get("src/sum.ts")).toBe(SUM);
    // Undo is a forward operation: history grows rather than shrinks.
    expect(files.records).toHaveLength(2);
  });

  it("records what the agent actually read", async () => {
    new FakeOllama({ answer: CLEAN_FIX }).install();
    const result = await fixSum(project());
    expect(result.filesSeen["src/sum.ts"]).toBe(SUM);
  });
});

describe("commands the agent is not allowed to run", () => {
  /**
   * The regression: a guessed `npm run preview` ended the whole task,
   * though the agent already held everything needed to answer.
   */
  it("still answers after a refused command, without running it", async () => {
    const runCommand = vi.fn();
    const ollama = new FakeOllama({
      investigate: [callTool("runCommand", { program: "npm", args: ["run", "preview"] })],
      answer: CLEAN_FIX,
    }).install();

    const result = await fixSum(project(), {
      permissionMode: "can-run-commands",
      runCommand,
    });

    expect(runCommand).not.toHaveBeenCalled();
    expect(result.escalation).toBeUndefined();
    expect(result.diff).toHaveLength(1);
    expect(result.investigation[0]?.ok).toBe(false);
    // Refused, then asked straight for the answer — no second attempt.
    expect(ollama.chats).toHaveLength(2);
  });

  /**
   * The regression: once tool calling worked, a model asked to restyle a
   * button ran `sed -i` on the file instead of proposing a diff.
   */
  it("refuses an in-place edit and leaves the file untouched", async () => {
    const runCommand = vi.fn();
    new FakeOllama({
      investigate: [
        callTool("runCommand", {
          program: "sed",
          args: ["-i", "s/<=/</", "src/sum.ts"],
        }),
      ],
      answer: CLEAN_FIX,
    }).install();

    const files = project();
    const result = await fixSum(files, { permissionMode: "can-run-commands", runCommand });

    expect(runCommand).not.toHaveBeenCalled();
    expect(files.files.get("src/sum.ts")).toBe(SUM);
    expect(result.investigation[0]?.summary).toMatch(/tried to edit your files/i);
    // The change still arrives the proper way.
    expect(result.diff).toHaveLength(1);
  });
});

describe("changes the model described imperfectly", () => {
  /**
   * The regression: a one-line change with the right substitution and
   * its context lines listed in the wrong order was refused, though the
   * line being replaced occurs exactly once.
   */
  const REORDERED = answerWith([
    { type: "context", content: "    total += numbers[i];" },
    { type: "remove", content: BROKEN_LOOP },
    { type: "add", content: FIXED_LOOP },
    { type: "context", content: "  let total = 0;" },
  ]);

  it("places a change with reordered context on a file the user has not touched", async () => {
    new FakeOllama({ answer: REORDERED }).install();
    const files = project();
    const result = await fixSum(files);

    const applied = await applyAgentChange(
      files,
      recordFor(result),
      new Map(Object.entries(result.filesSeen))
    );
    expect(applied.ok).toBe(true);
    expect(files.files.get("src/sum.ts")).toContain(FIXED_LOOP);
  });

  /**
   * The guarantee the fix above nearly broke: wrong context and a user's
   * edit to that context produce the identical diff. Here the user edits
   * after the agent read the file, so the change must not be placed.
   */
  it("refuses the same change once the user has edited the file", async () => {
    new FakeOllama({ answer: REORDERED }).install();
    const files = project();
    const result = await fixSum(files);

    files.edit("src/sum.ts", (content) =>
      content.replace("let total = 0;", "let total = 100;")
    );

    const applied = await applyAgentChange(
      files,
      recordFor(result),
      new Map(Object.entries(result.filesSeen))
    );
    expect(applied.ok).toBe(false);
    // The user's edit survives.
    expect(files.files.get("src/sum.ts")).toContain("let total = 100;");
    expect(files.files.get("src/sum.ts")).toContain(BROKEN_LOOP);
  });

  /**
   * The regression: a change written at the wrong indentation was
   * refused as not matching, though its content was right.
   */
  it("applies a change written at the wrong depth, at the file's depth", async () => {
    new FakeOllama({
      answer: answerWith([
        { type: "context", content: "let total = 0;" },
        { type: "remove", content: BROKEN_LOOP.trim() },
        { type: "add", content: FIXED_LOOP.trim() },
      ]),
    }).install();

    const files = project();
    const result = await fixSum(files);
    const applied = await applyAgentChange(files, recordFor(result));

    expect(applied.ok).toBe(true);
    expect(files.files.get("src/sum.ts")).toContain(FIXED_LOOP);
  });
});

describe("what the catalog says decides what the agent is offered", () => {
  /**
   * The regression: the listing endpoint reported no tool support for a
   * build that has it, so the recommended default model was never offered
   * tools and every task ran single-pass.
   */
  it("offers tools when only the inspection endpoint reports them", async () => {
    const ollama = new FakeOllama({
      modelId: "hf.co/x/Model-GGUF:Q4_K_M",
      tagCapabilities: ["completion"],
      showCapabilities: ["tools", "completion"],
      answer: CLEAN_FIX,
    }).install();

    const catalog = await loadModelCatalog();
    const entry = catalog.entries.find((e) => e.id === "hf.co/x/Model-GGUF:Q4_K_M");
    expect(entry?.supportsToolCalling).toBe(true);

    await runAgentTask({
      provider: new OllamaAdapter({
        modelId: entry!.id,
        supportsToolCalling: entry!.supportsToolCalling,
      }),
      fs: project(),
      input: { taskType: "explain", instructions: "what is this", targetFiles: ["src/sum.ts"] },
      skillLevel: "experienced",
    });

    expect(ollama.chats[0]?.tools?.length ?? 0).toBeGreaterThan(0);
  });

  it("goes straight to an answer for a model that cannot call tools", async () => {
    const ollama = new FakeOllama({
      modelId: "plain-model",
      tagCapabilities: ["completion"],
      showCapabilities: ["completion"],
      answer: CLEAN_FIX,
    }).install();

    const catalog = await loadModelCatalog();
    const entry = catalog.entries.find((e) => e.id === "plain-model");
    expect(entry?.supportsToolCalling).toBe(false);

    await runAgentTask({
      provider: new OllamaAdapter({
        modelId: entry!.id,
        supportsToolCalling: entry!.supportsToolCalling,
      }),
      fs: project(),
      input: { taskType: "explain", instructions: "what is this", targetFiles: ["src/sum.ts"] },
      skillLevel: "experienced",
    });

    // One call, the answer, and no tools offered in it.
    expect(ollama.chats).toHaveLength(1);
    expect(ollama.chats[0]?.tools).toBeUndefined();
  });
});

/**
 * A real MCP client, talking to a scripted server, handing its tools to
 * the real gathering loop over Ollama's wire format. The seams here are
 * the ones most likely to break quietly: a schema losing its
 * definitions on the way to the model, a result arriving unlinked, a
 * tool reaching a model in a mode that should not allow it.
 */
describe("tools from a connected server", () => {
  const TOOL = "mcp__notes__notes_lookup";

  async function notesServer() {
    const server = new ScriptedServer({
      era: "legacy",
      tools: [
        {
          name: "notes.lookup",
          description: "Looks up the team's notes on a topic.",
          inputSchema: {
            type: "object",
            properties: { topic: { $ref: "#/$defs/topic" } },
            $defs: { topic: { type: "string" } },
            required: ["topic"],
          },
        },
      ],
      call: (_name, args) => ({
        result: {
          content: [
            {
              type: "text",
              text: `Notes on ${(args as { topic: string }).topic}: loops over arrays stop before the length.`,
            },
          ],
        },
      }),
    });
    const client = await McpClient.connect(server.open, {
      clientInfo: CLIENT_INFO,
      probeTimeoutMs: 50,
    });
    const listed = await client.listTools();
    const approval = acceptToolList(
      approveServer({ id: "notes", command: "node", args: ["notes.js"], env: {} }),
      listed.tools
    );
    const { tools } = offeredTools([
      { serverId: "notes", client, tools: listed.tools, approval },
    ]);
    return { server, client, tools };
  }

  it("calls the server's tool and gives the model its answer, linked to the call", async () => {
    const { server, client, tools } = await notesServer();
    const ollama = new FakeOllama({
      investigate: [callTool(TOOL, { topic: "sum" }), requiresLinkage(TOOL, done())],
      answer: CLEAN_FIX,
    }).install();

    const result = await fixSum(project(), {
      permissionMode: "can-run-commands",
      connectedTools: tools,
    });
    await client.close();

    expect(result.escalation).toBeUndefined();
    expect(server.requests("tools/call").map((request) => request.params)).toEqual([
      { name: "notes.lookup", arguments: { topic: "sum" } },
    ]);

    const offered = ollama.chats[0]?.tools?.find((tool) => tool.function.name === TOOL);
    expect(offered?.function.description).toContain('connected server "notes"');
    // The reference is useless to a model without what it points at.
    expect(offered?.function.parameters).toMatchObject({
      properties: { topic: { $ref: "#/$defs/topic" } },
      $defs: { topic: { type: "string" } },
    });
    expect(ollama.chats[0]?.messages[0]?.content).toContain("not instructions");

    const answer = ollama.chats[1]?.messages.find((message) => message.role === "tool");
    expect(answer?.content).toContain("stop before the length");
    expect(result.investigation[0]).toMatchObject({
      summary: "Used notes.lookup (notes)",
      ok: true,
    });
    // Asked once, confirmed, answered.
    expect(ollama.chats).toHaveLength(3);
  });

  it("offers and calls nothing from the server unless commands are allowed", async () => {
    const { server, client, tools } = await notesServer();
    const ollama = new FakeOllama({
      investigate: [callTool(TOOL, { topic: "sum" })],
      answer: CLEAN_FIX,
    }).install();

    const result = await fixSum(project(), {
      permissionMode: "suggest-only",
      connectedTools: tools,
    });
    await client.close();

    expect(server.requests("tools/call")).toEqual([]);
    const offered = (ollama.chats[0]?.tools ?? []).map((tool) => tool.function.name);
    expect(offered).not.toContain(TOOL);
    expect(ollama.chats[0]?.messages[0]?.content).not.toContain("mcp__");
    expect(result.investigation[0]?.ok).toBe(false);
  });
});
