/**
 * Refactor / Write Tests / Document are still to come.
 *
 * `scaffold` is the one that does not start from existing code: it turns
 * a wizard-composed brief into a project's first files (PRD.md §3
 * journey 13). It is deliberately a task type rather than a separate
 * pipeline, so the files it produces arrive as an ordinary reviewable
 * diff and are undone the same way as any other change.
 */
export type AgentTaskType =
  | "explain"
  | "bug-fix"
  | "scaffold"
  /** A change described by pointing at the running page (§3 journey 14). */
  | "design-change";

export interface AgentPlanStep {
  id: string;
  description: string;
  /** Name of the agent-core tool this step will invoke, if any. */
  tool?: string;
  targetFiles?: string[];
}

export interface AgentPlan {
  taskType: AgentTaskType;
  summary: string;
  steps: AgentPlanStep[];
}

export type AgentRunStatus =
  | "planning"
  | "running"
  | "awaiting-approval"
  | "paused"
  | "completed"
  | "error";

export type EscalationReason =
  | "budget-exhausted"
  | "ambiguous-instructions"
  | "tool-failure"
  | "low-confidence"
  /** The current permission mode does not allow what was asked for. */
  | "permission-denied";

export interface AgentEscalation {
  reason: EscalationReason;
  message: string;
}

export type ConfidenceLevel = "high" | "medium" | "low";

export interface BudgetLimits {
  maxToolCalls: number;
  maxTokens: number;
}

export interface BudgetUsage {
  toolCalls: number;
  tokens: number;
}

export interface AgentTaskInput {
  taskType: AgentTaskType;
  /** Freeform request text, or the guided task form's composed prompt. */
  instructions: string;
  targetFiles: string[];
}

export interface AgentTaskResult {
  plan: AgentPlan;
  /** Explain: prose walkthrough. Bug Fix: prose summary preceding the diff. */
  explanation: string;
  /** Populated for bug-fix; empty for explain. */
  diff: import("./diff.js").FileDiff[];
  confidence: ConfidenceLevel;
  escalation?: AgentEscalation;
  budgetUsage: BudgetUsage;
  /**
   * What the agent did before answering — files read, commands run and
   * what they returned. Shown so the user can see *why* it concluded
   * what it did, not just what it concluded (CLAUDE.md §7).
   */
  investigation: AgentInvestigationStep[];
}

export interface AgentInvestigationStep {
  tool: string;
  summary: string;
  detail: string;
  ok: boolean;
}
