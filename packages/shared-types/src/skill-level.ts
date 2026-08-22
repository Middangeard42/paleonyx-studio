/**
 * Skill-level adaptation is a first-class, cross-cutting concept (see
 * CLAUDE.md §5, DESIGN.md §6.1) — it shapes explanation depth and tone,
 * never capability. Every skill level can do everything; only the
 * verbosity and teaching depth of agent-core's responses change.
 */
export type SkillLevel = "new-to-coding" | "experienced" | "professional";

export const SKILL_LEVELS: readonly SkillLevel[] = [
  "new-to-coding",
  "experienced",
  "professional",
];

/**
 * Chosen explicitly during first-run onboarding (PRD.md §3 journey 1) —
 * never a silent real default. This value exists only as the
 * pre-onboarding-completion fallback.
 */
export const DEFAULT_SKILL_LEVEL: SkillLevel = "experienced";

export interface SkillLevelDescriptor {
  level: SkillLevel;
  label: string;
  description: string;
}

export const SKILL_LEVEL_DESCRIPTORS: readonly SkillLevelDescriptor[] = [
  {
    level: "new-to-coding",
    label: "New to coding",
    description:
      "Explanations walk through reasoning step by step and define terms as they come up.",
  },
  {
    level: "experienced",
    label: "Experienced",
    description:
      "Explanations assume working knowledge of common patterns, light on ceremony.",
  },
  {
    level: "professional",
    label: "Professional",
    description:
      "Terse, high-signal output by default; deeper explanation available on request.",
  },
];
