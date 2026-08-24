import type { AgentTaskType } from "@paleonyx/shared-types";

/**
 * What each task type is called on screen.
 *
 * Not every label here belongs in the task picker — `scaffold` is
 * reached from the new-project wizard, and offering it against an
 * already-open project would make no sense — but every one of them can
 * appear on a plan card afterwards, so the naming lives in one place
 * rather than in a ternary per component.
 */
export const TASK_TYPE_LABELS: Record<AgentTaskType, string> = {
  explain: "Explain",
  "bug-fix": "Bug Fix",
  scaffold: "New Project",
};
