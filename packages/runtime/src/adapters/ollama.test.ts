import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatCompletionRequest } from "@paleonyx/shared-types";
import { OllamaAdapter } from "./ollama.js";

/**
 * Covers a real incompatibility, observed by calling Ollama directly:
 * qwen2.5-coder:7b answers a tool-enabled request with the call encoded
 * as JSON in `content` rather than in `tool_calls`. Whether Ollama
 * parses the call into the structured field depends on the model's chat
 * template, so both shapes have to be understood — reading only the
 * structured one silently ignores a model doing exactly what it was
 * asked, and looks like it declined.
 */

const TOOLS: ChatCompletionRequest["tools"] = [
  { name: "listFiles", description: "List files.", parameters: { type: "object", properties: {} } },
  {
    name: "readFile",
    description: "Read a file.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
];

function reply(message: Record<string, unknown>) {
  return new Response(JSON.stringify({ message, done: true }), { status: 200 });
}

function adapter() {
  return new OllamaAdapter({ modelId: "test", supportsToolCalling: true });
}

const REQUEST: ChatCompletionRequest = {
  messages: [{ role: "user", content: "go" }],
  tools: TOOLS,
};

afterEach(() => vi.unstubAllGlobals());

describe("structured tool calls", () => {
  it("reads Ollama's parsed tool_calls when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply({
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "readFile", arguments: { path: "a.ts" } } }],
        })
      )
    );

    const result = await adapter().chat(REQUEST);
    expect(result.toolCalls?.[0]?.name).toBe("readFile");
    expect(result.toolCalls?.[0]?.arguments).toEqual({ path: "a.ts" });
  });
});

describe("tool calls arriving as content", () => {
  it("recognises a call encoded as JSON in content", async () => {
    // The exact shape qwen2.5-coder:7b returned.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply({ role: "assistant", content: '{"name": "listFiles", "arguments": {}}' })
      )
    );

    const result = await adapter().chat(REQUEST);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0]?.name).toBe("listFiles");
    expect(result.finishReason).toBe("tool_calls");
  });

  it("recognises several calls in one array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply({
          role: "assistant",
          content: '[{"name":"listFiles","arguments":{}},{"name":"readFile","arguments":{"path":"a.ts"}}]',
        })
      )
    );

    const result = await adapter().chat(REQUEST);
    expect(result.toolCalls?.map((c) => c.name)).toEqual(["listFiles", "readFile"]);
  });

  it("tolerates a call with no arguments field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ role: "assistant", content: '{"name":"listFiles"}' }))
    );

    const result = await adapter().chat(REQUEST);
    expect(result.toolCalls?.[0]?.arguments).toEqual({});
  });
});

describe("what must not be mistaken for a tool call", () => {
  it("leaves the final JSON answer alone, because no tools are offered then", async () => {
    // run-task asks for the structured plan without tools. Without that
    // gate, a plan whose JSON happened to carry a `name` field could be
    // swallowed as a tool call instead of being parsed as the answer.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply({ role: "assistant", content: '{"name":"listFiles","arguments":{}}' })
      )
    );

    const result = await adapter().chat({ messages: [{ role: "user", content: "go" }] });
    expect(result.toolCalls).toBeUndefined();
    expect(result.finishReason).toBe("stop");
  });

  it("ignores JSON that names no offered tool", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ role: "assistant", content: '{"name":"rmRf","arguments":{}}' }))
    );

    const result = await adapter().chat(REQUEST);
    expect(result.toolCalls).toBeUndefined();
  });

  it("ignores an ordinary prose answer that mentions a tool", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply({ role: "assistant", content: "You could call listFiles to see what is here." })
      )
    );

    const result = await adapter().chat(REQUEST);
    expect(result.toolCalls).toBeUndefined();
    expect(result.content).toContain("listFiles");
  });

  it("ignores a fenced json block, which is the answer format", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply({ role: "assistant", content: '```json\n{"summary":"x"}\n```' })
      )
    );

    const result = await adapter().chat(REQUEST);
    expect(result.toolCalls).toBeUndefined();
  });

  it("ignores malformed JSON rather than guessing at it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ role: "assistant", content: '{"name":"listFiles"' }))
    );

    const result = await adapter().chat(REQUEST);
    expect(result.toolCalls).toBeUndefined();
  });
});
