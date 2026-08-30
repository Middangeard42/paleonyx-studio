import type { DiffHunk, FileDiff } from "@paleonyx/shared-types";
import { detectLineEnding, joinLines, splitLines } from "./line-endings.js";
import {
  linesAfterApply,
  linesBeforeApply,
  locate,
  parseHunkStartLine,
  buildReplacement,
  describeMismatch,
} from "./hunk.js";

export type ConflictReason = "context-not-found" | "ambiguous-location";

export interface Conflict {
  reason: ConflictReason;
  /** Index of the offending hunk within the file diff. */
  hunkIndex: number;
  /** Plain-language explanation, suitable for showing the user directly. */
  message: string;
}

export type PatchResult =
  | { ok: true; content: string }
  | { ok: false; conflict: Conflict };

/**
 * Applies every hunk of a file diff to `content`.
 *
 * All-or-nothing: if any hunk conflicts, nothing is written and the
 * conflict is returned. A half-applied file is the one outcome that
 * would leave the user's tree in a state neither they nor the agent
 * intended, which CLAUDE.md §6 rules out.
 */
export interface PatchOptions {
  /**
   * Allows a hunk whose context does not match to be placed by the lines
   * it changes, when those occur exactly once.
   *
   * Off by default, and the caller must earn it. Wrong context has two
   * causes that look identical in a diff: the model misquoted the file,
   * or the user edited the very lines it quoted. Placing the change is
   * right for the first and destroys work for the second, so this may
   * only be set when the caller knows the file is byte-for-byte what the
   * agent was shown — at which point the user cannot be the cause.
   */
  anchorWhenContextFails?: boolean;
}

export function applyFileDiff(
  content: string,
  diff: FileDiff,
  options: PatchOptions = {}
): PatchResult {
  return patch(content, diff, "apply", options);
}

/**
 * Undoes a previously applied file diff.
 *
 * This is the operation the product's trust promise rests on. It is not
 * a reset: it looks for the exact lines the change introduced and swaps
 * them back. If the user has since edited that region, those lines are
 * gone, the search fails, and this reports a conflict instead of
 * overwriting their work (CLAUDE.md §6 — "flag a conflict rather than
 * silently clobbering"). Edits elsewhere in the file are untouched
 * either way.
 */
export function revertFileDiff(content: string, diff: FileDiff): PatchResult {
  return patch(content, diff, "revert");
}

function patch(
  content: string,
  diff: FileDiff,
  mode: "apply" | "revert",
  options: PatchOptions = {}
): PatchResult {
  const ending = detectLineEnding(content);
  let lines = splitLines(content);

  // Later hunks are described in terms of the file as it looked before
  // any of them were applied, so applying earlier ones shifts everything
  // below. Tracking the running offset keeps each hunk's hint honest.
  let offset = 0;

  const ordered = mode === "apply" ? diff.hunks : [...diff.hunks].reverse();

  for (const [position, hunk] of ordered.entries()) {
    const hunkIndex = mode === "apply" ? position : diff.hunks.length - 1 - position;
    const search = mode === "apply" ? linesBeforeApply(hunk) : linesAfterApply(hunk);

    const hint = hintIndexFor(hunk, mode === "apply" ? offset : 0);
    let located = locate(lines, search, hint);
    let placedHunk = hunk;
    let placedSearch = search;

    /**
     * Last resort: place the change by the lines it actually changes,
     * ignoring the context around them.
     *
     * Context exists to disambiguate. When the lines being replaced
     * occur exactly once in the file there is nothing to disambiguate,
     * so wrong context is not a reason to refuse — and wrong context is
     * what a small model produces most often. The observed case: a
     * one-line text change whose `remove` line was correct and unique,
     * refused because the model listed the button before the heading
     * when the file has them the other way round.
     *
     * Uniqueness is required rather than preferred, which is why no
     * hint is passed: a second occurrence makes this a guess about which
     * one the user meant, and the context that would normally settle it
     * is precisely what we already know to be wrong. This can never
     * place a pure insertion, which has no changed lines to anchor on.
     */
    if (located.kind === "not-found" && options.anchorWhenContextFails) {
      const anchored = { ...hunk, lines: hunk.lines.filter((l) => l.type !== "context") };
      const anchorSearch =
        mode === "apply" ? linesBeforeApply(anchored) : linesAfterApply(anchored);

      if (anchorSearch.length > 0) {
        const retry = locate(lines, anchorSearch, undefined);
        if (retry.kind === "found") {
          located = retry;
          placedHunk = anchored;
          placedSearch = anchorSearch;
        }
      }
    }

    if (located.kind === "not-found") {
      return {
        ok: false,
        conflict: {
          reason: "context-not-found",
          hunkIndex,
          message:
            mode === "apply"
              ? `${diff.filePath} doesn't match what this change expected. ${describeMismatch(lines, search)}`
              : `${diff.filePath} has been edited since this change was applied, so undoing it would overwrite that edit.`,
        },
      };
    }

    if (located.kind === "ambiguous") {
      return {
        ok: false,
        conflict: {
          reason: "ambiguous-location",
          hunkIndex,
          message: `This change could belong in ${located.matches.length} different places in ${diff.filePath}, so it can't be placed automatically.`,
        },
      };
    }

    // Built against the file's own text for the matched region, so
    // context lines keep the file's spacing and added lines land at the
    // depth the file actually uses rather than the depth the hunk
    // assumed (see buildReplacement).
    const region = lines.slice(located.index, located.index + placedSearch.length);
    const placed = buildReplacement(placedHunk, region, mode);

    lines = [
      ...lines.slice(0, located.index),
      ...placed,
      ...lines.slice(located.index + placedSearch.length),
    ];
    offset += placed.length - placedSearch.length;
  }

  return { ok: true, content: joinLines(lines, ending) };
}

