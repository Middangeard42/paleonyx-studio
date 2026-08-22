/**
 * Permission modes gate what the agent is allowed to do, independent of
 * what it's capable of. See CLAUDE.md §6 — this is enforced in
 * agent-core, not just displayed in the UI.
 */
export type PermissionMode =
  | "read-only"
  | "suggest-only"
  | "auto-apply"
  | "can-run-commands";

/**
 * Suggest-only is the mandatory default for any new project (CLAUDE.md §6,
 * PRD.md §5) — raising it requires an explicit, visible user action.
 */
export const DEFAULT_PERMISSION_MODE: PermissionMode = "suggest-only";

export const PERMISSION_MODE_ORDER: readonly PermissionMode[] = [
  "read-only",
  "suggest-only",
  "auto-apply",
  "can-run-commands",
];

export interface PermissionModeDescriptor {
  mode: PermissionMode;
  label: string;
  description: string;
}

export const PERMISSION_MODE_DESCRIPTORS: readonly PermissionModeDescriptor[] = [
  {
    mode: "read-only",
    label: "Read-only",
    description: "The agent can read and explain but never proposes edits.",
  },
  {
    mode: "suggest-only",
    label: "Suggest-only",
    description:
      "The agent proposes plans and diffs; nothing is written until you approve.",
  },
  {
    mode: "auto-apply",
    label: "Auto-apply",
    description:
      "Approved plans are written automatically. Still produces a plan and diff for every change, recorded in the timeline.",
  },
  {
    mode: "can-run-commands",
    label: "Can run commands",
    description:
      "The agent may additionally run allowlisted shell commands (tests, linters, builds).",
  },
];
