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

/**
 * The link between a tool call and its result.
 *
 * This was dropped, and the loop behaved as you would expect something
 * to behave when its requests vanish: it read index.html, read it
 * again, then tried to `cat` the file. The tool result was arriving with
 * no assistant turn claiming to have asked for it.
 */
describe("tool calls and their results reach the wire intact", () => {
  function capture() {
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({ message: { role: "assistant", content: "ok" }, done: true })
        );
      })
    );
    return sent;
  }

  const conversation = [
    { role: "user" as const, content: "why is it broken" },
    {
      role: "assistant" as const,
      content: "",
      toolCalls: [
        { id: "call_1", name: "readFile", arguments: { path: "index.html" } },
      ],
    },
    {
      role: "tool" as const,
      content: "<html>…</html>",
      toolCallId: "call_1",
      toolName: "readFile",
    },
  ];

  it("keeps tool_calls on the assistant turn", async () => {
    const sent = capture();
    await new OllamaAdapter({ modelId: "m" }).chat({ messages: conversation });

    const messages = sent[0]!.messages as Record<string, unknown>[];
    const assistant = messages[1]!;
    expect(assistant.tool_calls).toEqual([
      { function: { name: "readFile", arguments: { path: "index.html" } } },
    ]);
  });

  it("names the tool on the result so Ollama can match it", async () => {
    const sent = capture();
    await new OllamaAdapter({ modelId: "m" }).chat({ messages: conversation });

    const messages = sent[0]!.messages as Record<string, unknown>[];
    const toolResult = messages[2]!;
    expect(toolResult.role).toBe("tool");
    expect(toolResult.tool_name).toBe("readFile");
    expect(toolResult.content).toBe("<html>…</html>");
  });

  it("leaves ordinary messages unadorned", async () => {
    const sent = capture();
    await new OllamaAdapter({ modelId: "m" }).chat({ messages: conversation });

    const messages = sent[0]!.messages as Record<string, unknown>[];
    expect(messages[0]).toEqual({ role: "user", content: "why is it broken" });
  });
});

describe("context size and truncation", () => {
  function captureBody() {
    let body: { options?: Record<string, unknown> } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        body = JSON.parse(init.body);
        return reply({ role: "assistant", content: "ok" });
      })
    );
    return () => body;
  }

  // Ollama sizes the context itself when none is sent, often at a few
  // thousand tokens, and a long reply is then cut off mid-way.
  it("asks for a context window rather than leaving it to Ollama's default", async () => {
    const sent = captureBody();
    await new OllamaAdapter({ modelId: "m", contextWindow: 8192 }).chat({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(sent().options?.num_ctx).toBe(8192);
  });

  it("caps what it asks for, so a model's documented maximum does not exhaust memory", async () => {
    const sent = captureBody();
    await new OllamaAdapter({ modelId: "m", contextWindow: 262144 }).chat({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(sent().options?.num_ctx).toBe(16384);
  });

  it("reports a reply that ran out of room as length, not stop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              message: { role: "assistant", content: '{"summary": "x' },
              done: true,
              done_reason: "length",
            }),
            { status: 200 }
          )
      )
    );
    const result = await new OllamaAdapter({ modelId: "m" }).chat({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.finishReason).toBe("length");
  });
});
