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
  | { kind: "found"; index: number }
  | { kind: "not-found" }
  | { kind: "ambiguous"; matches: number[] };

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
    return { kind: "found", index: clamped };
  }

  const matches: number[] = [];
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let isMatch = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        isMatch = false;
        break;
      }
    }
    if (isMatch) matches.push(start);
  }

  if (matches.length === 0) return { kind: "not-found" };
  if (matches.length === 1) return { kind: "found", index: matches[0]! };
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
  return { kind: "found", index: best };
}
