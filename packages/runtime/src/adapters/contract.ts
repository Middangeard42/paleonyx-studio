import { expect, it, vi, afterEach, describe } from "vitest";
import type { ChatMessage } from "@paleonyx/shared-types";
import type { ChatModelProvider } from "../types.js";

/**
 * The suite every adapter must pass (CLAUDE.md §8).
 *
 * Written after a bug that existed identically in both adapters and was
 * found in neither: each dropped `toolCalls` and `toolCallId` when
 * converting messages, so a model was handed tool results with no record
 * of having asked for them. Both had their own tests; neither test
 * suite asked the question, because each was written around the wire
 * format it happened to speak rather than around what the interface
 * promises. One assertion here would have failed twice.
 *
 * The adapters genuinely do speak different wire formats, so a shared
 * suite cannot assert on request bodies directly. Instead each adapter
 * supplies a `readOutgoing` that normalizes its own wire back into the
 * interface's own vocabulary, and the contract asserts on that. What is
 * shared is the meaning; what differs stays the adapter's business.
 */

/** One outgoing message, normalized back out of an adapter's wire format. */
export interface OutgoingMessage {
  role: string;
  content: string;
  /** Tool calls the assistant turn is carrying, if any. */
  toolCalls?: { name: string; arguments: Record<string, unknown> }[];
  /**
   * How this message identifies the call it answers. Adapters disagree
   * about whether that is a name or an id, so the contract only requires
   * that *something* links them.
   */
  answersCall?: string;
}

export interface AdapterUnderTest {
  name: string;
  create(): ChatModelProvider;
  /** A backend reply carrying plain text. */
  textReply(content: string): unknown;
  /** A backend reply carrying one tool call. */
  toolCallReply(call: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }): unknown;
  /** Reads an outgoing request body back into normalized messages. */
  readOutgoing(body: unknown): OutgoingMessage[];
}

const CONVERSATION: ChatMessage[] = [
  { role: "system", content: "you are a tool" },
  { role: "user", content: "why is it broken" },
  {
    role: "assistant",
    content: "",
    toolCalls: [
      { id: "call_1", name: "readFile", arguments: { path: "index.html" } },
    ],
  },
  {
    role: "tool",
    content: "<html>…</html>",
    toolCallId: "call_1",
    toolName: "readFile",
  },
];

export function describeAdapterContract(adapter: AdapterUnderTest): void {
  describe(`${adapter.name} — adapter contract`, () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function capture(reply: unknown) {
      const bodies: unknown[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify(reply));
        })
      );
      return bodies;
    }

    it("declares its model and capabilities", () => {
      const model = adapter.create().model;
      expect(model.id, "id").toBeTruthy();
      expect(model.label, "label").toBeTruthy();
      expect(model.provider, "provider").toBeTruthy();
      expect(typeof model.capabilities.supportsToolCalling).toBe("boolean");
      expect(typeof model.capabilities.isLocal).toBe("boolean");
      expect(model.capabilities.contextWindow).toBeGreaterThan(0);
    });

    it("returns the reply's content", async () => {
      capture(adapter.textReply("here is why"));
      const result = await adapter
        .create()
        .chat({ messages: [{ role: "user", content: "why" }] });
      expect(result.content).toBe("here is why");
      expect(result.finishReason).toBe("stop");
    });

    it("surfaces a tool call the backend returned", async () => {
      capture(
        adapter.toolCallReply({
          id: "call_9",
          name: "listFiles",
          arguments: { path: "src" },
        })
      );
      const result = await adapter
        .create()
        .chat({ messages: [{ role: "user", content: "look" }] });

      expect(result.finishReason).toBe("tool_calls");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls?.[0]?.name).toBe("listFiles");
      expect(result.toolCalls?.[0]?.arguments).toEqual({ path: "src" });
    });

    it("sends plain messages through unchanged", async () => {
      const bodies = capture(adapter.textReply("ok"));
      await adapter.create().chat({ messages: CONVERSATION });

      const sent = adapter.readOutgoing(bodies[0]);
      expect(sent[0]).toMatchObject({ role: "system", content: "you are a tool" });
      expect(sent[1]).toMatchObject({ role: "user", content: "why is it broken" });
    });

    /**
     * The one that was missing.
     *
     * A model that asked to read a file must see, in the conversation it
     * gets back, that it asked. Dropping this leaves it holding an
     * answer to a question it has no record of posing — which is what
     * made one model read the same file twice and then reach for a
     * shell.
     */
    it("keeps the tool call on the assistant turn that made it", async () => {
      const bodies = capture(adapter.textReply("ok"));
      await adapter.create().chat({ messages: CONVERSATION });

      const sent = adapter.readOutgoing(bodies[0]);
      const assistant = sent.find((message) => message.role === "assistant");
      expect(assistant, "no assistant turn reached the provider").toBeDefined();
      expect(assistant?.toolCalls, "tool calls were dropped").toHaveLength(1);
      expect(assistant?.toolCalls?.[0]?.name).toBe("readFile");
      expect(assistant?.toolCalls?.[0]?.arguments).toEqual({ path: "index.html" });
    });

    it("links a tool result back to the call it answers", async () => {
      const bodies = capture(adapter.textReply("ok"));
      await adapter.create().chat({ messages: CONVERSATION });

      const sent = adapter.readOutgoing(bodies[0]);
      const toolResult = sent.find((message) => message.role === "tool");
      expect(toolResult, "no tool result reached the provider").toBeDefined();
      expect(toolResult?.content).toBe("<html>…</html>");
      expect(
        toolResult?.answersCall,
        "the result was not linked to its call"
      ).toBeTruthy();
    });

    it("offers tools to the backend when asked to", async () => {
      const bodies = capture(adapter.textReply("ok"));
      await adapter.create().chat({
        messages: [{ role: "user", content: "look" }],
        tools: [
          {
            name: "readFile",
            description: "read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      });

      // Wire-agnostic on purpose: where the tools sit differs, that they
      // were sent at all does not.
      expect(JSON.stringify(bodies[0])).toContain("readFile");
    });

    it("fails loudly when the backend rejects the request", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("nope", { status: 500 }))
      );
      await expect(
        adapter.create().chat({ messages: [{ role: "user", content: "x" }] })
      ).rejects.toThrow();
    });
  });
}
