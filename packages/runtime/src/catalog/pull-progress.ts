/**
 * Reading Ollama's download progress.
 *
 * `/api/pull` answers with newline-delimited JSON, one object per
 * update. Two things about that stream cause trouble, and both are
 * handled here rather than in the caller:
 *
 * 1. Chunks do not align with lines. A single read can end mid-object,
 *    and a naive `JSON.parse` per chunk throws on perfectly good data.
 * 2. Progress is reported per layer, not per model. Each layer restarts
 *    `completed` at zero, so echoing the latest numbers makes a progress
 *    bar leap backwards several times during one download.
 */

export type { ModelPullProgress } from "@paleonyx/shared-types";
export { formatBytes } from "@paleonyx/shared-types";
import type { ModelPullProgress } from "@paleonyx/shared-types";

/** One raw object from the stream. */
export interface RawPullUpdate {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

/**
 * Splits a byte stream into whole JSON objects, holding back a partial
 * trailing line until the rest of it arrives.
 */
export class NdjsonBuffer {
  private pending = "";

  /** Returns every complete object contained in this chunk. */
  push(chunk: string): RawPullUpdate[] {
    this.pending += chunk;
    const lines = this.pending.split("\n");
    // The last element is either "" (chunk ended on a newline) or a
    // partial line, and in both cases it is what carries forward.
    this.pending = lines.pop() ?? "";
    return lines.map(parseLine).filter((v): v is RawPullUpdate => v !== null);
  }

  /** Anything left when the stream ends, which may be a final object. */
  flush(): RawPullUpdate[] {
    const remaining = this.pending;
    this.pending = "";
    const parsed = parseLine(remaining);
    return parsed ? [parsed] : [];
  }
}

function parseLine(line: string): RawPullUpdate | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as RawPullUpdate;
  } catch {
    // A line that is not JSON is not worth failing a multi-gigabyte
    // download over.
    return null;
  }
}

/**
 * Turns per-layer updates into one monotonic figure for the whole model.
 *
 * Keeps the latest `completed` and `total` per layer digest and sums
 * them, so finishing a layer and starting the next adds rather than
 * resets. Layers whose size is not yet known simply are not counted,
 * which makes the total grow as the download is discovered — honest,
 * and better than a bar that slides backwards.
 */
export class PullProgressTracker {
  private readonly layers = new Map<string, { completed: number; total: number }>();
  private lastStatus = "";

  update(raw: RawPullUpdate): ModelPullProgress {
    if (raw.status) this.lastStatus = raw.status;

    if (raw.digest && typeof raw.total === "number") {
      this.layers.set(raw.digest, {
        total: raw.total,
        completed: typeof raw.completed === "number" ? raw.completed : 0,
      });
    }

    let completedBytes = 0;
    let totalBytes = 0;
    for (const layer of this.layers.values()) {
      completedBytes += layer.completed;
      totalBytes += layer.total;
    }

    if (totalBytes === 0) {
      return {
        status: this.lastStatus,
        fraction: null,
        completedBytes: null,
        totalBytes: null,
      };
    }

    return {
      status: this.lastStatus,
      // Clamped: a layer can report completed slightly over total, and a
      // bar past 100% reads as a bug even when the download is fine.
      fraction: Math.min(1, completedBytes / totalBytes),
      completedBytes,
      totalBytes,
    };
  }
}
