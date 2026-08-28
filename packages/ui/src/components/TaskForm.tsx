import clsx from "clsx";
import type { AgentTaskType } from "@paleonyx/shared-types";
import { taskProducesEdits } from "@paleonyx/shared-types";
import { Button } from "../primitives/Button.js";

const TASK_TYPES: { value: AgentTaskType; label: string; placeholder: string }[] = [
  {
    value: "explain",
    label: "Explain",
    placeholder: "What would you like explained about the selected file(s)?",
  },
  {
    value: "bug-fix",
    label: "Bug Fix",
    placeholder: "Describe the bug you're seeing…",
  },
  {
    value: "refactor",
    label: "Refactor",
    placeholder: "What should be restructured, and what's wrong with it now?",
  },
  {
    value: "write-tests",
    label: "Write Tests",
    placeholder: "What should be tested? Leave blank to cover the file as a whole.",
  },
  {
    value: "document",
    label: "Document",
    placeholder: "What needs documenting? Leave blank to document the whole file.",
  },
];

export interface TaskFormProps {
  taskType: AgentTaskType;
  onTaskTypeChange: (type: AgentTaskType) => void;
  instructions: string;
  onInstructionsChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  contextFileCount: number;
  /**
   * False under read-only. Every task except Explain exists to produce a
   * diff, so offering one when the agent may not propose any would be a
   * control that cannot do its job.
   */
  canProposeEdits?: boolean;
}

/**
 * Guided task form, not just freeform prompting (PRD.md §3 journey 5).
 *
 * Lists only the task types that make sense against code already open.
 * New Project and Design Change are reached from where they belong — the
 * wizard and the preview — and offering them here would be offering
 * controls with nothing to act on.
 */
export function TaskForm({
  taskType,
  onTaskTypeChange,
  instructions,
  onInstructionsChange,
  onSubmit,
  disabled,
  contextFileCount,
  canProposeEdits = true,
}: TaskFormProps) {
  const active = TASK_TYPES.find((t) => t.value === taskType) ?? TASK_TYPES[0]!;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-2"
    >
      <div role="radiogroup" aria-label="Task type" className="flex flex-wrap gap-1">
        {TASK_TYPES.map((type) => {
          const unavailable = taskProducesEdits(type.value) && !canProposeEdits;
          return (
            <button
              key={type.value}
              type="button"
              role="radio"
              aria-checked={type.value === taskType}
              disabled={unavailable}
              title={
                unavailable ? "Not available while this project is read-only." : undefined
              }
              onClick={() => onTaskTypeChange(type.value)}
              className={clsx(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-micro",
                unavailable && "cursor-not-allowed opacity-40",
                type.value === taskType
                  ? "bg-accent text-accent-foreground"
                  : "bg-surface-2 text-text-secondary hover:text-text-primary"
              )}
            >
              {type.label}
            </button>
          );
        })}
      </div>
      <textarea
        value={instructions}
        onChange={(event) => onInstructionsChange(event.target.value)}
        placeholder={active.placeholder}
        rows={3}
        className="resize-none rounded-md border border-border-subtle bg-surface-2 p-2 text-sm text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-tertiary">
          {contextFileCount === 0
            ? "Add a file to context first"
            : `${contextFileCount} file${contextFileCount === 1 ? "" : "s"} in context`}
        </span>
        <Button type="submit" variant="primary" size="sm" disabled={disabled || contextFileCount === 0}>
          {disabled ? "Working…" : "Run"}
        </Button>
      </div>
    </form>
  );
}
