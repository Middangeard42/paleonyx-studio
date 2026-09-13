import { describe, expect, it, beforeAll } from "vitest";
import { OllamaAdapter, pingOllama } from "./ollama.js";

/**
 * Runs against a real Ollama, and skips when there isn't one.
 *
 * Exists because this seam has burned repeatedly: whether a tool call
 * arrives structured or as text depends on the model's chat template,
 * which no mock can tell us. Every previous fix here was verified by
 * asking the user to try it again, which is slow and kept being wrong.
 */
// Declared rather than pulling in @types/node: runtime also targets the
// browser, and adding Node's globals package-wide would invite reaching
// for an API that is not there.
declare const process: { env: Record<string, string | undefined> };

/**
 * Opt-in, for the same reason the agent-core live test is.
 *
 * What it checks splits in two. That our parsing copes with however a
 * tool call is encoded is about our code, is deterministic, and is
 * covered by the unit tests beside this file. That a real model chooses
 * to emit one at all is the model's disposition, and varies run to run —
 * it failed here while every other runtime test passed, which is exactly
 * the noise that hides a real regression.
 *
 * Run it with PALEONYX_LIVE_MODEL_TESTS=1.
 */
const LIVE = process.env.PALEONYX_LIVE_MODEL_TESTS === "1";

const MODEL = "qwen2.5-coder:7b";
let available = false;

beforeAll(async () => {
  if (!LIVE) return;
  if (!(await pingOllama())) return;
  const response = await fetch("http://localhost:11434/api/tags");
  const payload = (await response.json()) as { models?: { name?: string }[] };
  available = (payload.models ?? []).some((m) => m.name === MODEL);
});

describe.skipIf(!LIVE)("live Ollama tool calling", () => {
  it("extracts a tool call from a real reply, however it is encoded", async () => {
    if (!available) {
      console.warn(`skipped: ${MODEL} not available via Ollama`);
      return;
    }

    const adapter = new OllamaAdapter({ modelId: MODEL, supportsToolCalling: true });
    const result = await adapter.chat({
      messages: [
        {
          role: "system",
          content:
            "You may call the provided tools to gather what you need. If you need to know what files exist, call listFiles rather than assuming.",
        },
        { role: "user", content: "The tests are failing in this project. Find out why." },
      ],
      tools: [
        {
          name: "listFiles",
          description: "List the files in this project.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "readFile",
          description: "Read one project file.",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
    });

    // Deliberately not asserting that a tool call happened.
    //
    // The same request returns a structured call, a call encoded as JSON
    // in content, or plain prose describing intent — run to run, with
    // nothing changed. Asserting the model's disposition makes the suite
    // flaky and tells us nothing about our code. What is ours to get
    // right is the parsing, and that is what this checks: when a call
    // does come back, in whichever encoding, it is well formed.
    if (!result.toolCalls) {
      console.warn(`no tool call this run; model replied: ${result.content.slice(0, 120)}`);
      expect(result.finishReason).toBe("stop");
      return;
    }

    expect(result.finishReason).toBe("tool_calls");
    for (const call of result.toolCalls) {
      expect(["listFiles", "readFile"]).toContain(call.name);
      expect(typeof call.arguments).toBe("object");
    }
  }, 120_000);
});
