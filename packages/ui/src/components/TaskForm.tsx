import clsx from "clsx";
import type { AgentTaskType } from "@paleonyx/shared-types";
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
   * False under read-only. The Bug Fix task exists to produce a diff, so
   * offering it when the agent may not propose one would be a control
   * that cannot do its job.
   */
  canProposeEdits?: boolean;
}

/**
 * Guided task form, not just freeform prompting (PRD.md §3 journey 5) —
 * v0 supports the two read/suggest-only task types (PRD.md §9 decision 1).
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
      <div role="radiogroup" aria-label="Task type" className="flex gap-1">
        {TASK_TYPES.map((type) => {
          const unavailable = type.value === "bug-fix" && !canProposeEdits;
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
