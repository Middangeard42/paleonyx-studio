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
const MODEL = process.env.PALEONYX_IT_MODEL ?? "qwen2.5-coder:7b";
let available = false;

beforeAll(async () => {
  if (!(await pingOllama())) return;
  const response = await fetch("http://localhost:11434/api/tags");
  const payload = (await response.json()) as { models?: { name?: string }[] };
  available = (payload.models ?? []).some((m) => m.name === MODEL);
});

describe("live Ollama tool calling", () => {
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

    expect(result.toolCalls, `model replied: ${result.content}`).toBeDefined();
    expect(result.finishReason).toBe("tool_calls");
  }, 120_000);
});
