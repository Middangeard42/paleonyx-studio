import { describe, expect, it } from "vitest";
import { parseAgentResponse } from "./parse-response.js";

function lineObjects(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `            { "type": "add", "content": "line ${i}" }`
  );
}

/** A pretty-printed response like a model writes: one object per code line. */
function response(lines: string[], separator = ",\n"): string {
  return `\`\`\`json
{
  "summary": "Create a calculator",
  "steps": [{ "id": "1", "description": "Write it" }],
  "explanation": "Adds calculator.py.",
  "diff": [
    {
      "filePath": "calculator.py",
      "hunks": [
        {
          "header": "@@ -0,0 +1,${lines.length} @@",
          "lines": [
${lines.join(separator)}
          ]
        }
      ]
    }
  ],
  "confidence": "high"
}
\`\`\``;
}

describe("parseAgentResponse", () => {
  it("accepts well-formed output and does not call it repaired", () => {
    const result = parseAgentResponse(response(lineObjects(5)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.repairs).toBe(0);
  });

  // The regression: a 9B model dropped one comma between two line objects
  // in a long diff and the whole response was rejected.
  it("puts back a comma the model dropped between two array elements", () => {
    const lines = lineObjects(20);
    const text = response(lines).replace('"line 9" },\n', '"line 9" }\n');
    expect(() => JSON.parse(text.replace(/```json\s*|```/g, ""))).toThrow();

    const result = parseAgentResponse(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repairs).toBe(1);
    expect(result.value.diff[0]?.hunks[0]?.lines).toHaveLength(20);
    expect(result.value.diff[0]?.hunks[0]?.lines[10]?.content).toBe("line 10");
  });

  it("puts back a comma dropped between two properties", () => {
    const text = '```json\n{"summary": "s"\n "steps": [], "explanation": "e", "diff": [], "confidence": "low"}\n```';
    const result = parseAgentResponse(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.repairs).toBe(1);
  });

  it("repairs several dropped commas in one response", () => {
    const text = response(lineObjects(6), "\n");
    const result = parseAgentResponse(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.repairs).toBe(5);
      expect(result.value.diff[0]?.hunks[0]?.lines).toHaveLength(6);
    }
  });

  it("escapes a raw line break inside a string", () => {
    const text =
      '```json\n{"summary": "one\ntwo", "steps": [], "explanation": "e", "diff": [], "confidence": "low"}\n```';
    const result = parseAgentResponse(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summary).toBe("one\ntwo");
      expect(result.value.repairs).toBe(1);
    }
  });

  // A response cut off mid-array reports the same "Expected ',' or ']'"
  // as a dropped comma, at the end of the text. Mending it would hand
  // over a half-written file as if it were finished.
  it("does not mend a response that was cut off (nothing follows the error)", () => {
    const full = response(lineObjects(10));
    const cut = full.slice(0, full.indexOf('"line 6"') + 8) + " }";
    const result = parseAgentResponse(cut.replace(/```$/, ""));
    expect(result.ok).toBe(false);
  });

  it("does not mend a truncated array with no closing fence", () => {
    const result = parseAgentResponse('```json\n{"summary": "s", "steps": [1, 2\n```');
    expect(result.ok).toBe(false);
  });

  it("still fails on damage a comma cannot fix, and names where", () => {
    const text =
      '```json\n{"summary": "say "hi" now", "steps": [], "explanation": "e", "diff": [], "confidence": "low"}\n```';
    const result = parseAgentResponse(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not valid JSON");
      expect(result.error).toContain("hi");
    }
  });

  it("does not let a repaired response skip the contract checks", () => {
    const text = '```json\n{"summary": "s"\n "steps": []}\n```';
    const result = parseAgentResponse(text);
    expect(result.ok).toBe(false);
  });
});

describe("new files written as blocks rather than as JSON", () => {
  const HEAD =
    '```json\n{"summary": "s", "steps": [], "explanation": "e", "diff": [], "confidence": "high"}\n```\n';

  // A new file as one JSON object per line gave a small model a 200-line
  // array to keep balanced, and it lost a bracket. As plain text there is
  // nothing to balance.
  it("turns a file block into an all-add diff for a new file", () => {
    const text = `${HEAD}<<<FILE calculator.py
import tkinter as tk
print("hi")
FILE>>>`;
    const result = parseAgentResponse(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const file = result.value.diff[0];
    expect(file?.filePath).toBe("calculator.py");
    const lines = file?.hunks[0]?.lines ?? [];
    expect(lines.every((l) => l.type === "add")).toBe(true);
    expect(lines.map((l) => l.content).join("\n")).toBe('import tkinter as tk\nprint("hi")\n');
    expect(file?.hunks[0]?.header).toBe("@@ -0,0 +1,3 @@");
  });

  it("keeps code that looks like JSON or a fence exactly as written", () => {
    const body = 'data = {"a": [1, 2,]}\n```\nend';
    const result = parseAgentResponse(`${HEAD}<<<FILE notes.md\n${body}\nFILE>>>`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const content = (result.value.diff[0]?.hunks[0]?.lines ?? []).map((l) => l.content).join("\n");
    expect(content).toBe(`${body}\n`);
  });

  it("reads several files, and works when the JSON leaves out diff", () => {
    const head =
      '```json\n{"summary": "s", "steps": [], "explanation": "e", "confidence": "high"}\n```\n';
    const result = parseAgentResponse(
      `${head}<<<FILE a.py\nx = 1\nFILE>>>\n\n<<<FILE b/README.md\n# b\nFILE>>>`
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.diff.map((d) => d.filePath)).toEqual(["a.py", "b/README.md"]);
  });

  it("refuses a file block that never ends, rather than keeping half a file", () => {
    const result = parseAgentResponse(`${HEAD}<<<FILE a.py\nx = 1\ny = `);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("a.py");
  });

  it("refuses a file block with no path", () => {
    const result = parseAgentResponse(`${HEAD}<<<FILE \nx\nFILE>>>`);
    expect(result.ok).toBe(false);
  });
});
