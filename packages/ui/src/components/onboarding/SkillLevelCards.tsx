import clsx from "clsx";
import { Check } from "lucide-react";
import type { SkillLevel } from "@paleonyx/shared-types";
import { SKILL_LEVEL_DESCRIPTORS } from "@paleonyx/shared-types";

export interface SkillLevelCardsProps {
  value: SkillLevel;
  onChange: (level: SkillLevel) => void;
}

/**
 * The onboarding presentation of skill level: full cards with the
 * descriptor as body text, rather than the compact status-bar control
 * (DESIGN.md §6.3). Same underlying value, sized to match the weight of
 * the decision being made.
 */
export function SkillLevelCards({ value, onChange }: SkillLevelCardsProps) {
  return (
    <div role="radiogroup" aria-label="Skill level" className="flex flex-col gap-2">
      {SKILL_LEVEL_DESCRIPTORS.map((descriptor) => {
        const selected = descriptor.level === value;
        return (
          <button
            key={descriptor.level}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(descriptor.level)}
            className={clsx(
              "flex items-start gap-3 rounded-md border p-3 text-left transition-colors duration-micro",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              selected
                ? "border-accent bg-accent-muted"
                : "border-border-subtle bg-surface-2 hover:bg-surface-3"
            )}
          >
            <span
              aria-hidden
              className={clsx(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                selected ? "border-accent bg-accent" : "border-border-strong"
              )}
            >
              {selected && <Check size={11} className="text-accent-foreground" />}
            </span>
            <span>
              <span className="block text-sm font-medium text-text-primary">
                {descriptor.label}
              </span>
              <span className="mt-0.5 block text-xs text-text-secondary">
                {descriptor.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
