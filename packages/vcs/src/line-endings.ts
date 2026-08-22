export type LineEnding = "\n" | "\r\n";

/**
 * Line-ending handling is load-bearing here, not housekeeping. Paleonyx
 * targets Windows as a first-class platform, where checked-out files are
 * routinely CRLF while model-generated diff lines are LF. Comparing the
 * two naively makes every hunk look like a context mismatch, which would
 * turn ordinary edits into phantom conflicts.
 *
 * So: split on either ending, compare on normalized content, and write
 * back using whatever the file already used.
 */
export function detectLineEnding(content: string): LineEnding {
  const crlfCount = (content.match(/\r\n/g) ?? []).length;
  if (crlfCount === 0) return "\n";
  const lfCount = (content.match(/\n/g) ?? []).length;
  // Mixed endings are real (hand-edited files, bad merges). Follow the
  // majority rather than silently rewriting the whole file to one style.
  return crlfCount * 2 >= lfCount ? "\r\n" : "\n";
}

export function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

export function joinLines(lines: string[], ending: LineEnding): string {
  return lines.join(ending);
}
