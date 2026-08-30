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

describe("creating files", () => {
  const NEW_FILE: FileDiff = {
    filePath: "src/sum.test.ts",
    hunks: [
      hunk("@@ -0,0 +1,3 @@", [
        ["add", "import { sum } from './sum';"],
        ["add", ""],
        ["add", "test('adds', () => expect(sum([1,2])).toBe(3));"],
      ]),
    ],
  };

  it("creates a file from a diff that only adds lines", () => {
    // Write Tests is impossible without this: tests live in new files.
    const result = applyChange(new Map(), [NEW_FILE]);
    expect(result.ok).toBe(true);
    expect(result.created.has("src/sum.test.ts")).toBe(true);
    expect(result.updated.get("src/sum.test.ts")).toContain("test('adds'");
  });

  it("still refuses a diff that expects content the missing file cannot have", () => {
    // A diff carrying context or removals describes an edit to something
    // that exists. Creating a file from it would invent the context.
    const edit: FileDiff = {
      filePath: "gone.ts",
      hunks: [hunk("@@ -1,2 +1,2 @@", [["context", "a"], ["remove", "b"], ["add", "B"]])],
    };
    const result = applyChange(new Map(), [edit]);
    expect(result.ok).toBe(false);
    expect(result.created.size).toBe(0);
  });

  it("undoes a creation by removing the file", () => {
    const created = applyChange(new Map(), [NEW_FILE]);
    const onDisk = new Map(created.updated);
    const undone = applyChange(onDisk, [NEW_FILE], "revert");

    expect(undone.ok).toBe(true);
    expect(undone.deleted.has("src/sum.test.ts")).toBe(true);
    expect(undone.updated.size).toBe(0);
  });

  it("refuses to delete a created file the user has since edited", () => {
    // Same no-clobber rule as everywhere else: undo must not discard work
    // done after the change.
    const created = applyChange(new Map(), [NEW_FILE]);
    const edited = new Map(created.updated);
    edited.set("src/sum.test.ts", `${edited.get("src/sum.test.ts")}\n// my own test`);

    const undone = applyChange(edited, [NEW_FILE], "revert");
    expect(undone.ok).toBe(false);
    expect(undone.deleted.size).toBe(0);
  });

  it("treats undoing an already-absent creation as done, not failed", () => {
    // The end state is what was asked for.
    const result = applyChange(new Map(), [NEW_FILE], "revert");
    expect(result.ok).toBe(true);
    expect(result.deleted.size).toBe(0);
  });

  it("does not mistake added lines in an existing file for a creation", () => {
    // A pure-add hunk against a file that exists is an insertion, and
    // undoing it must remove those lines rather than delete the file.
    const insertion: FileDiff = {
      filePath: "a.ts",
      hunks: [hunk("@@ -1,1 +1,2 @@", [["context", "alpha"], ["add", "beta"]])],
    };
    const files = new Map([["a.ts", "alpha"]]);
    const applied = applyChange(files, [insertion]);
    expect(applied.created.size).toBe(0);

    const undone = applyChange(new Map(applied.updated), [insertion], "revert");
    expect(undone.deleted.size).toBe(0);
    expect(undone.updated.get("a.ts")).toBe("alpha");
  });

  it("tolerates CRLF when deciding a created file is untouched", () => {
    const created = applyChange(new Map(), [NEW_FILE]);
    const crlf = new Map([
      ["src/sum.test.ts", created.updated.get("src/sum.test.ts")!.split("\n").join("\r\n")],
    ]);
    const undone = applyChange(crlf, [NEW_FILE], "revert");
    expect(undone.ok).toBe(true);
    expect(undone.deleted.has("src/sum.test.ts")).toBe(true);
  });
});

/**
 * Indentation the model got wrong.
 *
 * The bug this fixes: a design change to a button nested at eight spaces
 * inside <body> was refused as "doesn't match your files" every time.
 * The model had found the right line and reproduced its content
 * correctly, then written it back at its own idea of indentation, and an
 * exact comparison cannot tell that apart from the file having changed.
 */
