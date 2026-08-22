import { describe, expect, it } from "vitest";
import type { DiffHunk, FileDiff } from "@paleonyx/shared-types";
import { applyChange, applyFileDiff, revertFileDiff } from "./apply.js";

/**
 * CLAUDE.md §8 gives this package the highest test bar in the repo,
 * including adversarial cases: concurrent user edits during an agent
 * change, and partial-apply failure mid-write. Both are covered below.
 *
 * The property that matters most throughout: a conflict must never
 * produce written content. Returning `ok: false` *and* a patched string
 * would let a careless caller clobber the user's work, so the type makes
 * that combination unrepresentable and these tests hold it to it.
 */

function hunk(header: string, lines: [string, string][]): DiffHunk {
  return {
    header,
    lines: lines.map(([type, content]) => ({
      type: type as "context" | "add" | "remove",
      content,
    })),
  };
}

/** The off-by-one fix from the demo project — a realistic single-hunk change. */
const SUM_BEFORE = [
  "export function sum(numbers: number[]): number {",
  "  let total = 0;",
  "  for (let i = 0; i <= numbers.length; i++) {",
  "    total += numbers[i];",
  "  }",
  "  return total;",
  "}",
].join("\n");

const SUM_AFTER = SUM_BEFORE.replace("i <= numbers.length", "i < numbers.length");

const SUM_DIFF: FileDiff = {
  filePath: "src/sum.ts",
  hunks: [
    hunk("@@ -1,6 +1,6 @@", [
      ["context", "export function sum(numbers: number[]): number {"],
      ["context", "  let total = 0;"],
      ["remove", "  for (let i = 0; i <= numbers.length; i++) {"],
      ["add", "  for (let i = 0; i < numbers.length; i++) {"],
      ["context", "    total += numbers[i];"],
      ["context", "  }"],
    ]),
  ],
};

describe("applyFileDiff", () => {
  it("applies a hunk", () => {
    const result = applyFileDiff(SUM_BEFORE, SUM_DIFF);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe(SUM_AFTER);
  });

  it("round-trips: apply then revert restores the original exactly", () => {
    const applied = applyFileDiff(SUM_BEFORE, SUM_DIFF);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const reverted = revertFileDiff(applied.content, SUM_DIFF);
    expect(reverted.ok).toBe(true);
    if (reverted.ok) expect(reverted.content).toBe(SUM_BEFORE);
  });

  it("refuses to apply when the file no longer matches", () => {
    const drifted = SUM_BEFORE.replace("let total = 0;", "let total = 100;");
    const result = applyFileDiff(drifted, SUM_DIFF);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict.reason).toBe("context-not-found");
  });

  it("applies multiple hunks in one file", () => {
    const before = ["one", "two", "three", "four", "five", "six"].join("\n");
    const diff: FileDiff = {
      filePath: "a.txt",
      hunks: [
        hunk("@@ -1,2 +1,2 @@", [
          ["remove", "one"],
          ["add", "ONE"],
          ["context", "two"],
        ]),
        hunk("@@ -5,2 +5,2 @@", [
          ["context", "four"],
          ["remove", "five"],
          ["add", "FIVE"],
        ]),
      ],
    };
    const result = applyFileDiff(before, diff);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe(["ONE", "two", "three", "four", "FIVE", "six"].join("\n"));
    }
  });

  it("handles hunks that change line count, keeping later hunks aligned", () => {
    const before = ["a", "b", "c", "d"].join("\n");
    const diff: FileDiff = {
      filePath: "a.txt",
      hunks: [
        hunk("@@ -1,1 +1,3 @@", [
          ["context", "a"],
          ["add", "a2"],
          ["add", "a3"],
        ]),
        hunk("@@ -4,1 +4,1 @@", [
          ["remove", "d"],
          ["add", "D"],
        ]),
      ],
    };
    const result = applyFileDiff(before, diff);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe(["a", "a2", "a3", "b", "c", "D"].join("\n"));
  });
});

describe("revertFileDiff — the no-clobber guarantee", () => {
  it("refuses to revert when the user has edited the changed line", () => {
    // The agent's fix is applied, then the user edits that very line.
    // Reverting would destroy their edit, so it must not proceed.
    const userEdited = SUM_AFTER.replace(
      "  for (let i = 0; i < numbers.length; i++) {",
      "  for (let i = 0; i < numbers.length; i += 1) {"
    );
    const result = revertFileDiff(userEdited, SUM_DIFF);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict.reason).toBe("context-not-found");
      expect(result.conflict.message).toContain("overwrite");
    }
  });

  it("still reverts cleanly when the user edited an unrelated part of the file", () => {
    // This is the other half of the promise: unrelated work survives, and
    // is preserved rather than reverted along with the agent's change.
    const userEdited = SUM_AFTER.replace("  return total;", "  return Math.round(total);");
    const result = revertFileDiff(userEdited, SUM_DIFF);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain("i <= numbers.length");
      expect(result.content).toContain("Math.round(total)");
    }
  });

  it("survives the user adding lines above the change", () => {
    // Insertions above shift every line number in the diff header. Since
    // location is by content and the header is only a hint, this works.
    const userEdited = `// added by the user\n// another line\n${SUM_AFTER}`;
    const result = revertFileDiff(userEdited, SUM_DIFF);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain("// added by the user");
      expect(result.content).toContain("i <= numbers.length");
    }
  });

  it("never returns content alongside a conflict", () => {
    const clobbered = SUM_AFTER.replace("i < numbers.length", "i < items.length");
    const result = revertFileDiff(clobbered, SUM_DIFF);
    expect(result.ok).toBe(false);
    expect("content" in result).toBe(false);
  });
});

