import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResult,
  ModelInfo,
  ToolCall,
} from "@paleonyx/shared-types";
import type { ChatModelProvider } from "../types.js";

export interface OllamaAdapterOptions {
  baseUrl?: string;
  modelId: string;
  modelLabel?: string;
  contextWindow?: number;
}

const DEFAULT_BASE_URL = "http://localhost:11434";

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaChatResponse {
  message: OllamaMessage;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Talks to a local Ollama instance over its native /api/chat endpoint
 * (more stable than Ollama's OpenAI-compatibility surface at the time of
 * writing). This adapter is the translation layer: agent-core only ever
 * sees the OpenAI-compatible-shaped ChatModelProvider interface
 * (CLAUDE.md §4), never Ollama's wire format directly.
 */
export class OllamaAdapter implements ChatModelProvider {
  readonly model: ModelInfo;
  private readonly baseUrl: string;
  private readonly modelId: string;

  constructor(options: OllamaAdapterOptions) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.modelId = options.modelId;
    this.model = {
      id: options.modelId,
      label: options.modelLabel ?? options.modelId,
      provider: "ollama",
      capabilities: {
        // Not discovered per-model in v0 — a real capability lookup
        // (via `ollama show`) is a v1 concern, not a v0 skeleton one.
        contextWindow: options.contextWindow ?? 8192,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsVision: false,
        isLocal: true,
      },
    };
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.modelId,
        messages: request.messages.map(toOllamaMessage),
        tools: toOllamaTools(request),
        stream: false,
        options: {
          temperature: request.temperature,
          num_predict: request.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama request failed: ${response.status} ${await response.text()}`
      );
    }

    const data = (await response.json()) as OllamaChatResponse;
    const toolCalls = fromOllamaToolCalls(data.message.tool_calls);
    return {
      content: data.message.content,
      toolCalls,
      finishReason: toolCalls ? "tool_calls" : "stop",
      usage: {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
      },
    };
  }

  async *chatStream(
    request: ChatCompletionRequest
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.modelId,
        messages: request.messages.map(toOllamaMessage),
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(
        `Ollama stream request failed: ${response.status} ${await response.text()}`
      );
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
        if (!line.trim()) continue;
        const parsed = JSON.parse(line) as OllamaChatResponse;
        yield { delta: parsed.message.content, done: parsed.done };
      }
    }
  }
}

/** Health check used by callers to decide whether Ollama is reachable at all before relying on it. */
export async function pingOllama(baseUrl = DEFAULT_BASE_URL): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

function toOllamaMessage(
  message: ChatCompletionRequest["messages"][number]
): OllamaMessage {
  return { role: message.role, content: message.content };
}

function toOllamaTools(request: ChatCompletionRequest) {
  if (!request.tools?.length) return undefined;
  return request.tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function fromOllamaToolCalls(
  toolCalls: OllamaMessage["tool_calls"]
): ToolCall[] | undefined {
  if (!toolCalls?.length) return undefined;
  return toolCalls.map((call, index) => ({
    id: `${index}`,
    name: call.function.name,
    arguments: call.function.arguments,
  }));
}
