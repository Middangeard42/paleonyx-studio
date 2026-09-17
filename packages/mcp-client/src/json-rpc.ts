/**
 * JSON-RPC 2.0, as MCP uses it: one message per line.
 *
 * Written here rather than taken from the official SDK. The part of MCP
 * this client needs — discover or initialize, list tools, call one — is
 * a few hundred lines, and the SDK brings a schema library and an HTTP
 * stack with it. Everything a server sends is parsed, never cast: it is
 * another program's output.
 */

export type RequestId = string | number;

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type IncomingMessage =
  | { kind: "result"; id: RequestId; result: Record<string, unknown> }
  | { kind: "error"; id: RequestId | null; error: RpcError }
  | { kind: "request"; id: RequestId; method: string }
  | { kind: "notification"; method: string }
  | { kind: "invalid"; reason: string };

/** Standard JSON-RPC codes this client sends or recognises. */
export const METHOD_NOT_FOUND = -32601;
/** MCP 2026-07-28: the server does not speak the requested version. */
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

export function parseIncoming(line: string): IncomingMessage {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: "invalid", reason: "not JSON" };
  }
  if (!isRecord(value)) return { kind: "invalid", reason: "not a JSON object" };
  if (value.jsonrpc !== "2.0") return { kind: "invalid", reason: "not JSON-RPC 2.0" };

  const { id, method } = value;
  const hasId = "id" in value;

  if (typeof method === "string") {
    if (!hasId) return { kind: "notification", method };
    if (!isRequestId(id)) return { kind: "invalid", reason: "request with an unusable id" };
    return { kind: "request", id, method };
  }

  if ("error" in value) {
    const error = parseError(value.error);
    if (!error) return { kind: "invalid", reason: "malformed error" };
    // An error may carry a null id when the request could not be read.
    if (id !== null && !isRequestId(id)) {
      return { kind: "invalid", reason: "error with an unusable id" };
    }
    return { kind: "error", id: id ?? null, error };
  }

  if ("result" in value) {
    if (!isRequestId(id)) return { kind: "invalid", reason: "result with an unusable id" };
    if (!isRecord(value.result)) return { kind: "invalid", reason: "result is not an object" };
    return { kind: "result", id, result: value.result };
  }

  return { kind: "invalid", reason: "neither a request, a notification, nor a response" };
}

function parseError(value: unknown): RpcError | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.code !== "number" || !Number.isInteger(value.code)) return undefined;
  if (typeof value.message !== "string") return undefined;
  return { code: value.code, message: value.message, data: value.data };
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Serialises one outgoing message.
 *
 * `JSON.stringify` never emits a raw newline — one inside a string
 * becomes `\n` — so the result is always a single line, which is the
 * whole of the stdio framing.
 */
export function encode(message: Record<string, unknown>): string {
  return JSON.stringify({ jsonrpc: "2.0", ...message });
}