function hintIndexFor(hunk: DiffHunk, offset: number): number | undefined {
  const startLine = parseHunkStartLine(hunk.header);
  if (startLine === undefined) return undefined;
  // Headers are 1-based; array indices are not.
  return Math.max(0, startLine - 1 + offset);
}

/**
 * Applies a whole agent change across every file it touches.
 *
 * Also all-or-nothing, for the same reason as a single file but with
 * higher stakes: CLAUDE.md §6 requires one logical agent change to be
 * one revertible unit even when it spans files. A change that landed in
 * three files out of five would not be revertible as a unit, so this
 * reports the first conflict and writes nothing.
 */
export interface MultiFileResult {
  ok: boolean;
  /** Populated only when ok — path to new content, for the caller to write. */
  updated: Map<string, string>;
  /** Subset of `updated` that did not exist before. */
  created: Set<string>;
  /**
   * Files to remove, which only ever means undoing a creation this same
   * change made. Nothing else in this package deletes anything.
   */
  deleted: Set<string>;
  conflicts: { filePath: string; conflict: Conflict }[];
}

/**
 * A diff that only adds lines describes a whole new file.
 *
 * Inferred rather than flagged by the model: a flag is a claim we would
 * have to trust, while the shape of the diff is a fact we can check. A
 * diff carrying context or removals expects a file to already be there,
 * so it can never be mistaken for a creation.
 */
export function isCreation(diff: FileDiff): boolean {
  const lines = diff.hunks.flatMap((hunk) => hunk.lines);
  return lines.length > 0 && lines.every((line) => line.type === "add");
}

function creationContent(diff: FileDiff): string {
  return diff.hunks
    .flatMap((hunk) => hunk.lines)
    .map((line) => line.content)
    .join("\n");
}

/**
 * Whether `current` is exactly what this creation produced.
 *
 * The discriminator between "the change created this file" and "the
 * change added lines to a file that already existed" — both look like a
 * pure-add diff, but only the first leaves the file equal to the added
 * lines and nothing else. Compared on normalized endings so a CRLF
 * checkout does not read as a user edit.
 */
function matchesCreation(current: string, diff: FileDiff): boolean {
  return splitLines(current).join("\n") === creationContent(diff);
}

export function applyChange(
  files: Map<string, string>,
  diffs: FileDiff[],
  mode: "apply" | "revert" = "apply",
  /**
   * Content each file had when the agent read it. A file still equal to
   * what it was shown cannot have been edited by the user, which is the
   * only condition under which a context mismatch is safely the model's
   * fault (see PatchOptions.anchorWhenContextFails).
   */
  seenByAgent?: ReadonlyMap<string, string>
): MultiFileResult {
  const updated = new Map<string, string>();
  const created = new Set<string>();
  const deleted = new Set<string>();
  const conflicts: { filePath: string; conflict: Conflict }[] = [];

  const fail = (filePath: string, message: string) =>
    conflicts.push({
      filePath,
      conflict: { reason: "context-not-found" as const, hunkIndex: 0, message },
    });

  for (const diff of diffs) {
    const current = files.get(diff.filePath);

    if (current === undefined) {
      // A diff that only adds lines, for a file that is not there, is a
      // new file. Anything else expects content that is missing.
      if (mode === "apply" && isCreation(diff)) {
        updated.set(diff.filePath, creationContent(diff));
        created.add(diff.filePath);
      } else if (mode === "revert" && isCreation(diff)) {
        // Undoing a creation of something already gone. The end state is
        // what was wanted, so this is not a failure.
        continue;
      } else {
        fail(
          diff.filePath,
          `${diff.filePath} is missing, so this change can't be ${
            mode === "apply" ? "applied" : "undone"
          }.`
        );
      }
      continue;
    }

    // Undoing a creation means removing the file — the only deletion
    // anywhere in this package, and only ever of a file the same change
    // brought into existence.
    if (mode === "revert" && isCreation(diff)) {
      if (matchesCreation(current, diff)) {
        deleted.add(diff.filePath);
      } else {
        fail(
          diff.filePath,
          `${diff.filePath} has been edited since it was created, so undoing would discard those edits. Delete it yourself if that is what you want.`
        );
      }
      continue;
    }

    const unchangedSinceRead =
      seenByAgent !== undefined && seenByAgent.get(diff.filePath) === current;
    const result =
      mode === "apply"
        ? applyFileDiff(current, diff, {
            anchorWhenContextFails: unchangedSinceRead,
          })
        : revertFileDiff(current, diff);
    if (result.ok) {
      updated.set(diff.filePath, result.content);
    } else {
      conflicts.push({ filePath: diff.filePath, conflict: result.conflict });
    }
  }

  if (conflicts.length > 0) {
    return {
      ok: false,
      updated: new Map(),
      created: new Set(),
      deleted: new Set(),
      conflicts,
    };
  }
  return { ok: true, updated, created, deleted, conflicts: [] };
}
