/**
 * Decides which page the preview panel should open.
 *
 * Kept as data-in/data-out here rather than in the Rust server, for the
 * same reason the command allowlist lives in agent-core: the server is
 * mechanism and serves whatever is asked for, while *what to show* is a
 * judgement that belongs where it can be read and tested.
 *
 * Only static entry points are recognised. A project needing a build
 * step or a dev server has no page to open until that runs, and saying
 * so plainly beats opening a blank frame that looks broken.
 */

/** Preferred names, best first. */
const ENTRY_NAMES = ["index.html", "index.htm"];

/**
 * Directories a built or served entry point tends to live in. Ordered:
 * a project with both a source page and a built copy should preview the
 * source, since that is what its files are edited into.
 */
const ENTRY_DIRECTORIES = ["", "public/", "src/", "www/", "dist/", "build/"];

export interface PreviewEntry {
  /** Project-relative path, as the preview server expects it. */
  path: string;
}

/**
 * Finds the page to preview, or null when the project has none.
 *
 * Matching is case-insensitive because Windows and macOS filesystems
 * are: a project containing `Index.html` opens fine when double-clicked
 * and would be baffling to call un-previewable.
 */
export function findPreviewEntry(files: readonly string[]): PreviewEntry | null {
  const normalized = files.map((file) => ({ path: file, key: normalize(file) }));

  for (const directory of ENTRY_DIRECTORIES) {
    for (const name of ENTRY_NAMES) {
      const target = `${directory}${name}`;
      const match = normalized.find((file) => file.key === target);
      if (match) return { path: match.path };
    }
  }

  // No conventional entry point, but a single HTML file anywhere is
  // unambiguous — a scaffold that named its page `app.html` is still
  // something we can show.
  const html = normalized.filter((file) => /\.html?$/.test(file.key));
  if (html.length === 1) return { path: html[0]!.path };

  return null;
}

/**
 * Why there is nothing to preview, phrased for someone who may not know
 * what a build step is. Returned rather than rendered so the wording
 * stays testable and the panel stays presentational.
 */
export function describeMissingEntry(files: readonly string[]): string {
  const hasHtml = files.some((file) => /\.html?$/i.test(file));
  if (hasHtml) {
    return "This project has more than one web page and no index.html, so there is no single place to start. Open the page you want and it will show here.";
  }
  return "There is no web page in this project to show yet. The preview displays projects that run in a browser; anything else runs from the terminal.";
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}
