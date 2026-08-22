import type { DiffHunk, FileDiff } from "@paleonyx/shared-types";
import { detectLineEnding, joinLines, splitLines } from "./line-endings.js";
import {
  linesAfterApply,
  linesBeforeApply,
  locate,
  parseHunkStartLine,
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
export function applyFileDiff(content: string, diff: FileDiff): PatchResult {
  return patch(content, diff, "apply");
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

function patch(content: string, diff: FileDiff, mode: "apply" | "revert"): PatchResult {
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
    const replacement = mode === "apply" ? linesAfterApply(hunk) : linesBeforeApply(hunk);

    const hint = hintIndexFor(hunk, mode === "apply" ? offset : 0);
    const located = locate(lines, search, hint);

    if (located.kind === "not-found") {
      return {
        ok: false,
        conflict: {
          reason: "context-not-found",
          hunkIndex,
          message:
            mode === "apply"
              ? `${diff.filePath} no longer matches what this change expected, so it can't be applied safely.`
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

    lines = [
      ...lines.slice(0, located.index),
      ...replacement,
      ...lines.slice(located.index + search.length),
    ];
    offset += replacement.length - search.length;
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
  conflicts: { filePath: string; conflict: Conflict }[];
}

export function applyChange(
  files: Map<string, string>,
  diffs: FileDiff[],
  mode: "apply" | "revert" = "apply"
): MultiFileResult {
  const updated = new Map<string, string>();
  const conflicts: { filePath: string; conflict: Conflict }[] = [];

  for (const diff of diffs) {
    const current = files.get(diff.filePath);
    if (current === undefined) {
      conflicts.push({
        filePath: diff.filePath,
        conflict: {
          reason: "context-not-found",
          hunkIndex: 0,
          message: `${diff.filePath} is missing, so this change can't be ${
            mode === "apply" ? "applied" : "undone"
          }.`,
        },
      });
      continue;
    }

    const result = mode === "apply" ? applyFileDiff(current, diff) : revertFileDiff(current, diff);
    if (result.ok) {
      updated.set(diff.filePath, result.content);
    } else {
      conflicts.push({ filePath: diff.filePath, conflict: result.conflict });
    }
  }

  if (conflicts.length > 0) {
    return { ok: false, updated: new Map(), conflicts };
  }
  return { ok: true, updated, conflicts: [] };
}
