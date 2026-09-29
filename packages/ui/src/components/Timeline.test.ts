import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@paleonyx/shared-types";
import { Timeline } from "./Timeline.js";

function render(entries: HistoryEntry[], error?: string | null): string {
  return renderToStaticMarkup(createElement(Timeline, { entries, onUndo: () => {}, error }));
}

const entry: HistoryEntry = {
  record: {
    id: "1",
    timestamp: "2026-01-01T00:00:00.000Z",
    taskType: "bug-fix",
    summary: "Fix the login check",
    diffs: [],
  },
  commitId: "abc",
  reverted: false,
};

describe("Timeline", () => {
  it("says there are no changes yet when there is nothing to show and nothing went wrong", () => {
    const html = render([]);
    expect(html).toContain("No agent changes yet");
    expect(html).not.toContain('role="alert"');
  });

  // The regression: a history that could not be read was shown as an empty
  // one, so the record of what the agent had changed looked like it was gone.
  it("says the history could not be read, and does not call it empty", () => {
    const html = render([], "git could not check this folder: fatal: detected dubious ownership");
    expect(html).toContain('role="alert"');
    expect(html).toContain("read the change history");
    expect(html).toContain("dubious ownership");
    expect(html).not.toContain("No agent changes yet");
  });

  it("keeps showing the changes it has above a problem", () => {
    const html = render([entry], "boom");
    expect(html).toContain("Fix the login check");
    expect(html).toContain("boom");
  });
});
