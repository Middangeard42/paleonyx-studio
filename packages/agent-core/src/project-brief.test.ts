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
    expect(composed).toContain("In a web browser");
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

  it("states the platform plainly when the user picked one", () => {
    const composed = composeProjectBrief(brief({ platform: "command-line" }));
    expect(composed).toContain("In a terminal");
    expect(composed).not.toContain("does not know yet");
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
