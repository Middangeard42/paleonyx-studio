import type { AgentPlan, ConfidenceLevel } from "@paleonyx/shared-types";
import { StatusBadge } from "../primitives/StatusBadge.js";
import type { StatusTone } from "../primitives/StatusBadge.js";
import { TASK_TYPE_LABELS } from "./task-type-labels.js";

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
  /**
   * The model's own assessment. Self-reported and therefore not
   * evidence: a small model will cheerfully report "high" alongside an
   * incoherent answer.
   */
  confidence?: ConfidenceLevel;
  /**
   * Set when we checked the proposal against the real files and it does
   * not apply.
   *
   * That check outranks anything the model says about itself, so it
   * replaces the confidence badge rather than sitting beside it.
   * Displaying "High confidence" next to a diff we have just proven does
   * not fit is worse than displaying nothing — it lends our own
   * credibility to a claim we have already disproved.
   */
  contradicted?: boolean;
}

/**
 * Renders the plan directly from structured AgentPlan data — never
 * reconstructed from prose after the fact (CLAUDE.md §6).
 */
export function TaskPlanCard({ plan, confidence, contradicted }: TaskPlanCardProps) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-xs uppercase tracking-wide text-text-tertiary">
            {TASK_TYPE_LABELS[plan.taskType]} plan
          </span>
          <p className="text-sm text-text-primary mt-0.5">{plan.summary}</p>
        </div>
        {contradicted ? (
          <StatusBadge tone="warning">Doesn&apos;t match your files</StatusBadge>
        ) : (
          confidence && (
            <StatusBadge tone={CONFIDENCE_TONE[confidence]}>
              {CONFIDENCE_LABEL[confidence]}
            </StatusBadge>
          )
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
