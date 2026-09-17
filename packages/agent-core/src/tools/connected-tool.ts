import type { ToolDefinition } from "@paleonyx/shared-types";

/**
 * A tool from a program the user connected, such as an MCP server.
 *
 * agent-core does not know what is behind it — the host supplies the
 * call, the same way it supplies `runCommand`, because reaching another
 * process is not something this layer does itself (CLAUDE.md §2). What
 * stays here is the decision whether it may be offered at all, and the
 * record of every call.
 */
export interface ConnectedTool {
  /** `name` is what the model sees; the host keeps it unique. */
  definition: ToolDefinition;
  /** Where it comes from, for the user: the server's name. */
  source: string;
  /** The tool's own name at its source. */
  toolName: string;
  call(args: Record<string, unknown>): Promise<ConnectedToolResult>;
}

export interface ConnectedToolResult {
  text: string;
  /** The tool ran and reported failure. Information, like a failing test. */
  isError: boolean;
}

/**
 * The description a model sees, labelled with where it came from.
 *
 * The text is the server's own, so it is untrusted. The label cannot
 * make it safe, but it does keep a server from passing its tool off as
 * one of the app's.
 */
export function connectedToolDescription(source: string, description: string): string {
  const own = description.trim();
  return `[From the connected server "${source}"]${own ? ` ${own}` : ""}`;
}

/** Arguments shown to the user, compact but complete. */
export function formatToolInput(args: Record<string, unknown>): string {
  const text = JSON.stringify(args, null, 2);
  return text.length > 4000 ? `${text.slice(0, 4000)}\n… (${text.length - 4000} more characters)` : text;
}
