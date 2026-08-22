/**
 * Wire format for the runtime layer's OpenAI-compatible interface
 * (CLAUDE.md §4). Named for the concept, not the transport.
 */
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present when role === "tool": which tool call this message answers. */
  toolCallId?: string;
  /** Present when role === "assistant" and the model requested tool calls. */
  toolCalls?: ToolCall[];
}

export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export type ChatFinishReason = "stop" | "tool_calls" | "length" | "error";

export interface ChatCompletionUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatCompletionResult {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: ChatFinishReason;
  usage?: ChatCompletionUsage;
}

export interface ChatCompletionChunk {
  delta: string;
  done: boolean;
  toolCalls?: ToolCall[];
}
