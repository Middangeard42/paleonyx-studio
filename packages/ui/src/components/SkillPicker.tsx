import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { AlertTriangle, BookMarked, ChevronDown } from "lucide-react";
import type { Skill, SkillProblem } from "@paleonyx/shared-types";
import { Button } from "../primitives/Button.js";
import { TASK_TYPE_LABELS } from "./task-type-labels.js";

export interface SkillPickerProps {
  skills: readonly Skill[];
  /** Project skill files that could not be used, and why. */
  problems: readonly SkillProblem[];
  /**
   * Fills the task form from a skill. It does not run anything: the
   * instructions land in the task box, where they can be read and edited
   * before Run is pressed.
   */
  onUse: (skill: Skill) => void;
  /** Saves what is in the task box as a project skill. */
  onSave?: (title: string) => Promise<string>;
  /** False when there is nothing in the task box worth saving. */
  canSave: boolean;
  /** The skill most recently used, to label what the form now holds. */
  active?: Skill | null;
}

/**
 * Reusable task templates (PRD.md §4).
 *
 * Choosing a skill fills the form rather than running it, and that is a
 * safety property as much as a convenience. Project skills are read from
 * the repository, which is often someone else's; the words about to be
 * sent to the agent should be in front of the user, editable, with the
 * usual Run button between them and the model.
 */
export function SkillPicker({
  skills,
  problems,
  onUse,
  onSave,
  canSave,
  active = null,
}: SkillPickerProps) {
  const [open, setOpen] = useState(false);
  const builtin = skills.filter((skill) => skill.source === "builtin");
  const project = skills.filter((skill) => skill.source === "project");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <Button variant="secondary" size="sm">
              <BookMarked size={12} />
              Use a skill
              <ChevronDown size={12} />
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="z-50 max-h-96 w-80 overflow-auto rounded-md border border-border-subtle bg-surface-1 p-1.5 shadow-lg"
            >
              <SkillGroup
                heading="Built in"
                skills={builtin}
                onUse={(skill) => {
                  onUse(skill);
                  setOpen(false);
                }}
              />
              <SkillGroup
                heading="From this project"
                skills={project}
                empty="None yet. Save a task as a skill, or add Markdown files to .paleonyx/skills/."
                onUse={(skill) => {
                  onUse(skill);
                  setOpen(false);
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        {onSave && <SaveSkill onSave={onSave} disabled={!canSave} />}
      </div>

      {active?.source === "project" && (
        <p className="text-xs text-status-warning">
          From this project ({active.path}) — read the task below before running it.
        </p>
      )}

      {problems.length > 0 && <SkillProblems problems={problems} />}
    </div>
  );
}

function SkillGroup({
  heading,
  skills,
  onUse,
  empty,
}: {
  heading: string;
  skills: readonly Skill[];
  onUse: (skill: Skill) => void;
  empty?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-1">
      <p className="px-1.5 py-1 text-xs uppercase tracking-wide text-text-tertiary">
        {heading}
      </p>
      {skills.length === 0 && empty && (
        <p className="px-1.5 pb-1 text-xs text-text-tertiary">{empty}</p>
      )}
      {skills.map((skill) => (
        <button
          key={skill.id}
          type="button"
          onClick={() => onUse(skill)}
          className="flex flex-col gap-0.5 rounded px-1.5 py-1.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm text-text-primary">{skill.title}</span>
            <span className="shrink-0 text-xs text-text-tertiary">
              {TASK_TYPE_LABELS[skill.taskType]}
            </span>
          </span>
          {skill.description && (
            <span className="text-xs text-text-secondary">{skill.description}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function SaveSkill({
  onSave,
  disabled,
}: {
  onSave: (title: string) => Promise<string>;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        {message && (
          <span
            className={
              message.tone === "ok" ? "text-xs text-text-tertiary" : "text-xs text-status-danger"
            }
          >
            {message.text}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          title={disabled ? "Write a task first, then save it for reuse." : undefined}
          onClick={() => {
            setMessage(null);
            setEditing(true);
          }}
        >
          Save as skill
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!title.trim()) return;
        setSaving(true);
        try {
          const path = await onSave(title.trim());
          setMessage({ tone: "ok", text: `Saved to ${path}` });
          setEditing(false);
          setTitle("");
        } catch (error) {
          setMessage({ tone: "error", text: (error as Error).message });
          setEditing(false);
        } finally {
          setSaving(false);
        }
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Name this skill"
        aria-label="Skill name"
        className="w-40 rounded-md border border-border-subtle bg-surface-2 px-2 py-1 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <Button type="submit" variant="primary" size="sm" disabled={saving || !title.trim()}>
        {saving ? "Saving…" : "Save"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  );
}

function SkillProblems({ problems }: { problems: readonly SkillProblem[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-2 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 text-text-secondary"
      >
        <AlertTriangle size={12} className="text-status-warning" />
        {problems.length === 1
          ? "1 skill file couldn't be used"
          : `${problems.length} skill files couldn't be used`}
      </button>
      {expanded && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {problems.map((problem, index) => (
            <li key={`${problem.path}:${index}`} className="text-text-secondary">
              <span className="font-mono text-text-primary">{problem.path}</span>
              {" — "}
              {problem.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
