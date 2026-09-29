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
  /**
   * Whether *this build* supports tool calling, from Ollama's own
   * capability list.
   *
   * Not assumed, because it varies per build rather than per model: a
   * model documented as tool-calling can ship a GGUF whose chat template
   * does not implement it, and Ollama reports the difference. Asserting
   * support the build lacks would have agent-core offer tools that are
   * silently ignored, which looks like the agent choosing not to use
   * them.
   *
   * Defaults to false — the honest answer when nobody has said.
   */
  supportsToolCalling?: boolean;
}

const DEFAULT_BASE_URL = "http://localhost:11434";

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: OllamaToolCall[];
  /** Names which tool a `role: "tool"` message answers. */
  tool_name?: string;
  tool_call_id?: string;
}

interface OllamaChatResponse {
  message: OllamaMessage;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  done_reason?: string;
}

/**
 * The most context a request asks Ollama for. A model's documented
 * maximum can be 256k tokens, and allocating that would exhaust memory
 * on the machines this is meant for; a project-sized task fits well
 * within this.
 */
const MAX_NUM_CTX = 16384;

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
  private readonly numCtx: number;

  constructor(options: OllamaAdapterOptions) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.modelId = options.modelId;
    this.numCtx = Math.min(options.contextWindow ?? 8192, MAX_NUM_CTX);
    this.model = {
      id: options.modelId,
      label: options.modelLabel ?? options.modelId,
      provider: "ollama",
      capabilities: {
        contextWindow: options.contextWindow ?? 8192,
        supportsToolCalling: options.supportsToolCalling ?? false,
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
          // Without this Ollama picks its own, often a few thousand
          // tokens, and a long reply is cut off partway through.
          num_ctx: this.numCtx,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama request failed: ${response.status} ${await response.text()}`
      );
    }

    const data = (await response.json()) as OllamaChatResponse;
    const toolCalls = extractToolCalls(data.message, request.tools);
    return {
      content: data.message.content,
      toolCalls,
      finishReason: toolCalls
        ? "tool_calls"
        : data.done_reason === "length"
          ? "length"
          : "stop",
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
        options: { num_ctx: this.numCtx },
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

/**
 * Converts one message, keeping the parts that link a tool call to its
 * result.
 *
 * These were being dropped, and the loop suffered for it in a way that
 * looked like the model behaving oddly. Sending an assistant turn
 * without its `tool_calls` and then a bare `tool` message leaves the
 * model with a result it has no record of asking for. Observed live:
 * it read index.html, read it again, then tried to `cat` the file —
 * exactly what something does when its requests appear to vanish.
 */
function toOllamaMessage(
  message: ChatCompletionRequest["messages"][number]
): OllamaMessage {
  const converted: OllamaMessage = {
    role: message.role,
    content: message.content,
  };

  if (message.toolCalls?.length) {
    converted.tool_calls = message.toolCalls.map((call) => ({
      function: { name: call.name, arguments: call.arguments },
    }));
  }

  // Ollama matches a result to its call by tool name; the id is sent as
  // well because some builds read that instead, and an unread field
  // costs nothing.
  if (message.role === "tool") {
    if (message.toolName) converted.tool_name = message.toolName;
    if (message.toolCallId) converted.tool_call_id = message.toolCallId;
  }

  return converted;
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

/**
 * Pulls tool calls out of a reply, structured or not.
 *
 * Ollama usually parses a model's tool call into `message.tool_calls`,
 * but whether it manages to depends on the model's chat template. Some
 * builds — qwen2.5-coder:7b among them, observed directly — emit the
 * call as a JSON object in `content` instead:
 *
 *   {"role":"assistant","content":"{\"name\": \"listFiles\", ...}"}
 *
 * Reading only the structured field means silently ignoring a model that
 * is doing exactly what it was asked to, and falling back to a
 * single-pass answer as though it had declined.
 */
function extractToolCalls(
  message: OllamaMessage,
  offered: ChatCompletionRequest["tools"]
): ToolCall[] | undefined {
  const structured = fromOllamaToolCalls(message.tool_calls);
  if (structured) return structured;
  return parseToolCallsFromContent(message.content, offered);
}

/**
 * Only accepts content that names a tool we actually offered.
 *
 * That constraint is what keeps this from misreading ordinary answers:
 * a reply that happens to be JSON, or that discusses a tool by name in
 * prose, will not parse into an object whose `name` matches the offered
 * set.
 */
function parseToolCallsFromContent(
  content: string,
  offered: ChatCompletionRequest["tools"]
): ToolCall[] | undefined {
  if (!offered?.length) return undefined;

  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  const names = new Set(offered.map((tool) => tool.name));
  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  const calls: ToolCall[] = [];

  for (const [index, candidate] of candidates.entries()) {
    if (typeof candidate !== "object" || candidate === null) return undefined;
    const record = candidate as Record<string, unknown>;
    if (typeof record.name !== "string" || !names.has(record.name)) return undefined;
    const args =
      typeof record.arguments === "object" && record.arguments !== null
        ? (record.arguments as Record<string, unknown>)
        : {};
    calls.push({ id: `${index}`, name: record.name, arguments: args });
  }

  return calls.length > 0 ? calls : undefined;
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
