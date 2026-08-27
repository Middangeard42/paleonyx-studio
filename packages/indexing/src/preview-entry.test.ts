import { describe, expect, it } from "vitest";
import { describeMissingEntry, findPreviewEntry } from "./preview-entry.js";

describe("findPreviewEntry", () => {
  it("prefers index.html at the project root", () => {
    expect(findPreviewEntry(["README.md", "index.html", "src/app.js"])).toEqual({
      path: "index.html",
    });
  });

  it("finds an entry point in a conventional subdirectory", () => {
    expect(findPreviewEntry(["public/index.html", "src/app.js"])).toEqual({
      path: "public/index.html",
    });
  });

  // A project with both is one that gets built. The source page is what
  // its files are edited into, so previewing the built copy would show
  // stale output after every change.
  it("prefers the source page over a built copy", () => {
    expect(findPreviewEntry(["dist/index.html", "index.html"])).toEqual({
      path: "index.html",
    });
    expect(findPreviewEntry(["dist/index.html", "src/index.html"])).toEqual({
      path: "src/index.html",
    });
  });

  it("returns the original casing and separators, not the normalized form", () => {
    expect(findPreviewEntry(["Public\\Index.html"])).toEqual({
      path: "Public\\Index.html",
    });
  });

  // Windows and macOS filesystems are case-insensitive, so a project
  // containing Index.html opens fine when double-clicked. Calling it
  // un-previewable would be baffling.
  it("matches regardless of case", () => {
    expect(findPreviewEntry(["INDEX.HTML"])).toEqual({ path: "INDEX.HTML" });
  });

  it("falls back to a lone html file under any name", () => {
    expect(findPreviewEntry(["app.html", "style.css"])).toEqual({ path: "app.html" });
  });

  // Two candidates and no convention is genuinely ambiguous. Picking one
  // arbitrarily would silently show the wrong page.
  it("declines to guess between several unconventional pages", () => {
    expect(findPreviewEntry(["app.html", "about.html"])).toBeNull();
  });

  it("returns null for a project with nothing to show", () => {
    expect(findPreviewEntry(["main.py", "README.md"])).toBeNull();
    expect(findPreviewEntry([])).toBeNull();
  });

  it("does not mistake a similarly named file for an entry point", () => {
    expect(findPreviewEntry(["index.html.bak", "notes.md"])).toBeNull();
  });
});

describe("describeMissingEntry", () => {
  it("distinguishes 'no page at all' from 'too many pages'", () => {
    const none = describeMissingEntry(["main.py"]);
    const several = describeMissingEntry(["app.html", "about.html"]);
    expect(none).not.toBe(several);
    expect(none).toMatch(/no web page/i);
    expect(several).toMatch(/more than one/i);
  });

  // The panel is the beginner's first encounter with "this cannot be
  // previewed", so the reason must not assume vocabulary.
  it("explains without jargon", () => {
    for (const files of [["main.py"], ["app.html", "about.html"]]) {
      expect(describeMissingEntry(files)).not.toMatch(/entry point|bundler|SPA/i);
    }
  });
});
