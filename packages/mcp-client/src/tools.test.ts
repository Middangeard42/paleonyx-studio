import { describe, expect, it } from "vitest";
import {
  MAX_DESCRIPTION_CHARS,
  MAX_RESULT_CHARS,
  MAX_SCHEMA_CHARS,
  describeToolResult,
  modelToolName,
  parseTool,
} from "./tools.js";

const schema = { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] };

describe("parseTool", () => {
  it("keeps what a model needs", () => {
    expect(parseTool({ name: "notes.lookup", title: "Look up", description: "Finds notes.", inputSchema: schema })).toEqual({
      ok: true,
      tool: { name: "notes.lookup", title: "Look up", description: "Finds notes.", inputSchema: schema },
    });
  });

  it("accepts a tool with no description or properties", () => {
    const parsed = parseTool({ name: "now", inputSchema: { type: "object" } });
    expect(parsed).toEqual({
      ok: true,
      tool: { name: "now", description: "", inputSchema: { type: "object", properties: {} } },
    });
  });

  it("refuses names a model's function format could not carry", () => {
    for (const name of ["has space", "semi;colon", "", "x".repeat(129), "naïve"]) {
      expect(parseTool({ name, inputSchema: schema }), name).toMatchObject({ ok: false });
    }
  });

  it("refuses a tool without an object input schema", () => {
    expect(parseTool({ name: "a" })).toMatchObject({ ok: false, error: expect.stringMatching(/no input schema/) });
    expect(parseTool({ name: "a", inputSchema: { type: "string" } })).toMatchObject({ ok: false });
    expect(parseTool({ name: "a", inputSchema: { type: "object", properties: [] } })).toMatchObject({ ok: false });
    expect(parseTool({ name: "a", inputSchema: { type: "object", required: [1] } })).toMatchObject({ ok: false });
  });

  // MCP forbids following remote references automatically. The simplest
  // way to guarantee nothing downstream does is not to pass them on.
  it("refuses a schema that points outside itself, however deep", () => {
    const remote = {
      type: "object",
      properties: { a: { anyOf: [{ type: "string" }, { $ref: "https://example.com/s.json" }] } },
    };
    expect(parseTool({ name: "a", inputSchema: remote })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/example\.com/),
    });
  });

  it("keeps local references and the definitions they point at", () => {
    const local = {
      type: "object",
      properties: { when: { $ref: "#/$defs/date" } },
      $defs: { date: { type: "string" } },
      additionalProperties: false,
    };
    expect(parseTool({ name: "a", inputSchema: local })).toEqual({
      ok: true,
      tool: { name: "a", description: "", inputSchema: local },
    });
  });

  it("caps a long description", () => {
    const parsed = parseTool({ name: "a", description: "x".repeat(MAX_DESCRIPTION_CHARS + 50), inputSchema: schema });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.tool.description).toHaveLength(MAX_DESCRIPTION_CHARS + 1);
    expect(parsed.tool.description.endsWith("…")).toBe(true);
  });

  it("refuses a schema too large for a model to use", () => {
    const huge = { type: "object", properties: { a: { description: "x".repeat(MAX_SCHEMA_CHARS) } } };
    expect(parseTool({ name: "a", inputSchema: huge })).toMatchObject({ ok: false });
  });
});

describe("describeToolResult", () => {
  it("joins the text parts", () => {
    expect(
      describeToolResult({
        content: [
          { type: "text", text: "one" },
          { type: "text", text: "two" },
        ],
      })
    ).toEqual({ text: "one\n\ntwo", isError: false });
  });

  it("names what it leaves out", () => {
    const { text } = describeToolResult({
      content: [
        { type: "image", data: "AAAA", mimeType: "image/png" },
        { type: "audio", data: "AAAA" },
        { type: "video" },
        { type: "resource", resource: { uri: "file:///x.bin", blob: "AAAA" } },
      ],
    })!;
    expect(text).toContain("an image (image/png)");
    expect(text).toContain("audio");
    expect(text).toContain('type "video"');
    expect(text).toContain("file:///x.bin");
    expect(text).not.toContain("AAAA");
  });

  it("includes links and embedded text", () => {
    const { text } = describeToolResult({
      content: [
        { type: "resource_link", uri: "file:///src/main.rs", name: "main.rs" },
        { type: "resource", resource: { uri: "file:///notes.md", text: "# Notes" } },
      ],
    })!;
    expect(text).toBe("Link: main.rs file:///src/main.rs\n\nfile:///notes.md:\n# Notes");
  });

  it("falls back to structured content only when there is no text", () => {
    expect(describeToolResult({ content: [], structuredContent: { temperature: 22 } })?.text).toBe(
      '{"temperature":22}'
    );
    expect(
      describeToolResult({
        content: [{ type: "text", text: "22 degrees" }],
        structuredContent: { temperature: 22 },
      })?.text
    ).toBe("22 degrees");
  });

  it("says so when there is nothing", () => {
    expect(describeToolResult({ content: [] })?.text).toBe("The tool returned nothing.");
  });

  it("treats a missing result type as complete, and an unknown one as unreadable", () => {
    expect(describeToolResult({ resultType: "complete", content: [] })).toBeDefined();
    expect(describeToolResult({ content: [] })).toBeDefined();
    expect(describeToolResult({ resultType: "mystery", content: [] })).toBeUndefined();
    expect(describeToolResult({ content: {} })).toBeUndefined();
  });

  it("explains a request for more input it cannot answer", () => {
    const outcome = describeToolResult({ resultType: "input_required", inputRequests: {} });
    expect(outcome?.isError).toBe(true);
    expect(outcome?.text).toMatch(/more information/);
  });

  it("cuts a long result and says how much is missing", () => {
    const { text } = describeToolResult({
      content: [{ type: "text", text: "x".repeat(MAX_RESULT_CHARS + 10) }],
    })!;
    expect(text.startsWith("x".repeat(MAX_RESULT_CHARS))).toBe(true);
    expect(text).toContain("10 more characters");
  });

  it("only treats a literal true as an error", () => {
    expect(describeToolResult({ content: [], isError: "yes" })?.isError).toBe(false);
    expect(describeToolResult({ content: [], isError: true })?.isError).toBe(true);
  });
});

describe("modelToolName", () => {
  it("prefixes the server and swaps dots out", () => {
    expect(modelToolName("notes", "search.all")).toBe("mcp__notes__search_all");
  });

  it("fits function-name limits", () => {
    const name = modelToolName("server", "t".repeat(120));
    expect(name).toHaveLength(64);
    expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
