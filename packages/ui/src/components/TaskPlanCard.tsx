import type { AgentPlan, ConfidenceLevel } from "@paleonyx/shared-types";
import { StatusBadge } from "../primitives/StatusBadge.js";
import type { StatusTone } from "../primitives/StatusBadge.js";

const CONFIDENCE_TONE: Record<ConfidenceLevel, StatusTone> = {
  high: "success",
  medium: "warning",
  low: "danger",
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export interface TaskPlanCardProps {
  plan: AgentPlan;
  confidence?: ConfidenceLevel;
}

/**
 * Renders the plan directly from structured AgentPlan data — never
 * reconstructed from prose after the fact (CLAUDE.md §6).
 */
export function TaskPlanCard({ plan, confidence }: TaskPlanCardProps) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-xs uppercase tracking-wide text-text-tertiary">
            {plan.taskType === "explain" ? "Explain" : "Bug Fix"} plan
          </span>
          <p className="text-sm text-text-primary mt-0.5">{plan.summary}</p>
        </div>
        {confidence && (
          <StatusBadge tone={CONFIDENCE_TONE[confidence]}>
            {CONFIDENCE_LABEL[confidence]}
          </StatusBadge>
        )}
      </div>
      {plan.steps.length > 0 && (
        <ol className="mt-2 space-y-1 border-t border-border-subtle pt-2">
          {plan.steps.map((step, index) => (
            <li key={step.id} className="flex gap-2 text-xs text-text-secondary">
              <span className="text-text-tertiary tabular-nums">{index + 1}.</span>
              <span>
                {step.description}
                {step.targetFiles && step.targetFiles.length > 0 && (
                  <span className="text-text-tertiary"> — {step.targetFiles.join(", ")}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
