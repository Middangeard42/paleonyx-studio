import type { AgentTaskType } from "./agent.js";
import type { FileDiff } from "./diff.js";

/**
 * One logical agent change — the revertible unit required by CLAUDE.md
 * §6. A change spanning five files is still one record, so undoing it
 * undoes all five or none.
 *
 * This is the schema stored in the shadow history. It is written and
 * read as opaque JSON by the Rust layer, which deliberately holds no
 * mirror of this type: two definitions of the same shape would be free
 * to drift apart.
 */
export interface AgentChangeRecord {
  id: string;
  /** ISO-8601, in UTC. */
  timestamp: string;
  taskType: AgentTaskType;
  summary: string;
  diffs: FileDiff[];
  /**
   * Set when this record is itself an undo, naming the change it
   * reverses. History is append-only: undoing does not delete the
   * original entry, so the timeline keeps showing what the agent did
   * *and* that it was undone, which is the point of having a timeline at
   * all (CLAUDE.md §7 — the user should see why, not just what).
   */
  revertsId?: string;
}

/** A recorded change plus where it sits in the shadow history. */
export interface HistoryEntry {
  record: AgentChangeRecord;
  /** Commit id of this entry in `refs/paleonyx/history`. */
  commitId: string;
  /**
   * Whether the change is currently applied to the working tree. Undoing
   * appends a new record rather than deleting one, so history stays an
   * append-only log of what happened — including the undo itself.
   */
  reverted: boolean;
}

export interface GitStatus {
  isRepository: boolean;
  hasCommits: boolean;
}
