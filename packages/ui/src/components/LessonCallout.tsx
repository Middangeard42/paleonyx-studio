import { useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import type { SkillLevel } from "@paleonyx/shared-types";

export interface LessonCalloutProps {
  title: string;
  children: ReactNode;
  skillLevel: SkillLevel;
}

/**
 * Grounded, dismissible explainer (DESIGN.md §6.1) — expanded by default
 * below Professional, collapsed-but-available at Professional. Dismissing
 * one is per-instance state, not a global "never show these again"
 * toggle — each callout is evaluated independently.
 */
export function LessonCallout({ title, children, skillLevel }: LessonCalloutProps) {
  const [expanded, setExpanded] = useState(skillLevel !== "professional");
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="rounded-md border border-accent/30 bg-accent-muted/40">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex items-center gap-1.5 text-xs font-medium text-text-primary"
        >
          <span aria-hidden className={clsx("transition-transform", expanded && "rotate-90")}>
            ›
          </span>
          {title}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss explanation"
          className="text-text-tertiary hover:text-text-primary text-xs"
        >
          Dismiss
        </button>
      </div>
      {expanded && <div className="px-3 pb-2.5 text-sm text-text-secondary">{children}</div>}
    </div>
  );
}
