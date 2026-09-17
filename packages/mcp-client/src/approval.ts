import type { McpServerApproval, McpServerConfig, McpToolInfo } from "@paleonyx/shared-types";

/**
 * The configuration in a canonical form, for comparing against what was
 * approved. Everything that decides what actually runs is in it —
 * including the environment, since a variable such as NODE_OPTIONS can
 * change which code a familiar command loads.
 */
export function fingerprintServer(config: McpServerConfig): string {
  const env = Object.keys(config.env)
    .sort()
    .map((name) => [name, config.env[name]]);
  return JSON.stringify([config.command, config.args, env]);
}

export type ApprovalState =
  /** Never approved: nothing runs until the user says so. */
  | "not-approved"
  /** Approved once, but the configuration has changed since. */
  | "changed"
  | "approved";

export function approvalState(
  config: McpServerConfig,
  approval: McpServerApproval | undefined
): ApprovalState {
  if (!approval) return "not-approved";
  return approval.fingerprint === fingerprintServer(config) ? "approved" : "changed";
}

/**
 * The approval the user gives by allowing a server to start.
 *
 * Its tools are unknown until it runs, so the first set it reports is
 * enabled when it arrives (see `acceptToolList`). The user chose this
 * server for what it does; making them tick every tool before it can do
 * anything would teach them to tick without reading.
 */
export function approveServer(config: McpServerConfig): McpServerApproval {
  return {
    fingerprint: fingerprintServer(config),
    listed: false,
    seenTools: [],
    enabledTools: [],
  };
}

/**
 * Records the first set of tools a server reports after approval, all
 * enabled. Later listings change nothing: a tool the user has not seen
 * stays disabled until they turn it on, so a server that quietly gains a
 * "send email" tool in an update does not get to hand it to the agent.
 *
 * Returns the same object when nothing changed, so a caller can skip
 * saving.
 */
export function acceptToolList(
  approval: McpServerApproval,
  tools: readonly McpToolInfo[]
): McpServerApproval {
  if (approval.listed) return approval;
  const names = tools.map((tool) => tool.name);
  return { ...approval, listed: true, seenTools: names, enabledTools: [...names] };
}

/** Tools the server offers that the user has not been shown yet. */
export function newTools(
  approval: McpServerApproval,
  tools: readonly McpToolInfo[]
): string[] {
  return tools.map((tool) => tool.name).filter((name) => !approval.seenTools.includes(name));
}

/** Choosing either way counts as having seen the tool. */
export function setToolEnabled(
  approval: McpServerApproval,
  toolName: string,
  enabled: boolean
): McpServerApproval {
  const without = approval.enabledTools.filter((name) => name !== toolName);
  return {
    ...approval,
    seenTools: approval.seenTools.includes(toolName)
      ? approval.seenTools
      : [...approval.seenTools, toolName],
    enabledTools: enabled ? [...without, toolName] : without,
  };
}

export function isToolEnabled(approval: McpServerApproval, toolName: string): boolean {
  return approval.enabledTools.includes(toolName);
}

/**
 * Reads stored approvals back. A malformed entry is dropped, which
 * leaves that server needing approval again — the safe way to be wrong.
 */
export function parseApprovals(value: unknown): Record<string, McpServerApproval> {
  const approvals: Record<string, McpServerApproval> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return approvals;
  for (const [id, entry] of Object.entries(value)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { fingerprint, listed, seenTools, enabledTools } = entry as Record<string, unknown>;
    if (
      typeof fingerprint === "string" &&
      typeof listed === "boolean" &&
      isNameList(seenTools) &&
      isNameList(enabledTools)
    ) {
      approvals[id] = { fingerprint, listed, seenTools, enabledTools };
    }
  }
  return approvals;
}

function isNameList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
