import { describe, expect, it } from "vitest";
import type { DesignSelection } from "@paleonyx/shared-types";
import { composeDesignRequest, isSelectionLocatable } from "./design-request.js";

function selection(overrides: Partial<DesignSelection> = {}): DesignSelection {
  return {
    page: "index.html",
    tag: "BUTTON",
    id: "count",
    classes: ["cta", "primary"],
    text: "Count Chickens",
    path: ["body", "div.app", "button.cta"],
    rect: { x: 24, y: 88, width: 140.4, height: 36.2 },
    ...overrides,
  };
}

describe("composeDesignRequest", () => {
  it("describes what was clicked and what was asked for", () => {
    const request = composeDesignRequest(selection(), "make it bigger and green");
    expect(request).toContain("index.html");
    expect(request).toContain("<button>");
    expect(request).toContain('Its id is "count"');
    expect(request).toContain("cta, primary");
    expect(request).toContain('"Count Chickens"');
    expect(request).toContain("body > div.app > button.cta");
    expect(request).toContain("make it bigger and green");
  });

  it("rounds the measured size rather than emitting sub-pixel noise", () => {
    const request = composeDesignRequest(selection(), "resize it");
    expect(request).toContain("140 pixels wide by 36 pixels tall");
    expect(request).not.toContain("140.4");
    expect(request).not.toContain("36.2");
  });

  it("omits facts the element does not have", () => {
    const request = composeDesignRequest(
      selection({ id: null, classes: [], text: "" }),
      "move it"
    );
    expect(request).not.toContain("Its id is");
    expect(request).not.toContain("Its classes are");
    expect(request).not.toContain("The text inside it reads");
  });

  // The facts describe the running page, not the source. Saying so is
  // what keeps the agent searching instead of inventing a file path.
  it("tells the agent these are observations, not a source location", () => {
    const request = composeDesignRequest(selection(), "make it green");
    expect(request).toMatch(/not from the source/i);
    expect(request).toMatch(/search the project/i);
  });

  // Editing a lookalike is worse than reporting failure: it changes
  // something the user did not point at, in a mode where they are
  // pointing precisely because they cannot name the file.
  it("forbids guessing when the element cannot be found", () => {
    const request = composeDesignRequest(selection(), "make it green");
    expect(request).toMatch(/change nothing/i);
    expect(request).toMatch(/looks similar/i);
  });

  it("asks which match was chosen when several are possible", () => {
    const request = composeDesignRequest(selection(), "make it green");
    expect(request).toMatch(/more than one place/i);
  });

  // Source tagging does not exist yet, but when it does an exact
  // location must replace the search instructions rather than sit
  // alongside them — otherwise the agent is invited to second-guess it.
  it("drops the search instructions entirely when the source is known", () => {
    const request = composeDesignRequest(
      selection({ source: { path: "src/app.js", line: 42 } }),
      "make it green"
    );
    expect(request).toContain("src/app.js line 42");
    expect(request).not.toMatch(/search the project/i);
    expect(request).not.toMatch(/not from the source/i);
  });

  it("collapses whitespace the user's input carries in", () => {
    const request = composeDesignRequest(
      selection({ text: "  Count\n  Chickens  " }),
      "  make   it\n\ngreen  "
    );
    expect(request).toContain('"Count Chickens"');
    expect(request).toContain("make it green");
  });
});

describe("isSelectionLocatable", () => {
  it("accepts a selection with anything to search for", () => {
    expect(isSelectionLocatable(selection())).toBe(true);
    expect(isSelectionLocatable(selection({ id: null, classes: [] }))).toBe(true);
    expect(isSelectionLocatable(selection({ id: null, text: "" }))).toBe(true);
  });

  // A bare <div> with no id, class, or text gives the agent nothing to
  // search for. Running anyway spends a model call to fail.
  it("rejects a selection with no distinguishing features", () => {
    expect(
      isSelectionLocatable(
        selection({ id: null, classes: [], text: "   ", tag: "DIV" })
      )
    ).toBe(false);
  });

  it("accepts a featureless element when its source is known", () => {
    expect(
      isSelectionLocatable(
        selection({
          id: null,
          classes: [],
          text: "",
          source: { path: "src/app.js", line: 1 },
        })
      )
    ).toBe(true);
  });
});

/**
 * Relative size requests.
 *
 * Asked to make a button "2x larger", the agent read the stylesheet,
 * found no width or height, and invented 220x42 — a size the button
 * never had. The rendered size was already being measured and sent; the
 * prompt just never said it was the answer to that question.
 */
describe("a size request with nothing in the stylesheet", () => {
  it("presents the measurement as the element's current size", () => {
    const request = composeDesignRequest(selection(), "make it 2x larger");
    expect(request).toMatch(/current size on screen/i);
    expect(request).toContain("140 pixels wide by 36 pixels tall");
  });

  it("tells the agent to compute from it rather than invent a starting point", () => {
    const request = composeDesignRequest(selection(), "make it 2x larger");
    expect(request).toMatch(/work it out from the measured size/i);
    expect(request).toMatch(/do not invent a starting size/i);
    // The specific refusal the user hit: "no width is set, so I can't".
    expect(request).toMatch(/do not refuse because none is written in the code/i);
  });
});
