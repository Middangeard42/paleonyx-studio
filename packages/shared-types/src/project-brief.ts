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
  /** Where it should run. `undecided` is an honest, supported answer. */
  platform: ProjectPlatform;
  /** Things it must do. Blank entries are dropped, not rendered empty. */
  features: string[];
}

export type ProjectPlatform =
  | "web"
  | "desktop"
  | "mobile"
  | "command-line"
  | "undecided";

/**
 * Labels are the wizard's question copy, not enum names — "where will
 * people use this?" is answerable by someone who has never heard the
 * word "platform".
 */
export const PROJECT_PLATFORM_LABELS: Record<ProjectPlatform, string> = {
  web: "In a web browser",
  desktop: "As a desktop app",
  mobile: "On a phone",
  "command-line": "In a terminal",
  undecided: "Not sure yet",
};

export const EMPTY_PROJECT_BRIEF: ProjectBrief = {
  description: "",
  audience: "",
  platform: "undecided",
  features: [],
};
