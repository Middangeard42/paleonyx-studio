import type { AgentTaskType } from "./agent.js";

/**
 * A reusable task template (PRD.md §4: "simple skill system").
 *
 * Deliberately narrow in what it can say. A skill names a task type and
 * supplies the words the user would otherwise type — nothing else. It
 * cannot change the permission mode, widen the command allowlist, raise
 * a budget, or target files by itself. That boundary is the point:
 * project skills are read from the repository, and a repository is often
 * someone else's, so a skill must never be a way to grant the agent more
 * than the user already has.
 */
export interface Skill {
  /** Unique across sources — `builtin:<name>` or `project:<name>`. */
  id: string;
  /** The slug from the file, e.g. `find-bugs`. */
  name: string;
  title: string;
  description: string;
  taskType: SkillTaskType;
  /** What gets placed in the task box. Always shown before it runs. */
  instructions: string;
  source: SkillSource;
  /** Where a project skill was read from, for the user and for errors. */
  path?: string;
}

export type SkillSource = "builtin" | "project";

/**
 * The task types a skill may use: the ones the task form offers.
 *
 * New Project and Design Change are excluded because each needs input a
 * template cannot carry — a wizard's answers, a clicked element.
 */
export type SkillTaskType = Extract<
  AgentTaskType,
  "explain" | "bug-fix" | "refactor" | "write-tests" | "document"
>;

export const SKILL_TASK_TYPES: readonly SkillTaskType[] = [
  "explain",
  "bug-fix",
  "refactor",
  "write-tests",
  "document",
];

/** A project skill file that could not be used, and why. */
export interface SkillProblem {
  path: string;
  error: string;
}
