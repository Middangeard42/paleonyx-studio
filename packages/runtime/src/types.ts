import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResult,
  ModelInfo,
} from "@paleonyx/shared-types";

/**
 * The single interface every provider adapter implements (CLAUDE.md §4).
 * agent-core depends only on this — adding a provider must never require
 * changes to agent-core or ui.
 */
export interface ChatModelProvider {
  readonly model: ModelInfo;
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
  chatStream(
    request: ChatCompletionRequest
  ): AsyncGenerator<ChatCompletionChunk, void, unknown>;
}
