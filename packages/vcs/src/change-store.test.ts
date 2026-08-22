import { describe, expect, it } from "vitest";
import type { AgentChangeRecord, FileDiff } from "@paleonyx/shared-types";
import { applyAgentChange, loadHistory, revertAgentChange } from "./change-store.js";
import type { ChangeStore } from "./change-store.js";
import { buildHistory, parseChangeRecord } from "./history.js";

const DIFF: FileDiff = {
  filePath: "a.ts",
  hunks: [
    {
      header: "@@ -1,1 +1,1 @@",
      lines: [
        { type: "remove", content: "alpha" },
        { type: "add", content: "ALPHA" },
      ],
    },
  ],
};

function record(overrides: Partial<AgentChangeRecord> = {}): AgentChangeRecord {
  return {
    id: "change-1",
    timestamp: "2026-08-21T00:00:00.000Z",
    taskType: "bug-fix",
    summary: "Rename alpha",
    diffs: [DIFF],
    ...overrides,
  };
}

/** In-memory ChangeStore that records the order operations happened in. */
class FakeStore implements ChangeStore {
  files: Map<string, string>;
  records: { commitId: string; json: string }[] = [];
  log: string[] = [];
  failWrite = false;

  constructor(files: Record<string, string>) {
    this.files = new Map(Object.entries(files));
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`missing ${path}`);
    return content;
  }

  async writeFiles(files: Map<string, string>): Promise<void> {
    if (this.failWrite) {
      this.log.push("write-failed");
      throw new Error("disk full");
    }
    for (const [path, content] of files) this.files.set(path, content);
    this.log.push("write");
  }

  async recordChange(rec: AgentChangeRecord): Promise<string> {
    this.log.push("record");
    const commitId = `commit-${this.records.length + 1}`;
    this.records.unshift({ commitId, json: JSON.stringify(rec) });
    return commitId;
  }

  async listChangeRecords() {
    return this.records;
  }
}

describe("applyAgentChange", () => {
  it("patches the file and records the change", async () => {
    const store = new FakeStore({ "a.ts": "alpha" });
    const result = await applyAgentChange(store, record());
    expect(result.ok).toBe(true);
    expect(store.files.get("a.ts")).toBe("ALPHA");
    expect(store.records).toHaveLength(1);
  });

  it("writes files before recording, so history never claims an unwritten change", async () => {
    const store = new FakeStore({ "a.ts": "alpha" });
    await applyAgentChange(store, record());
    expect(store.log).toEqual(["write", "record"]);
  });

  it("records nothing when the write fails", async () => {
    const store = new FakeStore({ "a.ts": "alpha" });
    store.failWrite = true;
    await expect(applyAgentChange(store, record())).rejects.toThrow("disk full");
    expect(store.records).toHaveLength(0);
    expect(store.log).toEqual(["write-failed"]);
  });

  it("neither writes nor records when the diff conflicts", async () => {
    const store = new FakeStore({ "a.ts": "something else" });
    const result = await applyAgentChange(store, record());
    expect(result.ok).toBe(false);
    expect(store.files.get("a.ts")).toBe("something else");
    expect(store.records).toHaveLength(0);
    expect(store.log).toEqual([]);
  });

  it("reports a missing file as a conflict rather than throwing", async () => {
    const store = new FakeStore({});
    const result = await applyAgentChange(store, record());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflicts[0]?.conflict.message).toContain("missing");
  });
});

describe("revertAgentChange", () => {
  it("restores the file and appends an undo record", async () => {
    const store = new FakeStore({ "a.ts": "alpha" });
    const original = record();
    await applyAgentChange(store, original);

    const undone = await revertAgentChange(store, original);
    expect(undone.ok).toBe(true);
    expect(store.files.get("a.ts")).toBe("alpha");
    // Append-only: the original record survives alongside the undo.
    expect(store.records).toHaveLength(2);
  });

  it("marks the original as reverted in the timeline without deleting it", async () => {
    const store = new FakeStore({ "a.ts": "alpha" });
    const original = record();
    await applyAgentChange(store, original);
    await revertAgentChange(store, original);

    const history = await loadHistory(store);
    expect(history).toHaveLength(2);
    const originalEntry = history.find((entry) => entry.record.id === "change-1");
    expect(originalEntry?.reverted).toBe(true);
    expect(originalEntry?.record.summary).toBe("Rename alpha");
  });

  it("refuses to undo when the user has since edited the changed line", async () => {
    const store = new FakeStore({ "a.ts": "alpha" });
    const original = record();
    await applyAgentChange(store, original);
    store.files.set("a.ts", "ALPHA_EDITED_BY_USER");

    const undone = await revertAgentChange(store, original);
    expect(undone.ok).toBe(false);
    expect(store.files.get("a.ts")).toBe("ALPHA_EDITED_BY_USER");
    // No undo record either — nothing happened, so nothing is logged.
    expect(store.records).toHaveLength(1);
  });
});

describe("parseChangeRecord", () => {
  it("accepts a well-formed record", () => {
    expect(parseChangeRecord(JSON.stringify(record()))?.id).toBe("change-1");
  });

  it("rejects malformed input rather than throwing", () => {
    expect(parseChangeRecord("not json")).toBeUndefined();
    expect(parseChangeRecord("null")).toBeUndefined();
    expect(parseChangeRecord(JSON.stringify({ id: "x" }))).toBeUndefined();
    expect(
      parseChangeRecord(JSON.stringify({ ...record(), taskType: "nonsense" }))
    ).toBeUndefined();
  });
});

describe("buildHistory", () => {
  it("skips a corrupt record instead of failing the whole timeline", () => {
    const history = buildHistory([
      { commitId: "c2", json: JSON.stringify(record({ id: "b" })) },
      { commitId: "c1", json: "{ corrupt" },
    ]);
    expect(history).toHaveLength(1);
    expect(history[0]?.record.id).toBe("b");
  });

  it("preserves newest-first ordering as stored", () => {
    const history = buildHistory([
      { commitId: "c2", json: JSON.stringify(record({ id: "second" })) },
      { commitId: "c1", json: JSON.stringify(record({ id: "first" })) },
    ]);
    expect(history.map((entry) => entry.record.id)).toEqual(["second", "first"]);
  });
});
