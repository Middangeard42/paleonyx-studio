import { describe, expect, it } from "vitest";
import {
  NdjsonBuffer,
  PullProgressTracker,
  formatBytes,
} from "./pull-progress.js";

describe("NdjsonBuffer", () => {
  it("returns each complete object in a chunk", () => {
    const buffer = new NdjsonBuffer();
    const out = buffer.push('{"status":"a"}\n{"status":"b"}\n');
    expect(out.map((u) => u.status)).toEqual(["a", "b"]);
  });

  // The bug this exists for: a read can end mid-object, and parsing per
  // chunk throws on data that is perfectly valid once completed.
  it("holds back a line split across chunks until the rest arrives", () => {
    const buffer = new NdjsonBuffer();
    expect(buffer.push('{"status":"pul')).toEqual([]);
    expect(buffer.push('ling manifest"}\n')).toEqual([
      { status: "pulling manifest" },
    ]);
  });

  it("carries a partial line across several chunks", () => {
    const buffer = new NdjsonBuffer();
    buffer.push('{"sta');
    buffer.push('tus":"dow');
    buffer.push('nloading"');
    expect(buffer.push("}\n")).toEqual([{ status: "downloading" }]);
  });

  // A stream that ends without a trailing newline still delivered its
  // last object, and dropping it loses the "success" line.
  it("emits a trailing object with no newline when flushed", () => {
    const buffer = new NdjsonBuffer();
    expect(buffer.push('{"status":"success"}')).toEqual([]);
    expect(buffer.flush()).toEqual([{ status: "success" }]);
  });

  it("flushes nothing when the stream ended cleanly", () => {
    const buffer = new NdjsonBuffer();
    buffer.push('{"status":"done"}\n');
    expect(buffer.flush()).toEqual([]);
  });

  it("skips blank lines and unparseable ones rather than failing", () => {
    const buffer = new NdjsonBuffer();
    const out = buffer.push('{"status":"a"}\n\nnot json\n{"status":"b"}\n');
    expect(out.map((u) => u.status)).toEqual(["a", "b"]);
  });
});

describe("PullProgressTracker", () => {
  it("reports no fraction until a size is known", () => {
    const tracker = new PullProgressTracker();
    const progress = tracker.update({ status: "pulling manifest" });
    expect(progress.status).toBe("pulling manifest");
    expect(progress.fraction).toBeNull();
    expect(progress.totalBytes).toBeNull();
  });

  it("reports a fraction once a layer declares its size", () => {
    const tracker = new PullProgressTracker();
    const progress = tracker.update({
      status: "downloading",
      digest: "sha256:a",
      total: 1000,
      completed: 250,
    });
    expect(progress.fraction).toBeCloseTo(0.25);
    expect(progress.completedBytes).toBe(250);
    expect(progress.totalBytes).toBe(1000);
  });

  // The bug this exists for: Ollama restarts `completed` at zero for
  // each layer, so echoing the latest numbers makes the bar leap
  // backwards several times during one download.
  it("never goes backwards when a new layer starts", () => {
    const tracker = new PullProgressTracker();
    tracker.update({ digest: "sha256:a", total: 1000, completed: 1000 });
    const first = tracker.update({ digest: "sha256:a", total: 1000, completed: 1000 });
    const second = tracker.update({ digest: "sha256:b", total: 1000, completed: 0 });
    const third = tracker.update({ digest: "sha256:b", total: 1000, completed: 500 });

    expect(first.completedBytes).toBe(1000);
    // The second layer adds to the total rather than replacing it, so
    // the completed count holds instead of dropping to zero.
    expect(second.completedBytes).toBe(1000);
    expect(second.totalBytes).toBe(2000);
    expect(third.completedBytes).toBe(1500);
    expect(second.fraction!).toBeLessThanOrEqual(first.fraction!);
    expect(third.fraction!).toBeGreaterThan(second.fraction!);
  });

  it("keeps the last status when an update carries only bytes", () => {
    const tracker = new PullProgressTracker();
    tracker.update({ status: "downloading" });
    const progress = tracker.update({ digest: "sha256:a", total: 10, completed: 5 });
    expect(progress.status).toBe("downloading");
  });

  // A bar past 100% reads as a bug even when the download is fine.
  it("never reports more than complete", () => {
    const tracker = new PullProgressTracker();
    const progress = tracker.update({
      digest: "sha256:a",
      total: 100,
      completed: 120,
    });
    expect(progress.fraction).toBe(1);
  });

  it("ignores a layer whose size is not yet known", () => {
    const tracker = new PullProgressTracker();
    tracker.update({ digest: "sha256:a", total: 1000, completed: 500 });
    const progress = tracker.update({ digest: "sha256:b", completed: 10 });
    expect(progress.totalBytes).toBe(1000);
    expect(progress.completedBytes).toBe(500);
  });
});

describe("formatBytes", () => {
  it("uses units a person reads without counting digits", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(4.7 * 1024 * 1024 * 1024)).toBe("4.7 GB");
  });

  it("drops the decimal once the number is large enough not to need it", () => {
    expect(formatBytes(45 * 1024 * 1024)).toBe("45 MB");
  });
});
