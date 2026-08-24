import type { ProjectBrief } from "@paleonyx/shared-types";
import { PROJECT_PLATFORM_LABELS } from "@paleonyx/shared-types";

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

  // "Not sure yet" is a real answer, not a missing one — a beginner
  // often cannot pick, and the useful response is a recommendation with
  // a reason rather than a silent default.
  sections.push(
    brief.platform === "undecided"
      ? "Where it runs: the user does not know yet. Choose whichever fits this idea best, and say in one sentence why you chose it."
      : `Where it runs: ${PROJECT_PLATFORM_LABELS[brief.platform]}.`
  );

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
 * Collapses the whitespace a textarea leaves behind. Without this a
 * field the user typed and then cleared arrives as "\n\n" — truthy, and
 * rendered as an empty labelled section.
 */
function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
