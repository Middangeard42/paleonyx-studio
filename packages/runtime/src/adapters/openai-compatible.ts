import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResult,
  ModelInfo,
  ToolCall,
} from "@paleonyx/shared-types";
import type { ChatModelProvider } from "../types.js";

export interface OpenAiCompatibleOptions {
  /** Adapter id surfaced in ModelInfo, e.g. "openrouter". */
  provider: string;
  /** Root of the API, e.g. "https://openrouter.ai/api/v1". */
  baseUrl: string;
  modelId: string;
  modelLabel?: string;
  contextWindow?: number;
  supportsToolCalling?: boolean;
  /**
   * Fetches the API key at the moment a request is made.
   *
   * A callback rather than a value, on purpose. The key comes from OS
   * credential storage and is used immediately; nothing here keeps a
   * copy, so it never sits in application state waiting to be found in a
   * heap snapshot or logged by accident (CLAUDE.md §4.2).
   */
  getApiKey: () => Promise<string | null>;
  /** Sent as HTTP-Referer/X-Title where the provider asks for attribution. */
  appUrl?: string;
  appName?: string;
}

/**
 * One adapter for every provider that speaks the OpenAI chat-completions
 * shape — which both v1 BYOK providers do (OpenRouter and Groq), and
 * most remote providers besides.
 *
 * Written once rather than per provider: CLAUDE.md §4 requires that
 * adding a provider never touches agent-core or ui, and for anything
 * OpenAI-compatible it now does not touch runtime either — a new
 * provider is a configuration, not a file.
 *
 * `isLocal: false` is the only thing distinguishing these from a local
 * model anywhere upstream. That flag is what the status bar reads, so a
 * remote model is always visibly remote.
 */
export class OpenAiCompatibleAdapter implements ChatModelProvider {
  readonly model: ModelInfo;
  private readonly options: OpenAiCompatibleOptions;

  constructor(options: OpenAiCompatibleOptions) {
    this.options = options;
    this.model = {
      id: options.modelId,
      label: options.modelLabel ?? options.modelId,
      provider: options.provider,
      capabilities: {
        contextWindow: options.contextWindow ?? 32768,
        supportsToolCalling: options.supportsToolCalling ?? true,
        supportsStreaming: true,
        supportsVision: false,
        isLocal: false,
      },
    };
  }

  private async headers(): Promise<Record<string, string>> {
    const key = await this.options.getApiKey();
    if (!key) {
      throw new Error(
        `No API key is set for ${this.options.provider}. Add one in Settings under Models.`
      );
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    };
    // OpenRouter uses these for attribution and ranking; harmless
    // elsewhere, and only ever our own app identity — never anything
    // about the user or their code.
    if (this.options.appUrl) headers["HTTP-Referer"] = this.options.appUrl;
    if (this.options.appName) headers["X-Title"] = this.options.appName;
    return headers;
  }

  private body(request: ChatCompletionRequest, stream: boolean) {
    return JSON.stringify({
      model: this.options.modelId,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      tools: request.tools?.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream,
    });
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const response = await fetch(`${this.options.baseUrl}/chat/completions`, {
      method: "POST",
      headers: await this.headers(),
      body: this.body(request, false),
    });

    if (!response.ok) {
      throw new Error(await describeFailure(response, this.options.provider));
    }

    const data = (await response.json()) as OpenAiChatResponse;
    const choice = data.choices?.[0];
    const toolCalls = fromOpenAiToolCalls(choice?.message?.tool_calls);
    return {
      content: choice?.message?.content ?? "",
      toolCalls,
      finishReason: toolCalls ? "tool_calls" : "stop",
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }

  async *chatStream(
    request: ChatCompletionRequest
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const response = await fetch(`${this.options.baseUrl}/chat/completions`, {
      method: "POST",
      headers: await this.headers(),
      body: this.body(request, true),
    });

    if (!response.ok || !response.body) {
      throw new Error(await describeFailure(response, this.options.provider));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          yield { delta: "", done: true };
          return;
        }
        // A malformed chunk mid-stream should not abort a response that
        // is otherwise arriving fine.
        try {
          const parsed = JSON.parse(payload) as OpenAiStreamChunk;
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield { delta, done: false };
        } catch {
          continue;
        }
      }
    }
    yield { delta: "", done: true };
  }
}

interface OpenAiChatResponse {
  choices?: {
    message?: { content?: string; tool_calls?: OpenAiToolCall[] };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface OpenAiStreamChunk {
  choices?: { delta?: { content?: string } }[];
}

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

function fromOpenAiToolCalls(calls: OpenAiToolCall[] | undefined): ToolCall[] | undefined {
  if (!calls?.length) return undefined;
  const parsed: ToolCall[] = [];
  for (const [index, call] of calls.entries()) {
    if (!call.function?.name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      // Leave the arguments empty; agent-core validates tool-call
      // arguments before executing anything.
    }
    parsed.push({ id: call.id ?? `${index}`, name: call.function.name, arguments: args });
  }
  return parsed.length > 0 ? parsed : undefined;
}

/**
 * Turns a failed response into something a user can act on. Notably
 * never includes the response body verbatim for auth failures, since
 * some providers echo part of the submitted key back.
 */
async function describeFailure(response: Response, provider: string): Promise<string> {
  if (response.status === 401 || response.status === 403) {
    return `${provider} rejected the API key. Check it in Settings under Models.`;
  }
  if (response.status === 429) {
    return `${provider} is rate-limiting this key. Wait a moment, or check your plan's limits.`;
  }
  const detail = await response.text().catch(() => "");
  return `${provider} request failed (${response.status}). ${detail.slice(0, 200)}`;
}
