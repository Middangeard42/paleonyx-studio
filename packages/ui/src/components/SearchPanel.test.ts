import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SearchResults } from "@paleonyx/shared-types";
import { SearchResultsList } from "./SearchPanel.js";

function render(results: SearchResults): string {
  return renderToStaticMarkup(
    createElement(SearchResultsList, {
      results,
      searching: false,
      query: "needle",
      onOpenMatch: () => {},
      onAddToContext: () => {},
      contextFiles: [],
    })
  );
}

const oneFile: SearchResults = {
  files: [{ path: "a.txt", matches: [{ line: 1, text: "needle", start: 0, end: 6 }] }],
  truncated: false,
  totalMatches: 1,
  skippedNames: 0,
};

describe("SearchResultsList", () => {
  it("says nothing extra when every match can be listed", () => {
    const html = render(oneFile);
    expect(html).toContain("1 match in 1 file");
    expect(html).not.toContain('role="status"');
  });

  // A search that leaves matches out must not read as complete.
  it("says how many files matched but cannot be listed", () => {
    const html = render({ ...oneFile, skippedNames: 2 });
    expect(html).toContain("2 more files have matches but can&#x27;t be listed");
  });

  it("does not report a plain 'no matches' when unlistable files matched", () => {
    const html = render({ files: [], truncated: false, totalMatches: 0, skippedNames: 1 });
    expect(html).toContain("in the files that can be listed");
    expect(html).toContain("1 more file has matches");
  });

  it("reports plain 'no matches' when nothing was skipped", () => {
    const html = render({ files: [], truncated: false, totalMatches: 0, skippedNames: 0 });
    expect(html).toContain("No matches for");
    expect(html).not.toContain("can be listed");
  });
});
