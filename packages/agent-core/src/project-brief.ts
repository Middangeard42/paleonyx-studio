import type { ProjectBrief, ProjectPlatform } from "@paleonyx/shared-types";

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
interface PlatformGuidance {
  /** Used when this is the only target chosen. */
  sole: string;
  /** How this target is named when several are listed together. */
  noun: string;
  /**
   * Setup this target genuinely requires, stated even when it is one of
   * several. A user on Windows who picks iOS is asking for something
   * their machine cannot build at all, and finding that out from the
   * agent beats finding it out from a failing build.
   */
  constraint?: string;
}

const PHONE_LAYOUT =
  "A page built for a phone screen — one column, touch-sized controls, a viewport meta tag — that the user opens in their phone's browser is usually the right first version, because a native app needs a large toolchain and a long setup before anything runs at all. Build the phone-shaped web version unless the idea truly requires native features, and say in the first sentence of `explanation` that this is what you did and why. Do not quietly produce an ordinary desktop web page: it must be laid out for a phone.";

const PLATFORM_GUIDANCE: Record<ProjectPlatform, PlatformGuidance> = {
  web: {
    noun: "a web browser",
    sole: "in a web browser, on a computer. Build a page that opens directly — no server to start unless the idea genuinely cannot work without one.",
  },
  desktop: {
    noun: "a desktop computer",
    sole: "as an application on a computer, launched from the desktop rather than a browser tab. Pick whichever way of doing that needs the least setup on a machine that has nothing installed yet, and name that choice in `explanation`.",
  },
  android: {
    noun: "an Android phone",
    sole: `on an Android phone. ${PHONE_LAYOUT}`,
    constraint: "a native Android app needs Android Studio installed",
  },
  ios: {
    noun: "an iPhone",
    sole: `on an iPhone. ${PHONE_LAYOUT}`,
    constraint:
      "a native iOS app can only be built on a Mac running Xcode, so on Windows or Linux it is not an option at all",
  },
  "command-line": {
    noun: "a terminal",
    sole: "in a terminal, by typing a command. Say in `explanation` exactly what to type.",
  },
  undecided: {
    noun: "anywhere",
    sole: "the user does not know yet. Choose whichever fits this idea best, and say in one sentence why you chose it.",
  },
};

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

  sections.push(`Where it runs: ${describePlatforms(brief.platforms)}`);

  const features = brief.features.map(clean).filter(Boolean);
  if (features.length > 0) {
    sections.push(
      ["It must be able to:", ...features.map((feature) => `- ${feature}`)].join("\n")
    );
  }

  return sections.join("\n\n");
}

/**
 * Several targets is a different instruction from any one of them, not
 * a list of instructions to satisfy in turn. Asked for Android and
 * iPhone, the useful answer is one thing that runs on both — which is
 * what makes a phone-shaped web page the sensible first version rather
 * than a compromise. Building two native apps would satisfy the literal
 * request and be useless as a starting point.
 */
function describePlatforms(platforms: readonly ProjectPlatform[]): string {
  // "Not sure" alongside a specific target is contradictory. The wizard
  // does not let that happen, but the type permits it, and resolving it
  // here means a slip in the form cannot silently discard a real answer
  // — which is the failure mode worth preventing, since the brief would
  // still look plausible while ignoring what the user picked.
  const chosen = dedupe(platforms).filter((platform) => platform !== "undecided");

  // Nothing picked reads the same as "not sure": the question was not
  // answered, and inventing a target from silence is exactly what the
  // undecided guidance already handles properly.
  if (chosen.length === 0) return PLATFORM_GUIDANCE.undecided.sole;

  if (chosen.length === 1) return PLATFORM_GUIDANCE[chosen[0]!].sole;

  const nouns = chosen.map((platform) => PLATFORM_GUIDANCE[platform].noun);
  const constraints = chosen
    .map((platform) => PLATFORM_GUIDANCE[platform].constraint)
    .filter((constraint): constraint is string => Boolean(constraint));

  const parts = [
    `several targets — ${formatList(nouns)}. Build one thing that runs on all of them rather than a separate project per target; for a first version that usually means a web page, and if any target is a phone it must be laid out for a phone screen: one column, touch-sized controls, a viewport meta tag.`,
  ];
  if (constraints.length > 0) {
    parts.push(`Bear in mind that ${formatList(constraints)}.`);
  }
  parts.push(
    "Say in the first sentence of `explanation` what you built and which of these targets it covers."
  );
  return parts.join(" ");
}

/**
 * True when there is enough to run on. Only the description is load
 * bearing: everything else has a sensible absence, but "build me
 * something" with no subject does not.
 */
export function isBriefRunnable(brief: ProjectBrief): boolean {
  return clean(brief.description).length > 0;
}

function dedupe(platforms: readonly ProjectPlatform[]): ProjectPlatform[] {
  return [...new Set(platforms)];
}

function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Collapses the whitespace a textarea leaves behind. Without this a
 * field the user typed and then cleared arrives as "\n\n" — truthy, and
 * rendered as an empty labelled section.
 */
function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
