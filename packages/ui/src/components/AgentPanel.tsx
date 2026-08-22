import type { AgentTaskResult, AgentTaskType, SkillLevel } from "@paleonyx/shared-types";
import { Button } from "../primitives/Button.js";
import { Panel } from "../primitives/Panel.js";
import { SkillLevelControl } from "./SkillLevelControl.js";
import { ContextPanel } from "./ContextPanel.js";
import { TaskForm } from "./TaskForm.js";
import { TaskPlanCard } from "./TaskPlanCard.js";
import { LessonCallout } from "./LessonCallout.js";
import { DiffView } from "./DiffView.js";
import { EscalationBanner } from "./EscalationBanner.js";

export interface AgentPanelProps {
  skillLevel: SkillLevel;
  onSkillLevelChange: (level: SkillLevel) => void;
  contextFiles: string[];
  onRemoveContextFile: (path: string) => void;
  onAddContextFile: () => void;
  taskType: AgentTaskType;
  onTaskTypeChange: (type: AgentTaskType) => void;
  instructions: string;
  onInstructionsChange: (value: string) => void;
  onSubmit: () => void;
  /** e.g. "Reading 2 files…" / "Thinking…" — a real step, not a bare spinner (DESIGN.md §5.2). */
  statusMessage: string | null;
  result: AgentTaskResult | null;
  /**
   * The approval gate. Absent means this surface cannot write at all —
   * which is how `apps/web` runs, having no filesystem or git behind it.
   * When present, applying is always this explicit press: the agent
   * proposes, the user decides (CLAUDE.md §6).
   */
  onApply?: () => void;
  applying?: boolean;
  applyError?: string | null;
  applied?: boolean;
  /**
   * True when the files have changed since this was proposed, so the
   * diff no longer fits. Detected up front rather than on failure — a
   * proposal that cannot land should not present a button that looks
   * like it will.
   */
  stale?: boolean;
  /** Re-runs the same task against the current files. */
  onRerun?: () => void;
  /** False under read-only; disables task types that require a diff. */
  canProposeEdits?: boolean;
}

export function AgentPanel(props: AgentPanelProps) {
  const running = props.statusMessage !== null;

  return (
    <Panel
      title="Agent"
      actions={<SkillLevelControl value={props.skillLevel} onChange={props.onSkillLevelChange} />}
    >
      <div className="flex flex-col gap-4">
        <section>
          <h3 className="text-xs font-medium text-text-tertiary mb-1.5">Context</h3>
          <ContextPanel
            files={props.contextFiles}
            onRemove={props.onRemoveContextFile}
            onAdd={props.onAddContextFile}
          />
        </section>

        <section>
          <h3 className="text-xs font-medium text-text-tertiary mb-1.5">Task</h3>
          <TaskForm
            taskType={props.taskType}
            onTaskTypeChange={props.onTaskTypeChange}
            instructions={props.instructions}
            onInstructionsChange={props.onInstructionsChange}
            onSubmit={props.onSubmit}
            disabled={running}
            contextFileCount={props.contextFiles.length}
            canProposeEdits={props.canProposeEdits}
          />
        </section>

        {props.statusMessage && (
          <p className="text-xs text-text-secondary flex items-center gap-1.5" role="status">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" aria-hidden />
            {props.statusMessage}
          </p>
        )}

        {props.result?.escalation && <EscalationBanner escalation={props.result.escalation} />}

        {props.result && !props.result.escalation && (
          <section className="flex flex-col gap-2">
            <TaskPlanCard plan={props.result.plan} confidence={props.result.confidence} />
            <LessonCallout title="Why this answer" skillLevel={props.skillLevel}>
              {props.result.explanation}
            </LessonCallout>
            {props.result.plan.taskType === "bug-fix" && (
              <>
                <DiffView diffs={props.result.diff} />
                {props.onApply && props.result.diff.length > 0 && (
                  <ApplyGate
                    onApply={props.onApply}
                    applying={props.applying ?? false}
                    applied={props.applied ?? false}
                    error={props.applyError ?? null}
                    stale={props.stale ?? false}
                    onRerun={props.onRerun}
                  />
                )}
              </>
            )}
          </section>
        )}
      </div>
    </Panel>
  );
}

/**
 * Applying is a distinct, deliberate action — never implicit in closing a
 * panel or moving on (DESIGN.md §6.2). The copy states plainly what the
 * press will do and that it stays reversible, because a user who
 * understands they can undo is a user who can actually review rather
 * than rubber-stamp.
 */
function ApplyGate({
  onApply,
  applying,
  applied,
  error,
  stale,
  onRerun,
}: {
  onApply: () => void;
  applying: boolean;
  applied: boolean;
  error: string | null;
  stale: boolean;
  onRerun?: () => void;
}) {
  if (applied) {
    return (
      <p className="rounded-md border border-status-success/40 bg-status-success/10 p-2.5 text-xs text-text-secondary">
        Applied and recorded. You can undo it from the History panel.
      </p>
    );
  }

  // A stale proposal was written against a version of the file that no
  // longer exists. Saying only "this can't be applied" leaves the user
  // stuck holding something broken; the useful information is that their
  // own edit is the reason, that it is safe, and what to do next
  // (DESIGN.md §5.3).
  if (stale) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 p-2.5">
        <p className="text-xs text-text-secondary">
          You&apos;ve edited these files since this was suggested, so it no
          longer fits. Your changes are untouched — this suggestion is just out
          of date now.
        </p>
        {onRerun && (
          <Button variant="secondary" size="sm" onClick={onRerun} className="self-start">
            Suggest a fix for the current version
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p className="rounded-md border border-status-warning/40 bg-status-warning/10 p-2.5 text-xs text-text-secondary">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-tertiary">
          Nothing is written until you apply.
        </span>
        <Button variant="primary" size="sm" onClick={onApply} disabled={applying}>
          {applying ? "Applying…" : "Apply change"}
        </Button>
      </div>
    </div>
  );
}
