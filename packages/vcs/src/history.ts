import type { AgentChangeRecord, AgentTaskType, HistoryEntry } from "@paleonyx/shared-types";

const TASK_TYPES: readonly AgentTaskType[] = ["explain", "bug-fix"];

/**
 * Parses one stored history record.
 *
 * A real boundary (CLAUDE.md §3): this data comes back from git objects
 * that may have been written by an older version of the app, hand-edited,
 * or corrupted. It is validated field by field rather than cast.
 */
export function parseChangeRecord(raw: string): AgentChangeRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;

  const record = parsed as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.timestamp !== "string" ||
    typeof record.summary !== "string" ||
    !TASK_TYPES.includes(record.taskType as AgentTaskType) ||
    !Array.isArray(record.diffs)
  ) {
    return undefined;
  }

  return {
    id: record.id,
    timestamp: record.timestamp,
    summary: record.summary,
    taskType: record.taskType as AgentTaskType,
    // Diff shape is validated where it is used, by packages/vcs's apply
    // logic, which refuses to patch anything it cannot match exactly.
    diffs: record.diffs as AgentChangeRecord["diffs"],
    revertsId: typeof record.revertsId === "string" ? record.revertsId : undefined,
  };
}

/**
 * Turns the raw stored records into timeline entries, resolving which
 * changes are currently undone.
 *
 * `rawRecords` arrives newest-first, as `git rev-list` returns it.
 * Unparseable entries are skipped rather than failing the whole
 * timeline: one bad record should not make the rest of a user's history
 * unreadable.
 */
export function buildHistory(rawRecords: { commitId: string; json: string }[]): HistoryEntry[] {
  const parsed = rawRecords
    .map((raw) => ({ commitId: raw.commitId, record: parseChangeRecord(raw.json) }))
    .filter((entry): entry is { commitId: string; record: AgentChangeRecord } =>
      entry.record !== undefined
    );

  const revertedIds = new Set(
    parsed.map((entry) => entry.record.revertsId).filter((id): id is string => id !== undefined)
  );

  return parsed.map((entry) => ({
    commitId: entry.commitId,
    record: entry.record,
    reverted: revertedIds.has(entry.record.id),
  }));
}
