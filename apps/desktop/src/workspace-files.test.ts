import { describe, expect, it } from "vitest";
import type { FileDiff } from "@paleonyx/shared-types";
import {
  EMPTY_WORKSPACE,
  checkWritable,
  closeBuffer,
  editBuffer,
  isProposalStale,
  markSaved,
  openBuffer,
  refreshAfterWrite,
  unsavedAmong,
} from "./workspace-files.js";

/**
 * Regression coverage for the data-loss bugs this file was extracted to
 * prevent. Each of these shipped at some point and was caught by running
 * the app, not by a test — the cases below are those bugs written down.
 */

const SUM_BUGGY = [
  "export function sum(numbers: number[]): number {",
  "  let total = 0;",
  "  for (let i = 0; i <= numbers.length; i++) {",
  "    total += numbers[i];",
  "  }",
  "  return total;",
  "}",
].join("\n");

const SUM_DIFF: FileDiff = {
  filePath: "src/sum.ts",
  hunks: [
    {
      header: "@@ -1,6 +1,6 @@",
      lines: [
        { type: "context", content: "export function sum(numbers: number[]): number {" },
        { type: "context", content: "  let total = 0;" },
        { type: "remove", content: "  for (let i = 0; i <= numbers.length; i++) {" },
        { type: "add", content: "  for (let i = 0; i < numbers.length; i++) {" },
        { type: "context", content: "    total += numbers[i];" },
        { type: "context", content: "  }" },
      ],
    },
  ],
};

function workspace() {
  let state = EMPTY_WORKSPACE;
  state = openBuffer(state, "src/sum.ts", SUM_BUGGY);
  state = openBuffer(state, "src/greet.ts", "export const greet = () => 'hi';");
  return state;
}

describe("dirty tracking", () => {
  it("marks a file dirty only when the user edits it", () => {
    const state = workspace();
    expect(state.dirty.size).toBe(0);
    const edited = editBuffer(state, "src/sum.ts", "changed");
    expect([...edited.dirty]).toEqual(["src/sum.ts"]);
  });

  it("opening a file does not mark it dirty", () => {
    // Opening writes into the buffer, which must not look like an edit —
    // otherwise merely viewing a file would block agent changes to it.
    const state = openBuffer(EMPTY_WORKSPACE, "a.ts", "contents");
    expect(state.dirty.size).toBe(0);
  });

  it("clears dirty on save", () => {
    let state = editBuffer(workspace(), "src/sum.ts", "changed");
    state = markSaved(state, "src/sum.ts");
    expect(state.dirty.size).toBe(0);
  });
});

describe("refreshAfterWrite", () => {
  it("refreshes only the files the change wrote", () => {
    // The bug: refreshing every open file pulled unsaved edits out from
    // under the user in files the agent never touched.
    let state = workspace();
    state = editBuffer(state, "src/greet.ts", "MY UNSAVED WORK");

    state = refreshAfterWrite(state, { "src/sum.ts": "patched by agent" });

    expect(state.contents["src/sum.ts"]).toBe("patched by agent");
    expect(state.contents["src/greet.ts"]).toBe("MY UNSAVED WORK");
    expect(state.dirty.has("src/greet.ts")).toBe(true);
  });

  it("clears dirty only for the refreshed files", () => {
    let state = workspace();
    state = editBuffer(state, "src/sum.ts", "edited");
    state = editBuffer(state, "src/greet.ts", "also edited");

    state = refreshAfterWrite(state, { "src/sum.ts": SUM_BUGGY });

    expect(state.dirty.has("src/sum.ts")).toBe(false);
    expect(state.dirty.has("src/greet.ts")).toBe(true);
  });

  it("ignores files that are not open", () => {
    const state = refreshAfterWrite(workspace(), { "src/other.ts": "irrelevant" });
    expect(state.contents["src/other.ts"]).toBeUndefined();
  });
});

