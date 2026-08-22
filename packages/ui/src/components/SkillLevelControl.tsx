import clsx from "clsx";
import type { SkillLevel } from "@paleonyx/shared-types";
import { SKILL_LEVEL_DESCRIPTORS } from "@paleonyx/shared-types";
import { Tooltip } from "../primitives/Tooltip.js";

export interface SkillLevelControlProps {
  value: SkillLevel;
  onChange: (level: SkillLevel) => void;
}

/**
 * Explicit, always-visible control (DESIGN.md §6.1) — the app may
 * suggest a level from behavior later, but changing it is always this:
 * a direct, deliberate user action, never inferred and silently applied.
 */
export function SkillLevelControl({ value, onChange }: SkillLevelControlProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Skill level"
      className="inline-flex items-center rounded-md border border-border-subtle bg-surface-2 p-0.5"
    >
      {SKILL_LEVEL_DESCRIPTORS.map((descriptor) => (
        <Tooltip key={descriptor.level} label={descriptor.description}>
          <button
            type="button"
            role="radio"
            aria-checked={descriptor.level === value}
            onClick={() => onChange(descriptor.level)}
            className={clsx(
              "rounded px-2 py-0.5 text-xs font-medium transition-colors duration-micro",
              descriptor.level === value
                ? "bg-accent text-accent-foreground"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            {descriptor.label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
