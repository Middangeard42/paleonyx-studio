import type { ToolParameterSchema } from "./chat.js";

/**
 * A local program that gives the agent extra tools over the Model
 * Context Protocol, as listed in a project's `.paleonyx/mcp.json`.
 *
 * Only programs the app starts itself. A server reached over the network
 * would be a new way for project content to leave the machine, which
 * CLAUDE.md §4 allows only as an explicit, visible opt-in — not yet
 * designed, so such entries are reported rather than half-supported.
 */
export interface McpServerConfig {
  /** The name it is listed under. Also how its tools are named to the model. */
  id: string;
  /** Program to start. Never run through a shell. */
  command: string;
  args: string[];
  /** Added to the environment the app itself runs with. */
  env: Record<string, string>;
}

/** A tool as a server describes it, after validation. */
export interface McpToolInfo {
  /** The server's own name for it. */
  name: string;
  title?: string;
  /** Written by the server, so untrusted; capped in length. */
  description: string;
  inputSchema: ToolParameterSchema;
}

/** Something in the configuration, or a server's answer, that could not be used. */
export interface McpProblem {
  /** The server it concerns, when it concerns one. */
  serverId?: string;
  message: string;
}

/**
 * What the user agreed to for one server, stored per project.
 *
 * Tied to the exact configuration: a repository that changes the command
 * behind a name the user already approved gets asked about again, rather
 * than inheriting the earlier yes.
 */
export interface McpServerApproval {
  /** The approved configuration, in a canonical form. */
  fingerprint: string;
  /** Whether the server has reported its tools since it was approved. */
  listed: boolean;
  /** Tools the user has been shown. Anything not listed is new. */
  seenTools: string[];
  /** Tools the agent may call. A new tool starts outside this list. */
  enabledTools: string[];
}
