import { describe, expect, it } from "vitest";
import { EMPTY_PROJECT_BRIEF } from "@paleonyx/shared-types";
import type { ProjectBrief } from "@paleonyx/shared-types";
import { composeProjectBrief, isBriefRunnable } from "./project-brief.js";

function brief(overrides: Partial<ProjectBrief> = {}): ProjectBrief {
  return { ...EMPTY_PROJECT_BRIEF, description: "a habit tracker", ...overrides };
}

describe("composeProjectBrief", () => {
  it("carries every answered field into the request", () => {
    const composed = composeProjectBrief(
      brief({
        audience: "my running club",
        platform: "web",
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
  // which is truthy — the bug this guards is an "Who will use it:  "
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

  // "Not sure yet" is the answer a beginner is most likely to give, so
  // it has to produce a recommendation rather than a silent default.
  it("asks the agent to choose and justify when the platform is undecided", () => {
    const composed = composeProjectBrief(brief({ platform: "undecided" }));
    expect(composed).toContain("does not know yet");
    expect(composed).toContain("why you chose it");
  });

  it("says what a chosen platform actually asks for", () => {
    const composed = composeProjectBrief(brief({ platform: "command-line" }));
    expect(composed).toContain("terminal");
    expect(composed).not.toContain("does not know yet");
  });

  // The regression this guards: asked for a phone app, the model built
  // an ordinary desktop web page, because the task instructions argued
  // for a single HTML file at length and the platform contributed one
  // clause. A picked platform has to carry real weight.
  it("gives a picked platform enough guidance to compete with the general advice", () => {
    for (const platform of ["web", "desktop", "mobile", "command-line"] as const) {
      const composed = composeProjectBrief(brief({ platform }));
      const line = composed
        .split(/\n\n+/)
        .find((section) => section.startsWith("Where it runs:"));
      expect(line, `no platform section for ${platform}`).toBeDefined();
      expect(line!.length, `guidance for ${platform} is too thin`).toBeGreaterThan(80);
    }
  });

  it("asks a phone build to be laid out for a phone, and to disclose a web substitution", () => {
    const composed = composeProjectBrief(brief({ platform: "mobile" }));
    expect(composed).toContain("phone");
    expect(composed).toMatch(/touch|one column|viewport/i);
    // Building a web page for a phone is often right; doing it without
    // saying so is what this test forbids.
    expect(composed).toMatch(/say .*explanation|explanation.*why/i);
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
