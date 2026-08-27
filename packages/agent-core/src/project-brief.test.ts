import { describe, expect, it } from "vitest";
import { EMPTY_PROJECT_BRIEF } from "@paleonyx/shared-types";
import type { ProjectBrief } from "@paleonyx/shared-types";
import { composeProjectBrief, isBriefRunnable } from "./project-brief.js";

function brief(overrides: Partial<ProjectBrief> = {}): ProjectBrief {
  return { ...EMPTY_PROJECT_BRIEF, description: "a habit tracker", ...overrides };
}

/** The "Where it runs:" section, which is what the platform answers steer. */
function platformSection(composed: string): string {
  const section = composed
    .split(/\n\n+/)
    .find((part) => part.startsWith("Where it runs:"));
  if (!section) throw new Error("no platform section in the composed brief");
  return section;
}

describe("composeProjectBrief", () => {
  it("carries every answered field into the request", () => {
    const composed = composeProjectBrief(
      brief({
        audience: "my running club",
        platforms: ["web"],
        features: ["log a run", "show a weekly total"],
      })
    );
    expect(composed).toContain("a habit tracker");
    expect(composed).toContain("my running club");
    expect(composed).toContain("in a web browser");
    expect(composed).toContain("- log a run");
    expect(composed).toContain("- show a weekly total");
  });

  it("omits fields the user left blank rather than labelling nothing", () => {
    const composed = composeProjectBrief(brief());
    expect(composed).not.toContain("Who will use it");
    expect(composed).not.toContain("It must be able to");
  });

  // A textarea that was typed in and cleared leaves whitespace behind,
  // which is truthy — the bug this guards is a "Who will use it:  "
  // heading with nothing under it.
  it("treats a field holding only whitespace as blank", () => {
    const composed = composeProjectBrief(brief({ audience: "  \n\t " }));
    expect(composed).not.toContain("Who will use it");
  });

  it("drops blank feature rows instead of emitting empty bullets", () => {
    const composed = composeProjectBrief(
      brief({ features: ["log a run", "   ", ""] })
    );
    expect(composed).toContain("- log a run");
    expect(composed).not.toMatch(/-\s*$/m);
  });

  it("omits the feature list entirely when every row is blank", () => {
    const composed = composeProjectBrief(brief({ features: ["", "  "] }));
    expect(composed).not.toContain("It must be able to");
  });
});

describe("composeProjectBrief platform targets", () => {
  // "Not sure yet" is the answer a beginner is most likely to give, so
  // it has to produce a recommendation rather than a silent default.
  it("asks the agent to choose and justify when the platform is undecided", () => {
    const composed = composeProjectBrief(brief({ platforms: ["undecided"] }));
    expect(composed).toContain("does not know yet");
    expect(composed).toContain("why you chose it");
  });

  // Skipping the question and answering "not sure" mean the same thing;
  // an unanswered question must not silently become a target.
  it("treats no answer the same as undecided", () => {
    expect(platformSection(composeProjectBrief(brief({ platforms: [] })))).toBe(
      platformSection(composeProjectBrief(brief({ platforms: ["undecided"] })))
    );
  });

  // The regression this guards: asked for a phone app, the model built
  // an ordinary desktop web page, because the task instructions argued
  // for a single HTML file at length and the platform contributed one
  // clause. A picked platform has to carry real weight.
  it("gives a picked platform enough guidance to compete with the general advice", () => {
    for (const platform of ["web", "desktop", "android", "ios", "command-line"] as const) {
      const section = platformSection(composeProjectBrief(brief({ platforms: [platform] })));
      expect(section.length, `guidance for ${platform} is too thin`).toBeGreaterThan(80);
    }
  });

  it("asks either phone target to be laid out for a phone, and to disclose a web substitution", () => {
    for (const platform of ["android", "ios"] as const) {
      const section = platformSection(composeProjectBrief(brief({ platforms: [platform] })));
      expect(section).toMatch(/touch|one column|viewport/i);
      // Building a web page for a phone is often right; doing it
      // without saying so is what this forbids.
      expect(section).toMatch(/explanation/i);
    }
  });

  it("names the two phone targets distinctly", () => {
    const android = platformSection(composeProjectBrief(brief({ platforms: ["android"] })));
    const ios = platformSection(composeProjectBrief(brief({ platforms: ["ios"] })));
    expect(android).toContain("Android");
    expect(ios).toContain("iPhone");
    expect(android).not.toBe(ios);
  });

  // Two native apps would satisfy the literal request and be useless as
  // a starting point. Several targets asks for one thing covering them.
  it("asks for a single thing covering every target when several are picked", () => {
    const section = platformSection(
      composeProjectBrief(brief({ platforms: ["android", "ios"] }))
    );
    expect(section).toContain("an Android phone and an iPhone");
    expect(section).toMatch(/one thing that runs on all of them/i);
    expect(section).not.toMatch(/separate project per target[^.]*\bdo\b/i);
    // A phone is among the targets, so phone layout still applies.
    expect(section).toMatch(/touch-sized/i);
  });

  it("lists three targets readably", () => {
    const section = platformSection(
      composeProjectBrief(brief({ platforms: ["web", "android", "ios"] }))
    );
    expect(section).toContain("a web browser, an Android phone and an iPhone");
  });

  // A user on Windows who picks iOS is asking for something their
  // machine cannot build at all. Better heard from the agent than from
  // a failing build.
  it("surfaces the toolchain each native target would require", () => {
    const section = platformSection(
      composeProjectBrief(brief({ platforms: ["android", "ios"] }))
    );
    expect(section).toContain("Android Studio");
    expect(section).toMatch(/Mac running Xcode/i);
  });

  it("omits the toolchain note when no target has one", () => {
    const section = platformSection(
      composeProjectBrief(brief({ platforms: ["web", "command-line"] }))
    );
    expect(section).not.toContain("Bear in mind");
  });

  it("ignores a target picked twice", () => {
    const section = platformSection(
      composeProjectBrief(brief({ platforms: ["web", "web"] }))
    );
    // Deduplicated down to one, so it reads as the sole-target guidance.
    expect(section).toContain("in a web browser");
    expect(section).not.toMatch(/several targets/i);
  });
});

describe("isBriefRunnable", () => {
  it("requires a description", () => {
    expect(isBriefRunnable(EMPTY_PROJECT_BRIEF)).toBe(false);
    expect(isBriefRunnable({ ...EMPTY_PROJECT_BRIEF, description: " " })).toBe(false);
    expect(isBriefRunnable(brief())).toBe(true);
  });

  it("does not require anything else", () => {
    expect(isBriefRunnable(brief({ audience: "", features: [] }))).toBe(true);
  });
});

describe("contradictory platform answers", () => {
  // The wizard clears one when the other is picked, so this should not
  // arise — but the type allows it, and the wrong resolution loses a
  // real answer while still producing a plausible-looking brief.
  it("keeps the specific target when 'not sure' is present alongside one", () => {
    const composed = composeProjectBrief(
      brief({ platforms: ["undecided", "android"] })
    );
    const section = platformSection(composed);
    expect(section).toContain("Android");
    expect(section).not.toContain("does not know yet");
  });
});
