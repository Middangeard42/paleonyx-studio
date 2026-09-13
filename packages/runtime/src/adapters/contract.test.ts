import { OllamaAdapter } from "./ollama.js";
import { OpenAiCompatibleAdapter } from "./openai-compatible.js";
import { MockAdapter } from "./mock.js";
import { describeAdapterContract } from "./contract.js";
import type { OutgoingMessage } from "./contract.js";

/**
 * Every adapter, against the same suite (CLAUDE.md §8).
 *
 * Each entry declares how to read its own wire format back into the
 * interface's vocabulary. That declaration is the only adapter-specific
 * part; the assertions are shared, which is the whole point — the bug
 * this exists for was identical in two adapters and caught by neither
 * adapter's own tests.
 */

interface WireMessage {
  role: string;
  content: string;
  tool_calls?: {
    id?: string;
    function: { name: string; arguments: unknown };
  }[];
  tool_name?: string;
  tool_call_id?: string;
}

function messagesOf(body: unknown): WireMessage[] {
  return (body as { messages: WireMessage[] }).messages;
}

/** Ollama sends arguments as an object; OpenAI sends a JSON string. */
function normalize(message: WireMessage, argumentsAreJsonText: boolean): OutgoingMessage {
  const normalized: OutgoingMessage = {
    role: message.role,
    content: message.content,
  };

  if (message.tool_calls?.length) {
    normalized.toolCalls = message.tool_calls.map((call) => ({
      name: call.function.name,
      arguments: argumentsAreJsonText
        ? (JSON.parse(String(call.function.arguments)) as Record<string, unknown>)
        : (call.function.arguments as Record<string, unknown>),
    }));
  }

  const link = message.tool_call_id ?? message.tool_name;
  if (message.role === "tool" && link) normalized.answersCall = link;

  return normalized;
}

describeAdapterContract({
  name: "OllamaAdapter",
  create: () =>
    new OllamaAdapter({ modelId: "test-model", supportsToolCalling: true }),
  textReply: (content) => ({
    message: { role: "assistant", content },
    done: true,
  }),
  toolCallReply: (call) => ({
    message: {
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: call.name, arguments: call.arguments } }],
    },
    done: true,
  }),
  readOutgoing: (body) => messagesOf(body).map((m) => normalize(m, false)),
});

describeAdapterContract({
  name: "OpenAiCompatibleAdapter",
  create: () =>
    new OpenAiCompatibleAdapter({
      provider: "openrouter",
      baseUrl: "https://example.test/v1",
      modelId: "test-model",
      getApiKey: async () => "key",
    }),
  textReply: (content) => ({ choices: [{ message: { content } }] }),
  toolCallReply: (call) => ({
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments),
              },
            },
          ],
        },
      },
    ],
  }),
  readOutgoing: (body) => messagesOf(body).map((m) => normalize(m, true)),
});

/**
 * The mock counts too.
 *
 * It stands in for a real provider in agent-core's tests, so a mock that
 * drifts from the interface would let those tests pass against behaviour
 * no real adapter has. It answers from a function rather than the
 * network, so the fetch-shaped parts of the contract do not apply —
 * hence its own narrower check rather than the shared suite.
 */
import { describe, expect, it } from "vitest";

describe("MockAdapter — interface parity", () => {
  it("declares a model like any other adapter", () => {
    const model = new MockAdapter({ respond: () => "hi" }).model;
    expect(model.id).toBeTruthy();
    expect(model.provider).toBeTruthy();
    expect(model.capabilities.contextWindow).toBeGreaterThan(0);
  });

  it("receives the whole conversation, tool linkage included", async () => {
    let seen: unknown;
    const adapter = new MockAdapter({
      respond: (request) => {
        seen = request.messages;
        return "ok";
      },
      latencyMs: 0,
    });

    await adapter.chat({
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "readFile", arguments: { path: "a.ts" } }],
        },
        { role: "tool", content: "x", toolCallId: "c1", toolName: "readFile" },
      ],
    });

    const messages = seen as { toolCalls?: unknown[]; toolCallId?: string }[];
    expect(messages[0]?.toolCalls).toHaveLength(1);
    expect(messages[1]?.toolCallId).toBe("c1");
  });
});
