import { PauseCircle } from "lucide-react";
import type { AgentEscalation } from "@paleonyx/shared-types";

const REASON_LABEL: Record<AgentEscalation["reason"], string> = {
  "budget-exhausted": "Session budget exhausted",
  "ambiguous-instructions": "Instructions were ambiguous",
  "tool-failure": "A tool call failed",
  "low-confidence": "Low confidence in the result",
};

export interface EscalationBannerProps {
  escalation: AgentEscalation;
}

/**
 * Distinct visual treatment for "the agent paused itself" (DESIGN.md §6,
 * CLAUDE.md §7) — never just hedging language folded into prose.
 */
export function EscalationBanner({ escalation }: EscalationBannerProps) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 p-3">
      <PauseCircle size={16} className="mt-0.5 shrink-0 text-status-warning" />
      <div>
        <p className="text-sm font-medium text-text-primary">
          {REASON_LABEL[escalation.reason]}
        </p>
        <p className="text-xs text-text-secondary mt-0.5">{escalation.message}</p>
      </div>
    </div>
  );
}
