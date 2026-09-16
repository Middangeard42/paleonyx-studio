import { vi } from "vitest";

/**
 * A scripted stand-in for an Ollama server, spoken to over its real wire
 * format by the real `OllamaAdapter`.
 *
 * Exists because `MockAdapter` skips the part that kept breaking. The
 * worst bugs found in manual testing lived between agent-core and the
 * provider — tool calls dropped while converting messages, capabilities
 * read from the endpoint that does not know them — and a mock that
 * answers from a function never serializes anything, so it cannot see
 * any of that. This sits one layer further out: the adapter builds real
 * request bodies, and this reads them.
 *
 * Its turns receive the conversation as sent, so a script can behave the
 * way a real model did: unable to move on until it can see the tool call
 * it made. That is the behaviour which turned a dropped field into a
 * model reading the same file twice and then reaching for a shell.
 */

export interface WireMessage {
  role: string;
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
  tool_call_id?: string;
}

export interface SeenRequest {
  messages: WireMessage[];
  tools?: { function: { name: string } }[];
}

export interface TurnReply {
  content?: string;
  toolCall?: { name: string; arguments: Record<string, unknown> };
  /**
   * Answer again from this same turn next time rather than moving on —
   * how a script models a model that is stuck.
   */
  stay?: boolean;
}

export type Turn = (request: SeenRequest) => TurnReply;

export interface FakeOllamaOptions {
  /** What the model does while gathering, in order. */
  investigate?: Turn[];
  /** The structured answer, sent when agent-core asks for one. */
  answer: unknown;
  /** Capabilities reported by the cheap listing endpoint. */
  tagCapabilities?: string[];
  /**
   * Capabilities reported by the inspection endpoint. Deliberately
   * separate: the two disagree for some real builds.
   */
  showCapabilities?: string[];
  modelId?: string;
}

export class FakeOllama {
  /** Every chat request, as the adapter serialized it. */
  readonly chats: SeenRequest[] = [];
  private turn = 0;

  constructor(private readonly options: FakeOllamaOptions) {}

  install(): this {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => this.handle(String(url), init))
    );
    return this;
  }

  private handle(url: string, init?: RequestInit): Response {
    const modelId = this.options.modelId ?? "fake-model";

    if (url.endsWith("/api/tags")) {
      return json({
        models: [
          {
            name: modelId,
            capabilities: this.options.tagCapabilities ?? ["completion"],
            details: { parameter_size: "7B", context_length: 32768 },
          },
        ],
      });
    }

    if (url.endsWith("/api/show")) {
      return json({
        capabilities: this.options.showCapabilities ??
          this.options.tagCapabilities ?? ["completion"],
      });
    }

    if (url.endsWith("/api/chat")) {
      const request = JSON.parse(String(init?.body)) as SeenRequest;
      this.chats.push(request);
      return json(reply(this.respond(request)));
    }

    return new Response(`fake ollama has no route for ${url}`, { status: 404 });
  }

  private respond(request: SeenRequest): TurnReply {
    // agent-core asks for the structured answer as its own final turn,
    // and again once if the first attempt did not parse.
    const last = request.messages.at(-1);
    if (
      last?.role === "user" &&
      /^(Now answer|Reply with only the fenced)/.test(last.content)
    ) {
      return { content: fenced(this.options.answer) };
    }

    const turns = this.options.investigate ?? [];
    const current = turns[this.turn];
    // Out of script: the model says it has what it needs, which is what
    // ends the gathering loop.
    if (!current) return { content: "I have what I need." };

    const result = current(request);
    if (!result.stay) this.turn += 1;
    return result;
  }
}

/** A turn that calls a tool. */
export function callTool(name: string, args: Record<string, unknown>): Turn {
  return () => ({ toolCall: { name, arguments: args } });
}

/** A turn that ends gathering with prose. */
export function done(content = "I have what I need."): Turn {
  return () => ({ content });
}

/**
 * A turn played by a model that must see its own previous call.
 *
 * If the conversation shows it asking for `name` and a result coming
 * back for that call, it moves on. If not — the observed failure — it
 * asks again, and keeps asking, which is exactly how a dropped field
 * looks from the outside.
 */
export function requiresLinkage(name: string, then: Turn): Turn {
  return (request) => {
    if (sawOwnToolCall(request, name)) return then(request);
    return { toolCall: { name, arguments: lastArguments(request, name) }, stay: true };
  };
}

export function sawOwnToolCall(request: SeenRequest, name: string): boolean {
  const asked = request.messages.some(
    (message) =>
      message.role === "assistant" &&
      message.tool_calls?.some((call) => call.function.name === name)
  );
  const answered = request.messages.some(
    (message) =>
      message.role === "tool" && (message.tool_name === name || Boolean(message.tool_call_id))
  );
  return asked && answered;
}

function lastArguments(request: SeenRequest, name: string): Record<string, unknown> {
  for (const message of [...request.messages].reverse()) {
    const call = message.tool_calls?.find((c) => c.function.name === name);
    if (call) return call.function.arguments;
  }
  // Nothing to repeat because the call itself was dropped — which is the
  // bug. Ask for something plausible so the thrash is visible.
  return { path: "src/sum.test.ts" };
}

function reply(turn: TurnReply) {
  return {
    message: {
      role: "assistant",
      content: turn.content ?? "",
      ...(turn.toolCall
        ? {
            tool_calls: [
              {
                function: {
                  name: turn.toolCall.name,
                  arguments: turn.toolCall.arguments,
                },
              },
            ],
          }
        : {}),
    },
    done: true,
    // Small, so the token budget never becomes the reason a test fails.
    prompt_eval_count: 10,
    eval_count: 10,
  };
}

function fenced(value: unknown): string {
  return "```json\n" + JSON.stringify(value) + "\n```";
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}
