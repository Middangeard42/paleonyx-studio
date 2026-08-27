import type { ProjectBrief, ProjectPlatform } from "@paleonyx/shared-types";

/**
 * Turns the wizard's answers into the request text a scaffold task runs
 * on (PRD.md §3 journey 13).
 *
 * Kept separate from the form so what gets asked and what gets sent can
 * be reasoned about — and tested — independently. The form's job is to
 * be answerable by someone with no vocabulary for the question; this
 * function's job is to turn those answers into something a model can act
 * on without inventing the parts that were left blank.
 */
export function composeProjectBrief(brief: ProjectBrief): string {
  const sections: string[] = [
    `Build the first version of this project.\n\nWhat it should be: ${clean(brief.description)}`,
  ];

  const audience = clean(brief.audience);
  if (audience) sections.push(`Who will use it: ${audience}`);

  sections.push(`Where it runs: ${PLATFORM_GUIDANCE[brief.platform]}`);

  const features = brief.features.map(clean).filter(Boolean);
  if (features.length > 0) {
    sections.push(
      ["It must be able to:", ...features.map((feature) => `- ${feature}`)].join("\n")
    );
  }

  return sections.join("\n\n");
}

/**
 * True when there is enough to run on. Only the description is load
 * bearing: everything else has a sensible absence, but "build me
 * something" with no subject does not.
 */
export function isBriefRunnable(brief: ProjectBrief): boolean {
  return clean(brief.description).length > 0;
}

/**
 * What each answer to "where should people use it?" actually asks for.
 *
 * One line naming the platform is not enough to steer the result. Asked
 * for a phone app, a model given only "Where it runs: On a phone."
 * produced a plain desktop web page — correctly, because the task
 * instructions spend several sentences praising a single HTML file and
 * the platform got one clause. An answer the user gave explicitly has
 * to carry at least as much weight as the general advice it competes
 * with.
 *
 * Where the honest first version is not the literal thing asked for —
 * a phone app whose toolchain a beginner cannot install — the guidance
 * says so and requires the substitution to be stated rather than made
 * quietly. Silently building something else is the "unclear agent
 * actions" failure this product exists to avoid.
 */
const PLATFORM_GUIDANCE: Record<ProjectPlatform, string> = {
  web: "in a web browser, on a computer. Build a page that opens directly — no server to start unless the idea genuinely cannot work without one.",
  desktop:
    "as an application on a computer, launched from the desktop rather than a browser tab. Pick whichever way of doing that needs the least setup on a machine that has nothing installed yet, and name that choice in `explanation`.",
  mobile:
    "on a phone. A page built for a phone screen — one column, touch-sized controls, a viewport meta tag — that the user can open in their phone's browser is usually the right first version, because a native app needs Xcode or Android Studio and hours of setup before anything runs at all. Build the phone-shaped web version unless the idea truly requires native features, and say in the first sentence of `explanation` that this is what you did and why. Do not quietly produce an ordinary desktop web page: it must be laid out for a phone.",
  "command-line":
    "in a terminal, by typing a command. Say in `explanation` exactly what to type.",
  undecided:
    "the user does not know yet. Choose whichever fits this idea best, and say in one sentence why you chose it.",
};

/**
 * Collapses the whitespace a textarea leaves behind. Without this a
 * field the user typed and then cleared arrives as "\n\n" — truthy, and
 * rendered as an empty labelled section.
 */
function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
