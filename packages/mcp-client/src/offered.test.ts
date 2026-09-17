import { describe, expect, it, vi } from "vitest";
import type { McpServerApproval, McpToolInfo } from "@paleonyx/shared-types";
import { offeredTools } from "./offered.js";

function tool(name: string): McpToolInfo {
  return {
    name,
    description: `Does ${name}.`,
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
  };
}

function approval(enabled: string[]): McpServerApproval {
  return { fingerprint: "x", listed: true, seenTools: enabled, enabledTools: enabled };
}

function fakeClient() {
  return { callTool: vi.fn(async () => ({ text: "ok", isError: false })) };
}

describe("offeredTools", () => {
  it("offers only enabled tools, named for the model", () => {
    const { tools, problems } = offeredTools([
      {
        serverId: "notes",
        client: fakeClient(),
        tools: [tool("lookup"), tool("delete_all")],
        approval: approval(["lookup"]),
      },
    ]);
    expect(problems).toEqual([]);
    expect(tools.map((offered) => offered.definition)).toEqual([
      {
        name: "mcp__notes__lookup",
        description: "Does lookup.",
        parameters: { type: "object", properties: { q: { type: "string" } } },
      },
    ]);
    expect(tools[0]).toMatchObject({ source: "notes", toolName: "lookup" });
  });

  it("calls the right server by the tool's own name", async () => {
    const notes = fakeClient();
    const search = fakeClient();
    const { tools } = offeredTools(
      [
        { serverId: "notes", client: notes, tools: [tool("find.all")], approval: approval(["find.all"]) },
        { serverId: "search", client: search, tools: [tool("find.all")], approval: approval(["find.all"]) },
      ],
      5000
    );
    const target = tools.find((offered) => offered.definition.name === "mcp__search__find_all");
    await target?.call({ q: "x" });
    expect(search.callTool).toHaveBeenCalledWith("find.all", { q: "x" }, 5000);
    expect(notes.callTool).not.toHaveBeenCalled();
  });

  // "a.b" and "a_b" both become "a_b" for the model. Whichever came
  // second must not quietly receive the first one's calls.
  it("leaves out a tool whose model name is already taken, and says so", () => {
    const client = fakeClient();
    const { tools, problems } = offeredTools([
      {
        serverId: "notes",
        client,
        tools: [tool("find.all"), tool("find_all")],
        approval: approval(["find.all", "find_all"]),
      },
    ]);
    expect(tools.map((offered) => offered.toolName)).toEqual(["find.all"]);
    expect(problems).toEqual([
      { serverId: "notes", message: expect.stringMatching(/"find_all".*"find\.all" from notes/) },
    ]);
  });
});
