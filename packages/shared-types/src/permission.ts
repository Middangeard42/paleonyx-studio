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

/** Least to most permissive. Index into this to compare two modes. */
export const PERMISSION_MODE_ORDER: readonly PermissionMode[] = [
  "read-only",
  "suggest-only",
  "auto-apply",
  "can-run-commands",
];

/**
 * Predicates rather than scattered `mode === "..."` comparisons.
 *
 * agent-core enforces these; the UI reads the same functions to decide
 * what to disable. One definition, so a control cannot offer something
 * the enforcement layer will refuse — or worse, quietly permit something
 * the UI thought it had disabled.
 */
export function canProposeEdits(mode: PermissionMode): boolean {
  return mode !== "read-only";
}

export function canApplyWithoutApproval(mode: PermissionMode): boolean {
  return mode === "auto-apply" || mode === "can-run-commands";
}

export function canRunCommands(mode: PermissionMode): boolean {
  return mode === "can-run-commands";
}

/** True when moving from `from` to `to` grants the agent more latitude. */
export function isMorePermissive(from: PermissionMode, to: PermissionMode): boolean {
  return PERMISSION_MODE_ORDER.indexOf(to) > PERMISSION_MODE_ORDER.indexOf(from);
}

/**
 * Modes the app can currently honour.
 *
 * All four now do something: `can-run-commands` gates the runCommand
 * tool, which runs only commands matching this project's allowlist
 * (agent-core's command-allowlist).
 */
export const SELECTABLE_PERMISSION_MODES: readonly PermissionMode[] = [
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
      "Adds the ability to run commands from this project's allowed list, such as tests and linters, and read their output.",
  },
];
