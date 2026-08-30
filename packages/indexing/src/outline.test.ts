import { describe, expect, it } from "vitest";
import type { CodeSymbol } from "@paleonyx/shared-types";
import {
  extractSymbolSource,
  formatOutline,
  shouldOutline,
  symbolAtLine,
} from "./outline.js";

const SYMBOLS: CodeSymbol[] = [
  { name: "Thing", kind: "class", startLine: 1, endLine: 20 },
  { name: "go", kind: "method", startLine: 3, endLine: 8, container: "Thing" },
  { name: "stop", kind: "method", startLine: 10, endLine: 14, container: "Thing" },
  { name: "helper", kind: "function", startLine: 25, endLine: 30 },
];

describe("symbolAtLine", () => {
  // Ranges nest, and the useful answer is the innermost one — a person
  // pointing at line 5 means the method, not the class around it.
  it("returns the innermost symbol containing the line", () => {
    expect(symbolAtLine(SYMBOLS, 5)?.name).toBe("go");
    expect(symbolAtLine(SYMBOLS, 12)?.name).toBe("stop");
  });

  it("falls back to the enclosing class between its methods", () => {
    expect(symbolAtLine(SYMBOLS, 9)?.name).toBe("Thing");
  });

  it("includes both ends of the range", () => {
    expect(symbolAtLine(SYMBOLS, 3)?.name).toBe("go");
    expect(symbolAtLine(SYMBOLS, 8)?.name).toBe("go");
  });

  it("returns null outside every symbol", () => {
    expect(symbolAtLine(SYMBOLS, 22)).toBeNull();
    expect(symbolAtLine([], 5)).toBeNull();
  });
});

describe("formatOutline", () => {
  it("names each symbol with its kind and line range", () => {
    const outline = formatOutline("src/thing.ts", SYMBOLS);
    expect(outline).toContain("src/thing.ts:");
    expect(outline).toContain("class Thing (lines 1-20)");
    expect(outline).toContain("function helper (lines 25-30)");
  });

  // Line numbers are what make an outline actionable: the agent can ask
  // for that range instead of the file.
  it("qualifies a method with the class it belongs to", () => {
    expect(formatOutline("a.ts", SYMBOLS)).toContain("method Thing.go (lines 3-8)");
  });

  it("says so plainly when a file has nothing in it", () => {
    expect(formatOutline("empty.ts", [])).toMatch(/no functions or classes/i);
  });
});

describe("extractSymbolSource", () => {
  const content = ["one", "two", "three", "four", "five"].join("\n");

  it("returns exactly the symbol's lines", () => {
    const source = extractSymbolSource(content, {
      name: "x",
      kind: "function",
      startLine: 2,
      endLine: 4,
    });
    expect(source).toBe("two\nthree\nfour");
  });

  // A stale range means the file changed since it was parsed. A clamped
  // excerpt would look right and be the wrong code.
  it("returns null rather than guessing when the range does not fit", () => {
    const stale = { name: "x", kind: "function" as const, startLine: 2, endLine: 99 };
    expect(extractSymbolSource(content, stale)).toBeNull();
  });

  it("returns null for a backwards range", () => {
    expect(
      extractSymbolSource(content, {
        name: "x",
        kind: "function",
        startLine: 4,
        endLine: 2,
      })
    ).toBeNull();
  });

  it("handles CRLF the same as LF", () => {
    const crlf = ["one", "two", "three"].join("\r\n");
    const source = extractSymbolSource(crlf, {
      name: "x",
      kind: "function",
      startLine: 2,
      endLine: 3,
    });
    expect(source).toBe("two\nthree");
  });
});

describe("shouldOutline", () => {
  const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
  const short = "line one\nline two";

  it("summarizes a long file that has symbols", () => {
    expect(shouldOutline(long, SYMBOLS)).toBe(true);
  });

  it("sends a short file whole", () => {
    expect(shouldOutline(short, SYMBOLS)).toBe(false);
  });

  // A long file we could not parse still goes in whole: an outline of
  // nothing would drop the content and replace it with no information.
  it("sends a long file whole when there is nothing to outline with", () => {
    expect(shouldOutline(long, [])).toBe(false);
  });

  it("respects a caller's own threshold", () => {
    expect(shouldOutline(short, SYMBOLS, 1)).toBe(true);
  });
});
