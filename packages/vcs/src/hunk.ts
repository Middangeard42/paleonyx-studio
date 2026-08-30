import type { DiffHunk } from "@paleonyx/shared-types";

/**
 * The lines a hunk expects to find *before* it is applied: context plus
 * the lines it will remove.
 */
export function linesBeforeApply(hunk: DiffHunk): string[] {
  return hunk.lines
    .filter((line) => line.type === "context" || line.type === "remove")
    .map((line) => line.content);
}

/**
 * The lines a hunk leaves behind *after* it is applied: context plus the
 * lines it added. Reverting looks for exactly this — if it isn't there,
 * the region has changed since and reverting would destroy that change.
 */
export function linesAfterApply(hunk: DiffHunk): string[] {
  return hunk.lines
    .filter((line) => line.type === "context" || line.type === "add")
    .map((line) => line.content);
}

/**
 * Parses the 1-based start line for the pre-image out of a unified diff
 * header like `@@ -12,3 +12,4 @@`. Used only as a search hint — never
 * trusted as the true location, because the file may well have shifted
 * since the diff was produced.
 */
export function parseHunkStartLine(header: string): number | undefined {
  const match = header.match(/@@\s*-(\d+)/);
  if (!match?.[1]) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export type LocateResult =
  | { kind: "found"; index: number; exact: boolean }
  | { kind: "not-found" }
  | { kind: "ambiguous"; matches: number[] };

/**
 * Compares two lines ignoring surrounding whitespace.
 *
 * The distinction this draws is between the file having changed and the
 * model having failed to copy indentation it was shown. Those look the
 * same to an exact comparison and are not the same thing: the first is
 * a reason to stop, the second is a reason to line the text back up.
 */
function sameIgnoringIndent(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && a.trim() === b.trim();
}

function findAll(
  haystack: string[],
  needle: string[],
  equal: (a: string | undefined, b: string | undefined) => boolean
): number[] {
  const matches: number[] = [];
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let isMatch = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (!equal(haystack[start + offset], needle[offset])) {
        isMatch = false;
        break;
      }
    }
    if (isMatch) matches.push(start);
  }
  return matches;
}

/**
 * Finds where `needle` sits inside `haystack`.
 *
 * Deliberately an exact match, with no fuzz factor. `patch(1)` will
 * apply a hunk at reduced context when it can't find an exact site;
 * that's the right trade for a human reviewing the result, and the wrong
 * one for an agent applying changes unattended. Here, a near-miss means
 * the file moved out from under us, and the safe answer is to stop and
 * report a conflict rather than to guess (CLAUDE.md §6).
 *
 * `hintIndex` disambiguates repeated regions — boilerplate, similar
 * function bodies — by preferring the match nearest where the diff
 * originally came from. A genuine tie stays ambiguous rather than
 * picking arbitrarily.
 */
export function locate(
  haystack: string[],
  needle: string[],
  hintIndex: number | undefined
): LocateResult {
  if (needle.length === 0) {
    // A pure insertion has nothing to search for, so the hint is the only
    // positioning information that exists. Without one there is no safe
    // place to put it.
    if (hintIndex === undefined) return { kind: "not-found" };
    const clamped = Math.max(0, Math.min(hintIndex, haystack.length));
    return { kind: "found", index: clamped, exact: true };
  }

  // Exact first, always. A model that copied the file faithfully gets
  // the strict guarantee; the fallback below exists only for the case
  // where nothing matched exactly at all.
  let matches = findAll(haystack, needle, (a, b) => a === b);
  let exact = true;

  if (matches.length === 0) {
    matches = findAll(haystack, needle, sameIgnoringIndent);
    exact = false;
  }

  if (matches.length === 0) return { kind: "not-found" };
  if (matches.length === 1) return { kind: "found", index: matches[0]!, exact };
  if (hintIndex === undefined) return { kind: "ambiguous", matches };

  let bestDistance = Infinity;
  let best: number | undefined;
  let tied = false;
  for (const candidate of matches) {
    const distance = Math.abs(candidate - hintIndex);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }

  if (best === undefined || tied) return { kind: "ambiguous", matches };
  return { kind: "found", index: best, exact };
}

/**
 * Builds what replaces the matched region, given the file's own text for
 * it.
 *
 * Context lines come from the file rather than from the hunk. They are
 * the lines we just matched, so the file's version is authoritative —
 * and after a whitespace-tolerant match, the hunk's version has the
 * wrong indentation by definition.
 *
 * Added lines are shifted by the difference between the indentation the
 * hunk assumed and the indentation the file actually has, which keeps
 * nesting inside the hunk intact while landing it at the right depth.
 */
export function buildReplacement(
  hunk: DiffHunk,
  fileRegion: readonly string[],
  mode: "apply" | "revert"
): string[] {
  // Which line types are consumed from the file, and which are emitted,
  // swap between applying and reverting.
  const consumed = mode === "apply" ? "remove" : "add";
  const emitted = mode === "apply" ? "add" : "remove";

  const shift = indentShift(hunk, fileRegion, mode);
  const out: string[] = [];
  let cursor = 0;

  for (const line of hunk.lines) {
    if (line.type === "context") {
      out.push(fileRegion[cursor] ?? line.content);
      cursor += 1;
    } else if (line.type === consumed) {
      cursor += 1;
    } else if (line.type === emitted) {
      out.push(shift(line.content));
    }
  }
  return out;
}

/**
 * Works out how far the hunk's idea of indentation is from the file's,
 * using the first line that appears in both.
 */
function indentShift(
  hunk: DiffHunk,
  fileRegion: readonly string[],
  mode: "apply" | "revert"
): (line: string) => string {
  const searched = mode === "apply" ? "remove" : "add";
  const reference = hunk.lines.find(
    (line) =>
      (line.type === "context" || line.type === searched) && line.content.trim() !== ""
  );
  const referenceIndex = hunk.lines
    .filter((line) => line.type === "context" || line.type === searched)
    .indexOf(reference!);

  if (!reference || referenceIndex < 0) return (line) => line;

  const from = leadingWhitespace(reference.content);
  const to = leadingWhitespace(fileRegion[referenceIndex] ?? reference.content);
  if (from === to) return (line) => line;

  return (line) => {
    if (line.trim() === "") return line;
    if (from !== "" && line.startsWith(from)) return to + line.slice(from.length);
    if (from === "") return to + line;
    // Less indented than the reference: no clean mapping exists, so the
    // line is left as written rather than guessed at.
    return line;
  };
}

function leadingWhitespace(line: string): string {
  return line.slice(0, line.length - line.trimStart().length);
}
