import type { FileDiff } from "@paleonyx/shared-types";
import { applyFileDiff } from "@paleonyx/vcs";

/**
 * Open editor buffers and what is outstanding in them.
 *
 * Pulled out of the App component deliberately. Every rule below is
 * product policy about not destroying the user's work, and while it
 * lived inline in a large component it was untestable and quietly grew
 * three separate data-loss bugs. CLAUDE.md §1: the UI renders state, it
 * does not decide policy.
 *
 * Every function is pure and returns new state, so the whole set of
 * rules can be exercised without a DOM, an editor, or a filesystem.
 */
export interface WorkspaceFiles {
  /** Current buffer content, which may differ from disk. */
  contents: Readonly<Record<string, string>>;
  /** Paths whose buffer has edits not yet written to disk. */
  dirty: ReadonlySet<string>;
  openPaths: readonly string[];
}

export const EMPTY_WORKSPACE: WorkspaceFiles = {
  contents: {},
  dirty: new Set(),
  openPaths: [],
};

export function openBuffer(
  state: WorkspaceFiles,
  path: string,
  content?: string
): WorkspaceFiles {
  const openPaths = state.openPaths.includes(path)
    ? state.openPaths
    : [...state.openPaths, path];
  const contents =
    content === undefined ? state.contents : { ...state.contents, [path]: content };
  return { ...state, openPaths, contents };
}

/** Records a user edit. Only this marks a file dirty. */
export function editBuffer(
  state: WorkspaceFiles,
  path: string,
  next: string
): WorkspaceFiles {
  const dirty = new Set(state.dirty);
  dirty.add(path);
  return { ...state, contents: { ...state.contents, [path]: next }, dirty };
}

export function markSaved(state: WorkspaceFiles, path: string): WorkspaceFiles {
  if (!state.dirty.has(path)) return state;
  const dirty = new Set(state.dirty);
  dirty.delete(path);
  return { ...state, dirty };
}

/**
 * Refreshes buffers after a change wrote to disk.
 *
 * Scoped to the paths that were actually written. Refreshing everything
 * open would pull unsaved edits out from under the user in files the
 * change never touched.
 */
export function refreshAfterWrite(
  state: WorkspaceFiles,
  refreshed: Readonly<Record<string, string>>
): WorkspaceFiles {
  const contents = { ...state.contents };
  const dirty = new Set(state.dirty);
  for (const [path, content] of Object.entries(refreshed)) {
    if (!state.openPaths.includes(path)) continue;
    contents[path] = content;
    // This file now matches disk. Others stay outstanding.
    dirty.delete(path);
  }
  return { ...state, contents, dirty };
}

export function closeBuffer(state: WorkspaceFiles, path: string): WorkspaceFiles {
  const dirty = new Set(state.dirty);
  dirty.delete(path);
  const contents = { ...state.contents };
  delete contents[path];
  return {
    openPaths: state.openPaths.filter((open) => open !== path),
    contents,
    dirty,
  };
}

/** Files a write would touch that still have unsaved edits. */
export function unsavedAmong(
  state: WorkspaceFiles,
  paths: readonly string[]
): string[] {
  return [...new Set(paths)].filter((path) => state.dirty.has(path));
}

export type WriteCheck = { ok: true } | { ok: false; unsaved: string[] };

/**
 * Whether a change may write these files.
 *
 * Shared by apply and undo. Undo rewrites files exactly as apply does,
 * and previously skipped this check — so undoing a change to a file
 * being edited overwrote that edit, the opposite of what undo is for.
 */
export function checkWritable(
  state: WorkspaceFiles,
  diffs: readonly FileDiff[]
): WriteCheck {
  const unsaved = unsavedAmong(
    state,
    diffs.map((diff) => diff.filePath)
  );
  return unsaved.length === 0 ? { ok: true } : { ok: false, unsaved };
}

/**
 * Whether a proposal still fits the current buffers.
 *
 * Runs the real patch rather than tracking edits separately, so this
 * preview and the actual apply cannot disagree. Files with no open
 * buffer are not judged here — the apply reads them from disk and
 * reports honestly if they conflict.
 */
export function isProposalStale(
  state: WorkspaceFiles,
  diffs: readonly FileDiff[],
  seenByAgent?: Record<string, string>
): boolean {
  return proposalConflict(state, diffs, seenByAgent) !== null;
}

/**
 * Why a proposal will not apply, or null when it will.
 *
 * The same check as `isProposalStale`, keeping the reason instead of
 * discarding it. "This can't be applied" is true of every failure and
 * distinguishes none of them; the panel needs to say which line the
 * change expected and could not find, because that is what tells the
 * user whether the model misread the file or they edited it themselves.
 */
export function proposalConflict(
  state: WorkspaceFiles,
  diffs: readonly FileDiff[],
  seenByAgent?: Record<string, string>
): string | null {
  for (const diff of diffs) {
    const content = state.contents[diff.filePath];
    if (content === undefined) continue;
    // Must ask the same question the apply will ask, or the badge says
    // "doesn't match" about a change that would apply perfectly well.
    const result = applyFileDiff(content, diff, {
      anchorWhenContextFails: seenByAgent?.[diff.filePath] === content,
    });
    if (!result.ok) return result.conflict.message;
  }
  return null;
}
