import type { AgentChangeRecord, FileDiff, HistoryEntry } from "@paleonyx/shared-types";
import { applyChange } from "./apply.js";
import type { Conflict } from "./apply.js";
import { buildHistory } from "./history.js";

/**
 * The platform operations this package needs but does not implement.
 * `apps/desktop` backs these with Tauri commands over the git CLI;
 * tests back them with in-memory fakes.
 *
 * There is no "reset", and deletion is narrow by construction: it is
 * reachable only when undoing a creation, only for a file the same
 * change brought into existence, and only while that file is untouched
 * since. Undo remains a forward operation — nothing here destroys
 * history.
 */
export interface ChangeStore {
  readFile(path: string): Promise<string>;
  writeFiles(files: Map<string, string>): Promise<void>;
  /**
   * Removes files. Called only to undo a creation, and only for files
   * the same change brought into existence — `applyChange` refuses to
   * report a deletion for anything else, and refuses even then if the
   * file has been edited since.
   */
  deleteFiles(paths: string[]): Promise<void>;
  /** Returns the commit id the record was stored as. */
  recordChange(record: AgentChangeRecord): Promise<string>;
  listChangeRecords(): Promise<{ commitId: string; json: string }[]>;
}

export type ChangeOutcome =
  | { ok: true; commitId: string }
  | { ok: false; conflicts: { filePath: string; conflict: Conflict }[] };

/**
 * Applies an agent change to the working tree and records it.
 *
 * Ordering matters and is not arbitrary: files are read, patched
 * in memory, and only written once *every* file has patched cleanly.
 * The record is written last, so a failure to write files can never
 * leave history claiming a change that isn't on disk.
 */
export async function applyAgentChange(
  store: ChangeStore,
  record: AgentChangeRecord
): Promise<ChangeOutcome> {
  return runChange(store, record, record.diffs, "apply");
}

/**
 * Undoes a previously applied change.
 *
 * Appends a new record naming the one it reverses rather than deleting
 * anything — history stays an append-only account of what happened,
 * including the undo.
 */
export async function revertAgentChange(
  store: ChangeStore,
  target: AgentChangeRecord,
  now: () => Date = () => new Date()
): Promise<ChangeOutcome> {
  const undoRecord: AgentChangeRecord = {
    id: `${target.id}-undo`,
    timestamp: now().toISOString(),
    taskType: target.taskType,
    summary: `Undo: ${target.summary}`,
    diffs: target.diffs,
    revertsId: target.id,
  };
  return runChange(store, undoRecord, target.diffs, "revert");
}

async function runChange(
  store: ChangeStore,
  record: AgentChangeRecord,
  diffs: FileDiff[],
  mode: "apply" | "revert"
): Promise<ChangeOutcome> {
  const paths = [...new Set(diffs.map((diff) => diff.filePath))];

  const files = new Map<string, string>();
  for (const path of paths) {
    try {
      files.set(path, await store.readFile(path));
    } catch {
      // Absent is a legitimate state: a creation is a diff for a file
      // that is supposed to be missing. Leaving it absent lets
      // applyChange decide whether that means "create this" or "this
      // change cannot be applied", and report either with the path
      // named.
    }
  }

  const result = applyChange(files, diffs, mode);
  if (!result.ok) {
    return { ok: false, conflicts: result.conflicts };
  }

  await store.writeFiles(result.updated);
  if (result.deleted.size > 0) {
    await store.deleteFiles([...result.deleted]);
  }
  // Recorded last, so a failed write can never leave history claiming a
  // change that is not on disk.
  const commitId = await store.recordChange(record);
  return { ok: true, commitId };
}

export async function loadHistory(store: ChangeStore): Promise<HistoryEntry[]> {
  return buildHistory(await store.listChangeRecords());
}