describe("hunks whose indentation does not match the file", () => {
  const HTML = [
    "<html>",
    "  <body>",
    "    <h1>Chicken Counting App</h1>",
    '    <button onclick="countChickens()">Count Chickens</button>',
    "  </body>",
    "</html>",
  ].join("\n");

  it("applies a hunk written at the wrong indentation", () => {
    const result = applyFileDiff(HTML, {
      filePath: "index.html",
      hunks: [
        {
          header: "@@ -4,1 +4,1 @@",
          lines: [
            // The model dropped the leading spaces.
            { type: "remove", content: '<button onclick="countChickens()">Count Chickens</button>' },
            {
              type: "add",
              content:
                '<button onclick="countChickens()" style="width:220px;height:42px">Count Chickens</button>',
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Landed at the file's depth, not the hunk's.
    expect(result.content).toContain(
      '    <button onclick="countChickens()" style="width:220px;height:42px">Count Chickens</button>'
    );
    expect(result.content).not.toContain(
      '\n<button onclick="countChickens()" style'
    );
  });

  it("keeps the file's own spacing on context lines", () => {
    const result = applyFileDiff(HTML, {
      filePath: "index.html",
      hunks: [
        {
          header: "@@ -3,2 +3,3 @@",
          lines: [
            { type: "context", content: "<h1>Chicken Counting App</h1>" },
            { type: "add", content: "<p>How many?</p>" },
            { type: "context", content: '<button onclick="countChickens()">Count Chickens</button>' },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Untouched lines come back exactly as the file had them.
    expect(result.content).toContain("    <h1>Chicken Counting App</h1>");
    expect(result.content).toContain("    <p>How many?</p>");
  });

  /**
   * Exact-first has to change the outcome, not just the code path.
   *
   * The test below this one passes even against a matcher that searches
   * loosely first, because its hint lands on the same line either way.
   * Here the hint sits on the loose-only candidate: searching loosely
   * first picks the wrong line, and only preferring the exact match
   * gets it right.
   */
  it("prefers an exact match over a nearer loose one", () => {
    const source = ["  x();", "x();"].join("\n");
    const result = applyFileDiff(source, {
      filePath: "a.js",
      hunks: [
        {
          // Hint points at line 1 — the indented, loose-only candidate.
          header: "@@ -1,1 +1,1 @@",
          lines: [
            { type: "remove", content: "x();" },
            { type: "add", content: "y();" },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The indented line is untouched; the exact one was replaced.
    expect(result.content).toBe(["  x();", "y();"].join("\n"));
  });

  // The whole point of exact-first: a faithful hunk must never be
  // affected by the fallback existing.
  it("still prefers an exact match when one exists", () => {
    const source = ["if (a) {", "  x();", "}", "", "if (b) {", "x();", "}"].join("\n");
    const result = applyFileDiff(source, {
      filePath: "a.js",
      hunks: [
        {
          header: "@@ -6,1 +6,1 @@",
          lines: [
            { type: "remove", content: "x();" },
            { type: "add", content: "y();" },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The unindented `x();` is the exact match; the indented one is left.
    expect(result.content).toContain("  x();");
    expect(result.content).toContain("y();");
  });

  // A near-miss on content is still the file having changed, and must
  // still be refused. Loosening whitespace must not loosen this.
  it("still refuses when the content itself differs", () => {
    const result = applyFileDiff(HTML, {
      filePath: "index.html",
      hunks: [
        {
          header: "@@ -4,1 +4,1 @@",
          lines: [
            { type: "remove", content: '<button onclick="countDucks()">Count Ducks</button>' },
            { type: "add", content: "<button>changed</button>" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict.reason).toBe("context-not-found");
  });

  it("refuses when the loose match is ambiguous", () => {
    const source = ["  go();", "", "    go();"].join("\n");
    const result = applyFileDiff(source, {
      filePath: "a.js",
      hunks: [
        {
          header: "",
          lines: [
            { type: "remove", content: "go();" },
            { type: "add", content: "stop();" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict.reason).toBe("ambiguous-location");
  });

  it("shifts a multi-line hunk while preserving nesting inside it", () => {
    const python = ["class Thing:", "    def go(self):", "        return 1"].join("\n");
    const result = applyFileDiff(python, {
      filePath: "a.py",
      hunks: [
        {
          header: "@@ -2,2 +2,3 @@",
          lines: [
            // Model wrote the method at zero indent, body at four.
            { type: "context", content: "def go(self):" },
            { type: "add", content: "    log()" },
            { type: "remove", content: "    return 1" },
            { type: "add", content: "    return 2" },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both added lines land four deeper than the method, as written.
    expect(result.content).toContain("    def go(self):");
    expect(result.content).toContain("        log()");
    expect(result.content).toContain("        return 2");
  });

  it("reverts a loosely-matched change back to the original", () => {
    const applied = applyFileDiff(HTML, {
      filePath: "index.html",
      hunks: [
        {
          header: "@@ -4,1 +4,1 @@",
          lines: [
            { type: "remove", content: '<button onclick="countChickens()">Count Chickens</button>' },
            { type: "add", content: '<button onclick="countChickens()">Count them</button>' },
          ],
        },
      ],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const reverted = revertFileDiff(applied.content, {
      filePath: "index.html",
      hunks: [
        {
          header: "@@ -4,1 +4,1 @@",
          lines: [
            { type: "remove", content: '<button onclick="countChickens()">Count Chickens</button>' },
            { type: "add", content: '<button onclick="countChickens()">Count them</button>' },
          ],
        },
      ],
    });
    expect(reverted.ok).toBe(true);
    if (!reverted.ok) return;
    expect(reverted.content).toBe(HTML);
  });
});

/**
 * Why a change could not be placed.
 *
 * The real failure that prompted this: asked to enlarge a button, the
 * model wrote an `add` with no `remove` and used a context line twice
 * that occurs once in the file. The message said only "doesn't match
 * your files", which is true of both that and a dozen other causes.
 */
describe("explaining a failure to place a change", () => {
  const HTML = [
    "<h1>Chicken Counting App</h1>",
    '<button onclick="countChickens()">Count Chickens</button>',
    '<p id="count"></p>',
  ].join("\n");

  it("names a line the model quoted that is not in the file", () => {
    const result = applyFileDiff(HTML, {
      filePath: "index.html",
      hunks: [
        {
          header: "@@ -1,2 +1,2 @@",
          lines: [
            { type: "context", content: "<h1>Chicken Counting App</h1>" },
            { type: "remove", content: "<button>Count Ducks</button>" },
            { type: "add", content: "<button>Count Geese</button>" },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict.message).toContain("Count Ducks");
    expect(result.conflict.message).toMatch(/expected to find this line/i);
  });

  // The exact shape of the observed failure: a context line repeated
  // that appears once, so every line exists but the run does not.
  it("distinguishes a repeated or reordered line from a missing one", () => {
    const result = applyFileDiff(HTML, {
      filePath: "index.html",
      hunks: [
        {
          header: "@@ -1,4 +1,5 @@",
          lines: [
            { type: "context", content: "<h1>Chicken Counting App</h1>" },
            { type: "context", content: '<button onclick="countChickens()">Count Chickens</button>' },
            { type: "context", content: '<p id="count"></p>' },
            { type: "add", content: "<button>new</button>" },
            { type: "context", content: '<p id="count"></p>' },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict.message).toMatch(/not together in that order/i);
    expect(result.conflict.message).toMatch(/repeated or reordered/i);
  });

  it("keeps the message short when the offending line is enormous", () => {
    const long = "x".repeat(500);
    const result = applyFileDiff(HTML, {
      filePath: "index.html",
      hunks: [
        {
          header: "",
          lines: [
            { type: "remove", content: long },
            { type: "add", content: "y" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict.message.length).toBeLessThan(200);
    expect(result.conflict.message).toContain("…");
  });
});

/**
 * Context the model got wrong, around a change it got right.
 *
 * The observed failure: renaming text in an <h1> produced a correct
 * one-for-one substitution, and listed the button before the heading
 * when the file has the heading first. Every quoted line existed; the
 * run did not. The change itself was unambiguous — that <h1> occurs
 * once — so refusing helped nobody.
 */
describe("placing a change by what it changes", () => {
  const HTML = [
    "<h1>Chicken Counting App</h1>",
    '<button onclick="countChickens()">Count Chickens</button>',
    '<p id="count"></p>',
  ].join("\n");

  it("applies when the context is out of order but the changed line is unique", () => {
    const result = applyFileDiff(HTML, {
      filePath: "index.html",
      hunks: [
        {
          header: "@@ -19,1 +19,1 @@",
          lines: [
            // Model listed the button first; the file has the h1 first.
            { type: "context", content: '<button onclick="countChickens()">Count Chickens</button>' },
            { type: "remove", content: "<h1>Chicken Counting App</h1>" },
            { type: "add", content: "<h1>Chicken Counting Application</h1>" },
            { type: "context", content: '<p id="count"></p>' },
          ],
        },
      ],
    }, { anchorWhenContextFails: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe(
      [
        "<h1>Chicken Counting Application</h1>",
        '<button onclick="countChickens()">Count Chickens</button>',
        '<p id="count"></p>',
      ].join("\n")
    );
  });

  it("applies when the context lines do not exist at all", () => {
    const result = applyFileDiff(HTML, {
      filePath: "index.html",
      hunks: [
        {
          header: "",
          lines: [
            { type: "context", content: "<div>never existed</div>" },
            { type: "remove", content: '<p id="count"></p>' },
            { type: "add", content: '<p id="count">0</p>' },
          ],
        },
      ],
    }, { anchorWhenContextFails: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toContain('<p id="count">0</p>');
  });

  // Uniqueness is the whole safety argument. With two candidates the
  // context would be what decides, and the context is what is wrong.
  it("refuses when the changed line occurs more than once", () => {
    const repeated = ["log();", "keep();", "log();"].join("\n");
    const result = applyFileDiff(repeated, {
      filePath: "a.js",
      hunks: [
        {
          header: "@@ -1,2 +1,2 @@",
          lines: [
            { type: "context", content: "does not exist" },
            { type: "remove", content: "log();" },
            { type: "add", content: "warn();" },
          ],
        },
      ],
    }, { anchorWhenContextFails: true });
    expect(result.ok).toBe(false);
  });

  /**
   * The guarantee this nearly cost us.
   *
   * Wrong context and an edited file are the same diff. An earlier
   * version of this anchored unconditionally and applied over a user's
   * edit to the very line the hunk quoted — caught only because the
   * existing no-clobber test failed. Anchoring is therefore off unless
   * the caller can say the file is exactly what the agent read.
   */
  it("refuses to anchor by default, so an edited file is never clobbered", () => {
    const edited = HTML.replace(
      '<button onclick="countChickens()">Count Chickens</button>',
      '<button onclick="countChickens()" class="mine">Count Chickens</button>'
    );
    const diff = {
      filePath: "index.html",
      hunks: [
        {
          header: "",
          lines: [
            { type: "context" as const, content: '<button onclick="countChickens()">Count Chickens</button>' },
            { type: "remove" as const, content: "<h1>Chicken Counting App</h1>" },
            { type: "add" as const, content: "<h1>Renamed</h1>" },
          ],
        },
      ],
    };

    // The user's edit is to a context line, and the removed line is
    // still unique — exactly the shape that anchoring would place.
    expect(applyFileDiff(edited, diff).ok).toBe(false);
    expect(applyFileDiff(edited, diff, { anchorWhenContextFails: true }).ok).toBe(true);
  });

  // A pure insertion has no changed line to anchor on, so the earlier
  // failure — an add with no remove and a duplicated context line —
  // must still be refused rather than placed somewhere plausible.
  it("still refuses an insertion whose context does not match", () => {
    const result = applyFileDiff(HTML, {
      filePath: "index.html",
      hunks: [
        {
          header: "@@ -1,4 +1,5 @@",
          lines: [
            { type: "context", content: "<h1>Chicken Counting App</h1>" },
            { type: "context", content: '<p id="count"></p>' },
            { type: "add", content: "<button>second</button>" },
            { type: "context", content: '<p id="count"></p>' },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict.reason).toBe("context-not-found");
  });

  // Anchoring is a fallback, never a shortcut: a hunk whose context does
  // match must be placed by that context.
  it("prefers a full context match over the anchor", () => {
    const source = ["a();", "target();", "b();", "c();", "target();", "d();"].join("\n");
    const result = applyFileDiff(source, {
      filePath: "a.js",
      hunks: [
        {
          header: "@@ -4,3 +4,3 @@",
          lines: [
            { type: "context", content: "c();" },
            { type: "remove", content: "target();" },
            { type: "add", content: "changed();" },
            { type: "context", content: "d();" },
          ],
        },
      ],
    }, { anchorWhenContextFails: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The second occurrence is the one surrounded by c() and d().
    expect(result.content).toBe(
      ["a();", "target();", "b();", "c();", "changed();", "d();"].join("\n")
    );
  });
});
