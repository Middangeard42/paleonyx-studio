import { describe, expect, it } from "vitest";
import type { DesignSelection } from "@paleonyx/shared-types";
import { describeSelections } from "./PreviewPanel.js";

function pick(overrides: Partial<DesignSelection>): DesignSelection {
  return {
    page: "index.html",
    tag: "BUTTON",
    id: null,
    classes: [],
    text: "",
    path: [],
    rect: { x: 0, y: 0, width: 10, height: 10 },
    ...overrides,
  };
}

describe("describeSelections", () => {
  it("names a single element the way it always has", () => {
    expect(describeSelections([pick({ id: "go" })])).toBe("#go");
  });

  it("counts several and names the first few", () => {
    const text = describeSelections([
      pick({ id: "a" }),
      pick({ id: "b" }),
      pick({ id: "c" }),
    ]);
    expect(text).toBe("3 elements: #a, #b, #c");
  });

  it("says how many more when there are too many to name", () => {
    const many = ["a", "b", "c", "d", "e"].map((id) => pick({ id }));
    expect(describeSelections(many)).toBe("5 elements: #a, #b, #c and 2 more");
  });
});
