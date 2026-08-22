import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResult,
  ModelInfo,
} from "@paleonyx/shared-types";
import type { ChatModelProvider } from "../types.js";

export interface MockAdapterOptions {
  modelId?: string;
  modelLabel?: string;
  /** Deterministic responder — callers control the canned output. */
  respond: (request: ChatCompletionRequest) => string;
  /** Artificial latency in ms, to keep loading states honest in dev. */
  latencyMs?: number;
}

/**
 * A ChatModelProvider with no real backend — used by the web dev harness
 * and by agent-core's own tests so the whole pipeline is exercisable
 * without a running Ollama instance. Never presented to a user as a real
 * local model.
 */
export class MockAdapter implements ChatModelProvider {
  readonly model: ModelInfo;
  private readonly respond: (request: ChatCompletionRequest) => string;
  private readonly latencyMs: number;

  constructor(options: MockAdapterOptions) {
    this.respond = options.respond;
    this.latencyMs = options.latencyMs ?? 300;
    this.model = {
      id: options.modelId ?? "mock",
      label: options.modelLabel ?? "Mock (offline)",
      provider: "mock",
      capabilities: {
        contextWindow: 32000,
        supportsToolCalling: false,
        supportsStreaming: true,
        supportsVision: false,
        isLocal: true,
      },
    };
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    await delay(this.latencyMs);
    return {
      content: this.respond(request),
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0 },
    };
  }

  async *chatStream(
    request: ChatCompletionRequest
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const content = this.respond(request);
    const words = content.split(/(?<=\s)/);
    for (const word of words) {
      await delay(this.latencyMs / Math.max(words.length, 1));
      yield { delta: word, done: false };
    }
    yield { delta: "", done: true };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
