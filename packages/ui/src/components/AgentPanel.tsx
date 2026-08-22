import type { AgentTaskResult, AgentTaskType, SkillLevel } from "@paleonyx/shared-types";
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
            {props.result.plan.taskType === "bug-fix" && <DiffView diffs={props.result.diff} />}
          </section>
        )}
      </div>
    </Panel>
  );
}