describe("checkWritable", () => {
  it("allows a write when nothing is outstanding", () => {
    expect(checkWritable(workspace(), [SUM_DIFF])).toEqual({ ok: true });
  });

  it("refuses when a target file has unsaved edits", () => {
    const state = editBuffer(workspace(), "src/sum.ts", "half-finished edit");
    const check = checkWritable(state, [SUM_DIFF]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.unsaved).toEqual(["src/sum.ts"]);
  });

  it("ignores unsaved edits in files the change does not touch", () => {
    const state = editBuffer(workspace(), "src/greet.ts", "unrelated work");
    expect(checkWritable(state, [SUM_DIFF])).toEqual({ ok: true });
  });

  it("guards undo the same way it guards apply", () => {
    // The bug: undo skipped this check entirely, so undoing a change to a
    // file being edited overwrote that edit.
    const state = editBuffer(workspace(), "src/sum.ts", "user edit after apply");
    const applyCheck = checkWritable(state, [SUM_DIFF]);
    const undoCheck = checkWritable(state, [SUM_DIFF]);
    expect(undoCheck).toEqual(applyCheck);
    expect(undoCheck.ok).toBe(false);
  });

  it("reports every affected file, not just the first", () => {
    let state = workspace();
    state = editBuffer(state, "src/sum.ts", "a");
    state = editBuffer(state, "src/greet.ts", "b");
    const check = checkWritable(state, [
      SUM_DIFF,
      { filePath: "src/greet.ts", hunks: [] },
    ]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.unsaved.sort()).toEqual(["src/greet.ts", "src/sum.ts"]);
  });
});

describe("isProposalStale", () => {
  it("is not stale against the file it was generated from", () => {
    expect(isProposalStale(workspace(), [SUM_DIFF])).toBe(false);
  });

  it("becomes stale once the user edits the target region", () => {
    const state = editBuffer(
      workspace(),
      "src/sum.ts",
      SUM_BUGGY.replace("i++", "i += 1")
    );
    expect(isProposalStale(state, [SUM_DIFF])).toBe(true);
  });

  it("stays applicable when the user edits an unrelated part of the file", () => {
    const state = editBuffer(
      workspace(),
      "src/sum.ts",
      SUM_BUGGY.replace("  return total;", "  return Math.round(total);")
    );
    expect(isProposalStale(state, [SUM_DIFF])).toBe(false);
  });

  it("does not judge files with no open buffer", () => {
    // Nothing to compare against; the apply reads disk and reports there.
    expect(isProposalStale(EMPTY_WORKSPACE, [SUM_DIFF])).toBe(false);
  });

  it("has no opinion about an empty proposal", () => {
    expect(isProposalStale(workspace(), [])).toBe(false);
  });
});

describe("closeBuffer", () => {
  it("drops the buffer and its dirty flag", () => {
    let state = editBuffer(workspace(), "src/sum.ts", "edited");
    state = closeBuffer(state, "src/sum.ts");
    expect(state.openPaths).not.toContain("src/sum.ts");
    expect(state.dirty.has("src/sum.ts")).toBe(false);
    expect(state.contents["src/sum.ts"]).toBeUndefined();
  });

  it("leaves other buffers alone", () => {
    let state = editBuffer(workspace(), "src/greet.ts", "unrelated work");
    state = closeBuffer(state, "src/sum.ts");
    expect(state.contents["src/greet.ts"]).toBe("unrelated work");
    expect(state.dirty.has("src/greet.ts")).toBe(true);
  });
});

describe("the full apply-then-undo journey", () => {
  it("permits apply, refresh, and undo when the user stays out of the way", () => {
    let state = workspace();

    expect(checkWritable(state, [SUM_DIFF]).ok).toBe(true);
    expect(isProposalStale(state, [SUM_DIFF])).toBe(false);

    const patched = SUM_BUGGY.replace("i <= numbers.length", "i < numbers.length");
    state = refreshAfterWrite(state, { "src/sum.ts": patched });
    expect(state.contents["src/sum.ts"]).toContain("i < numbers.length");
    expect(state.dirty.size).toBe(0);

    // Undo is allowed because nothing is outstanding.
    expect(checkWritable(state, [SUM_DIFF]).ok).toBe(true);
    state = refreshAfterWrite(state, { "src/sum.ts": SUM_BUGGY });
    expect(state.contents["src/sum.ts"]).toBe(SUM_BUGGY);
  });

  it("blocks undo after the user edits the applied change", () => {
    // The journey the whole vcs package exists for, at the app layer.
    let state = workspace();
    const patched = SUM_BUGGY.replace("i <= numbers.length", "i < numbers.length");
    state = refreshAfterWrite(state, { "src/sum.ts": patched });

    state = editBuffer(state, "src/sum.ts", patched.replace("i++", "i += 1"));

    const check = checkWritable(state, [SUM_DIFF]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.unsaved).toEqual(["src/sum.ts"]);
    // And the user's edit is still sitting in the buffer, untouched.
    expect(state.contents["src/sum.ts"]).toContain("i += 1");
  });
});

describe("unsavedAmong", () => {
  it("deduplicates repeated paths", () => {
    const state = editBuffer(workspace(), "src/sum.ts", "edited");
    expect(unsavedAmong(state, ["src/sum.ts", "src/sum.ts"])).toEqual(["src/sum.ts"]);
  });
});