describe("ambiguity", () => {
  const REPEATED = ["log();", "flush();", "log();", "flush();"].join("\n");

  it("uses the header hint to pick between identical regions", () => {
    const diff: FileDiff = {
      filePath: "a.ts",
      hunks: [
        hunk("@@ -3,2 +3,2 @@", [
          ["context", "log();"],
          ["remove", "flush();"],
          ["add", "flushAsync();"],
        ]),
      ],
    };
    const result = applyFileDiff(REPEATED, diff);
    expect(result.ok).toBe(true);
    // The hint points at the second pair, so the first must be untouched.
    if (result.ok) {
      expect(result.content).toBe(["log();", "flush();", "log();", "flushAsync();"].join("\n"));
    }
  });

  it("reports ambiguity rather than guessing when the hint cannot break a tie", () => {
    const diff: FileDiff = {
      filePath: "a.ts",
      hunks: [
        hunk("@@ -2,2 +2,2 @@", [
          ["context", "log();"],
          ["remove", "flush();"],
          ["add", "flushAsync();"],
        ]),
      ],
    };
    // Matches sit at index 0 and 2; the hint lands at index 1, exactly
    // between them. Picking either would be a coin flip on the user's code.
    const result = applyFileDiff(REPEATED, diff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict.reason).toBe("ambiguous-location");
  });
});

describe("line endings", () => {
  it("preserves CRLF files instead of rewriting them to LF", () => {
    const crlf = SUM_BEFORE.split("\n").join("\r\n");
    const result = applyFileDiff(crlf, SUM_DIFF);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain("\r\n");
      expect(result.content.split("\r\n").length).toBe(crlf.split("\r\n").length);
      expect(result.content).toContain("i < numbers.length");
    }
  });

  it("matches LF-based diff lines against a CRLF file", () => {
    // The diff comes from a model emitting LF; the checked-out file on
    // Windows is CRLF. Without normalization every hunk would look like a
    // conflict.
    const crlf = SUM_AFTER.split("\n").join("\r\n");
    const result = revertFileDiff(crlf, SUM_DIFF);
    expect(result.ok).toBe(true);
  });

  it("leaves an LF file as LF", () => {
    const result = applyFileDiff(SUM_BEFORE, SUM_DIFF);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).not.toContain("\r\n");
  });
});

describe("applyChange — one agent change is one unit", () => {
  const FILE_A = ["alpha", "beta"].join("\n");
  const FILE_B = ["gamma", "delta"].join("\n");

  const DIFF_A: FileDiff = {
    filePath: "a.ts",
    hunks: [hunk("@@ -1,1 +1,1 @@", [["remove", "alpha"], ["add", "ALPHA"]])],
  };
  const DIFF_B: FileDiff = {
    filePath: "b.ts",
    hunks: [hunk("@@ -1,1 +1,1 @@", [["remove", "gamma"], ["add", "GAMMA"]])],
  };

  it("applies across several files", () => {
    const files = new Map([
      ["a.ts", FILE_A],
      ["b.ts", FILE_B],
    ]);
    const result = applyChange(files, [DIFF_A, DIFF_B]);
    expect(result.ok).toBe(true);
    expect(result.updated.get("a.ts")).toContain("ALPHA");
    expect(result.updated.get("b.ts")).toContain("GAMMA");
  });

  it("writes nothing at all when one file in the change conflicts", () => {
    // Partial-apply failure mid-write, named in CLAUDE.md §8. A change
    // that landed in one file but not the other would not be revertible
    // as a unit, so it must not land at all.
    const files = new Map([
      ["a.ts", FILE_A],
      ["b.ts", "something else entirely"],
    ]);
    const result = applyChange(files, [DIFF_A, DIFF_B]);
    expect(result.ok).toBe(false);
    expect(result.updated.size).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.filePath).toBe("b.ts");
  });

  it("treats a missing file as a conflict rather than creating it", () => {
    const files = new Map([["a.ts", FILE_A]]);
    const result = applyChange(files, [DIFF_A, DIFF_B]);
    expect(result.ok).toBe(false);
    expect(result.updated.size).toBe(0);
    expect(result.conflicts[0]?.conflict.message).toContain("missing");
  });

  it("round-trips a multi-file change", () => {
    const files = new Map([
      ["a.ts", FILE_A],
      ["b.ts", FILE_B],
    ]);
    const applied = applyChange(files, [DIFF_A, DIFF_B]);
    expect(applied.ok).toBe(true);
    const reverted = applyChange(applied.updated, [DIFF_A, DIFF_B], "revert");
    expect(reverted.ok).toBe(true);
    expect(reverted.updated.get("a.ts")).toBe(FILE_A);
    expect(reverted.updated.get("b.ts")).toBe(FILE_B);
  });

  it("refuses the whole undo when one file was edited since", () => {
    const files = new Map([
      ["a.ts", "ALPHA\nbeta"],
      ["b.ts", "GAMMA edited by user\ndelta"],
    ]);
    const result = applyChange(files, [DIFF_A, DIFF_B], "revert");
    expect(result.ok).toBe(false);
    expect(result.updated.size).toBe(0);
  });
});
