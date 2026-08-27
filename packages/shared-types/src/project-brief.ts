/**
 * What the new-project wizard collects (PRD.md §3 journey 13).
 *
 * Lives here rather than in `ui` because two packages need the same
 * shape: the form that fills it in, and the agent-core function that
 * turns it into a request. Everything except `description` is optional
 * in practice — a beginner who can only describe the idea should still
 * get a project, so the composer omits what is blank rather than
 * insisting on it.
 */
export interface ProjectBrief {
  /** What the user wants to make. The one field the wizard requires. */
  description: string;
  /** Who it is for, in the user's own words. */
  audience: string;
  /**
   * Where it should run. A list because the honest answer is often more
   * than one — "Android and iPhone" is a different instruction from
   * either alone, since covering both is what makes a web page the
   * sensible first version rather than a compromise. Empty means the
   * question went unanswered, which is treated the same as `undecided`.
   */
  platforms: ProjectPlatform[];
  /** Things it must do. Blank entries are dropped, not rendered empty. */
  features: string[];
}

export type ProjectPlatform =
  | "web"
  | "desktop"
  | "android"
  | "ios"
  | "command-line"
  /** An explicit "I don't know", which is a real answer, not a gap. */
  | "undecided";

/**
 * Chip labels for the wizard. Short noun phrases rather than sentences,
 * so a row of them scans — and named the way the user would name them
 * ("Android", "iOS"), not by any internal grouping.
 */
export const PROJECT_PLATFORM_LABELS: Record<ProjectPlatform, string> = {
  web: "Web browser",
  desktop: "Desktop app",
  android: "Android",
  ios: "iOS",
  "command-line": "Terminal",
  undecided: "Not sure yet",
};

/**
 * Answering "not sure" alongside four specific targets is contradictory,
 * so the wizard clears the rest when it is picked and clears it when
 * anything else is.
 */
export const EXCLUSIVE_PLATFORM: ProjectPlatform = "undecided";

export const EMPTY_PROJECT_BRIEF: ProjectBrief = {
  description: "",
  audience: "",
  platforms: [],
  features: [],
};
