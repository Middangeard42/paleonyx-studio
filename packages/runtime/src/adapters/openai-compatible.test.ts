import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatCompletionRequest } from "@paleonyx/shared-types";
import { OpenAiCompatibleAdapter } from "./openai-compatible.js";

const REQUEST: ChatCompletionRequest = {
  messages: [{ role: "user", content: "hello" }],
};

function adapter(overrides: Partial<Parameters<typeof makeOptions>[0]> = {}) {
  return new OpenAiCompatibleAdapter(makeOptions(overrides));
}

function makeOptions(overrides: {
  getApiKey?: () => Promise<string | null>;
  provider?: string;
} = {}) {
  return {
    provider: overrides.provider ?? "openrouter",
    baseUrl: "https://example.test/v1",
    modelId: "some/model",
    getApiKey: overrides.getApiKey ?? (async () => "sk-test-key"),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(lines: string[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("credentials", () => {
  it("sends the key as a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "hi" } }] })
    );
    vi.stubGlobal("fetch", fetchMock);

    await adapter().chat(REQUEST);

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const init = call?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test-key");
  });

  it("fetches the key per request rather than caching it", async () => {
    // The key lives in OS credential storage and is read at the moment
    // it is needed. Caching it here would put it back in application
    // memory, which is what the design avoids (CLAUDE.md §4.2).
    const getApiKey = vi.fn().mockResolvedValue("sk-test-key");
    // A fresh Response per call: a body can only be read once, so a
    // shared instance would fail on the second request for reasons that
    // have nothing to do with what this is testing.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ choices: [{ message: { content: "" } }] }))
    );

    const provider = adapter({ getApiKey });
    await provider.chat(REQUEST);
    await provider.chat(REQUEST);

    expect(getApiKey).toHaveBeenCalledTimes(2);
  });

  it("explains where to add a key when none is set, without calling out", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(adapter({ getApiKey: async () => null }).chat(REQUEST)).rejects.toThrow(
      /No API key is set for openrouter/
    );
    // No key means no request — nothing should reach the network.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not echo the provider's response body on an auth failure", async () => {
    // Some providers include part of the submitted key in the rejection
    // body. Surfacing that verbatim would put a secret into an error
    // string, which tends to end up in logs.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid key sk-test-key-abcdef", { status: 401 }))
    );

    // Captured and inspected directly. `rejects.not.toThrow(...)` passes
    // trivially on any rejection, so it cannot detect a leak.
    const error = await adapter()
      .chat(REQUEST)
      .then(
        () => new Error("expected the request to fail"),
        (thrown: unknown) => thrown as Error
      );

    expect(error.message).toMatch(/rejected the API key\. Check it in Settings/);
    expect(error.message).not.toContain("sk-test-key");
  });

  it("names rate limiting as its own case", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("slow down", { status: 429 })));
    await expect(adapter().chat(REQUEST)).rejects.toThrow(/rate-limiting/);
  });
});

describe("capabilities", () => {
  it("reports itself as remote, which is what the status bar reads", () => {
    expect(adapter().model.capabilities.isLocal).toBe(false);
  });
});

describe("responses", () => {
  it("returns content and usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: "the answer" } }],
          usage: { prompt_tokens: 12, completion_tokens: 34 },
        })
      )
    );

    const result = await adapter().chat(REQUEST);
    expect(result.content).toBe("the answer");
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 34 });
    expect(result.finishReason).toBe("stop");
  });

  it("parses tool calls and their JSON arguments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call_1",
                    function: { name: "readFile", arguments: '{"path":"src/a.ts"}' },
                  },
                ],
              },
            },
          ],
        })
      )
    );

    const result = await adapter().chat(REQUEST);
    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls?.[0]).toEqual({
      id: "call_1",
      name: "readFile",
      arguments: { path: "src/a.ts" },
    });
  });

  it("keeps a tool call whose arguments will not parse, with empty arguments", async () => {
    // agent-core validates tool-call arguments before executing anything,
    // so surfacing the call with nothing in it is safe and more useful
    // than dropping it silently.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [
            {
              message: {
                tool_calls: [{ id: "c", function: { name: "readFile", arguments: "{oops" } }],
              },
            },
          ],
        })
      )
    );

    const result = await adapter().chat(REQUEST);
    expect(result.toolCalls?.[0]).toEqual({ id: "c", name: "readFile", arguments: {} });
  });
});

describe("streaming", () => {
  it("yields deltas and stops at [DONE]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
          "data: [DONE]\n",
        ])
      )
    );

    const deltas: string[] = [];
    for await (const chunk of adapter().chatStream(REQUEST)) {
      if (chunk.delta) deltas.push(chunk.delta);
    }
    expect(deltas.join("")).toBe("Hello");
  });

  it("survives a malformed chunk mid-stream", async () => {
    // One bad frame should not abandon a response that is otherwise
    // arriving fine.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"good"}}]}\n',
          "data: {not json\n",
          'data: {"choices":[{"delta":{"content":" more"}}]}\n',
          "data: [DONE]\n",
        ])
      )
    );

    const deltas: string[] = [];
    for await (const chunk of adapter().chatStream(REQUEST)) {
      if (chunk.delta) deltas.push(chunk.delta);
    }
    expect(deltas.join("")).toBe("good more");
  });

  it("handles a delta split across network reads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"con',
          'tent":"split"}}]}\n',
          "data: [DONE]\n",
        ])
      )
    );

    const deltas: string[] = [];
    for await (const chunk of adapter().chatStream(REQUEST)) {
      if (chunk.delta) deltas.push(chunk.delta);
    }
    expect(deltas.join("")).toBe("split");
  });
});
