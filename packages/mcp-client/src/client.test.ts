import { describe, expect, it } from "vitest";
import {
  LEGACY_PROTOCOL_VERSIONS,
  MAX_TOOL_PAGES,
  MAX_TOOLS_PER_SERVER,
  MODERN_PROTOCOL_VERSION,
  McpClient,
  McpError,
} from "./client.js";
import type { OpenTransport } from "./client.js";
import { CLIENT_INFO, ScriptedServer, textTool } from "./testing/scripted-server.js";
import type { ScriptedServerOptions } from "./testing/scripted-server.js";

async function connect(options: ScriptedServerOptions, probeTimeoutMs = 50) {
  const server = new ScriptedServer(options);
  const client = await McpClient.connect(server.open, {
    clientInfo: CLIENT_INFO,
    probeTimeoutMs,
    requestTimeoutMs: 1000,
  });
  return { server, client };
}

async function connectError(options: ScriptedServerOptions): Promise<{ server: ScriptedServer; error: McpError }> {
  const server = new ScriptedServer(options);
  try {
    await McpClient.connect(server.open, { clientInfo: CLIENT_INFO, probeTimeoutMs: 50, requestTimeoutMs: 1000 });
  } catch (error) {
    if (error instanceof McpError) return { server, error };
    throw error;
  }
  throw new Error("expected the connection to fail");
}

function meta(message: { params?: Record<string, unknown> }) {
  return message.params?._meta as Record<string, unknown> | undefined;
}

describe("finding out which protocol a server speaks", () => {
  it("uses a current server without a handshake", async () => {
    const { server, client } = await connect({
      era: "modern",
      tools: [textTool("lookup")],
      serverInfo: { name: "notes", version: "1.2.0" },
    });

    expect(client.protocolVersion).toBe(MODERN_PROTOCOL_VERSION);
    expect(client.serverName).toBe("notes");
    expect(server.requests("initialize")).toHaveLength(0);

    await client.listTools();
    const [listing] = server.requests("tools/list");
    // No session to remember it: every request carries its version.
    expect(meta(listing!)).toMatchObject({
      "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
    });
  });

  it("probes with the current version in the request's metadata", async () => {
    const { server } = await connect({ era: "modern" });
    const [probe] = server.requests("server/discover");
    expect(meta(probe!)?.["io.modelcontextprotocol/protocolVersion"]).toBe(MODERN_PROTOCOL_VERSION);
  });

  it("falls back to the handshake when an older server rejects the probe", async () => {
    const { server, client } = await connect({
      era: "legacy",
      beforeInitialize: "error",
      tools: [textTool("lookup")],
    });

    expect(client.protocolVersion).toBe("2025-11-25");
    const [init] = server.requests("initialize");
    expect(init?.params).toMatchObject({
      protocolVersion: LEGACY_PROTOCOL_VERSIONS[0],
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(["lookup"]);
    // The session is opened before anything is asked of it.
    const methods = server.received.map((message) => message.method);
    expect(methods.indexOf("notifications/initialized")).toBeLessThan(methods.indexOf("tools/list"));
    expect(meta(server.requests("tools/list")[0]!)).toBeUndefined();
  });

  // Some older servers say nothing at all to a request that arrives
  // before the handshake. Waiting forever would look like a hang.
  it("falls back when an older server ignores the probe", async () => {
    const { client } = await connect({ era: "legacy", beforeInitialize: "silent" });
    expect(client.protocolVersion).toBe("2025-11-25");
  });

  it("accepts an older handshake version the server prefers", async () => {
    const { client } = await connect({ era: "legacy", legacyVersions: ["2024-11-05"] });
    expect(client.protocolVersion).toBe("2024-11-05");
  });

  it("refuses a handshake version it does not know, and stops the server", async () => {
    const { server, error } = await connectError({ era: "legacy", legacyVersions: ["2023-01-01"] });
    expect(error.kind).toBe("unsupported-version");
    expect(error.message).toContain("2023-01-01");
    expect(server.closeRequests).toBe(1);
  });

  it("uses a handshake version a current server lists when it rejects this one", async () => {
    const { server, client } = await connect({
      era: "dual",
      modernVersions: ["2027-01-01"],
      legacyVersions: ["2025-06-18"],
    });
    expect(client.protocolVersion).toBe("2025-06-18");
    expect(server.requests("initialize")[0]?.params?.protocolVersion).toBe("2025-06-18");
  });

  // The spec is explicit: the unsupported-version error identifies a
  // current server, so falling back to the handshake would be wrong.
  it("does not fall back when a current server supports nothing in common", async () => {
    const { server, error } = await connectError({ era: "modern", modernVersions: ["2027-01-01"] });
    expect(error.kind).toBe("unsupported-version");
    expect(error.message).toContain("2027-01-01");
    expect(server.requests("initialize")).toHaveLength(0);
  });

  it("reports a version rejection that lists no versions", async () => {
    let initializeSent = false;
    const open: OpenTransport = async (events) => ({
      send: async (line) => {
        const { id, method } = JSON.parse(line) as { id?: number; method: string };
        if (method === "initialize") initializeSent = true;
        if (id === undefined) return;
        queueMicrotask(() =>
          events.message(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              error: { code: -32022, message: "Unsupported protocol version" },
            })
          )
        );
      },
      close: async () => queueMicrotask(() => events.closed({ exitCode: 0, log: "" })),
    });
    const error = (await McpClient.connect(open, { clientInfo: CLIENT_INFO }).catch(
      (caught: unknown) => caught
    )) as McpError;
    expect(error.kind).toBe("protocol");
    expect(initializeSent).toBe(false);
  });

  it("reports a server that stops before answering, with what it printed", async () => {
    const server = new ScriptedServer({ era: "modern" });
    const promise = McpClient.connect(
      async (events) => {
        const transport = await server.open(events);
        server.exit({ exitCode: 3, log: "Error: GITHUB_TOKEN is not set" });
        return transport;
      },
      { clientInfo: CLIENT_INFO, probeTimeoutMs: 1000 }
    );
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).kind).toBe("stopped");
    expect((error as McpError).message).toContain("exit code 3");
    expect((error as McpError).log).toContain("GITHUB_TOKEN is not set");
  });

  it("ignores lines that are not messages, and keeps them for diagnosis", async () => {
    const { server, client } = await connect({
      era: "legacy",
      banner: ["Weather server v1 listening on stdio", "{not json"],
      tools: [textTool("lookup")],
    });
    expect((await client.listTools()).tools).toHaveLength(1);

    server.exit({ exitCode: 1, log: "" });
    const error = (await client.listTools().catch((caught: unknown) => caught)) as McpError;
    expect(error.kind).toBe("stopped");
    expect(error.log).toContain("Weather server v1 listening on stdio");
  });
});

describe("listing tools", () => {
  it("follows the pages a server hands back", async () => {
    const names = ["a", "b", "c", "d", "e"];
    const { server, client } = await connect({
      era: "modern",
      tools: names.map((name) => textTool(name)),
      pageSize: 2,
    });
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(names);
    expect(listed.problems).toEqual([]);
    expect(server.requests("tools/list").map((request) => request.params?.cursor)).toEqual([
      undefined,
      "page-1",
      "page-2",
    ]);
  });

  it("stops when a server repeats a cursor", async () => {
    const { server, client } = await connect({
      era: "modern",
      tools: [textTool("a"), textTool("b")],
      pageSize: 1,
      cursorFor: () => "same",
    });
    const listed = await client.listTools();
    expect(listed.problems.join()).toMatch(/repeats itself/);
    expect(server.requests("tools/list")).toHaveLength(2);
  });

  it("stops after a bounded number of pages", async () => {
    let page = 0;
    const { server, client } = await connect({
      era: "modern",
      tools: [textTool("a")],
      cursorFor: () => `cursor-${(page += 1)}`,
    });
    const listed = await client.listTools();
    expect(server.requests("tools/list")).toHaveLength(MAX_TOOL_PAGES);
    expect(listed.problems.join()).toMatch(/pages/);
  });

  it("keeps a bounded number of tools", async () => {
    const tools = Array.from({ length: MAX_TOOLS_PER_SERVER + 5 }, (_, index) => textTool(`t${index}`));
    const { client } = await connect({ era: "modern", tools });
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(MAX_TOOLS_PER_SERVER);
    expect(listed.problems.join()).toMatch(/more than/);
  });

  it("leaves out unusable and repeated tools, and says why", async () => {
    const { client } = await connect({
      era: "modern",
      tools: [textTool("ok"), { name: "bad name!", inputSchema: { type: "object" } }, textTool("ok")],
    });
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(["ok"]);
    expect(listed.problems).toHaveLength(2);
    expect(listed.problems.join("\n")).toMatch(/bad name!/);
    expect(listed.problems.join("\n")).toMatch(/twice/);
  });

  it("does not ask a server that offers no tools", async () => {
    const { server, client } = await connect({ era: "modern", capabilities: { resources: {} } });
    expect(client.offersTools).toBe(false);
    expect(await client.listTools()).toEqual({ tools: [], problems: [] });
    expect(server.requests("tools/list")).toHaveLength(0);
  });

  it("reports a list that is not a list", async () => {
    const { client } = await connect({ era: "modern", tools: "nope" as unknown as unknown[] });
    const error = (await client.listTools().catch((caught: unknown) => caught)) as McpError;
    expect(error.kind).toBe("protocol");
  });
});

describe("calling a tool", () => {
  it("returns the tool's text, with its arguments passed through", async () => {
    const { server, client } = await connect({
      era: "legacy",
      call: (name, args) => ({
        result: { content: [{ type: "text", text: `${name}: ${JSON.stringify(args)}` }] },
      }),
    });
    const outcome = await client.callTool("lookup", { topic: "sum" });
    expect(outcome).toEqual({ text: 'lookup: {"topic":"sum"}', isError: false });
    expect(server.requests("tools/call")[0]?.params).toEqual({
      name: "lookup",
      arguments: { topic: "sum" },
    });
  });

  it("passes on a failure the tool reported", async () => {
    const { client } = await connect({
      era: "modern",
      call: () => ({ result: { isError: true, content: [{ type: "text", text: "No such topic" }] } }),
    });
    expect(await client.callTool("lookup", {})).toEqual({ text: "No such topic", isError: true });
  });

  it("rejects with the server's error", async () => {
    const { client } = await connect({
      era: "modern",
      call: () => ({ error: { code: -32602, message: "Unknown tool: lookup" } }),
    });
    const error = (await client.callTool("lookup", {}).catch((caught: unknown) => caught)) as McpError;
    expect(error.kind).toBe("rejected");
    expect(error.code).toBe(-32602);
    expect(error.message).toBe("Unknown tool: lookup");
  });

  it("rejects an answer it cannot read", async () => {
    const { client } = await connect({
      era: "modern",
      call: () => ({ result: { content: "not a list" } }),
    });
    const error = (await client.callTool("lookup", {}).catch((caught: unknown) => caught)) as McpError;
    expect(error.kind).toBe("protocol");
  });

  it("gives up on a call that never ends, and tells the server", async () => {
    const { server, client } = await connect({ era: "modern", call: () => "hang" });
    const error = (await client.callTool("lookup", {}, 30).catch((caught: unknown) => caught)) as McpError;
    expect(error.kind).toBe("timeout");

    const [call] = server.requests("tools/call");
    await Promise.resolve();
    const [cancel] = server.requests("notifications/cancelled");
    expect(cancel?.params).toMatchObject({ requestId: call?.id });
  });

  it("drops an answer that arrives after giving up", async () => {
    const { server, client } = await connect({ era: "modern", call: () => "hang" });
    await client.callTool("lookup", {}, 20).catch(() => undefined);
    const [call] = server.requests("tools/call");
    server.write(JSON.stringify({ jsonrpc: "2.0", id: call?.id, result: { content: [] } }));
    // Still usable afterwards: the late answer did not disturb anything.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.stopped).toBe(false);
  });

  it("fails calls in flight when the server stops", async () => {
    const { server, client } = await connect({ era: "modern", call: () => "hang" });
    const pending = client.callTool("lookup", {});
    server.exit({ exitCode: null, log: "killed" });
    const error = (await pending.catch((caught: unknown) => caught)) as McpError;
    expect(error.kind).toBe("stopped");
    expect(error.log).toContain("killed");
  });
});

describe("requests from the server", () => {
  it("answers pings from an older server, and declines anything else", async () => {
    const { server } = await connect({ era: "legacy" });
    server.write(JSON.stringify({ jsonrpc: "2.0", id: "p1", method: "ping" }));
    server.write(JSON.stringify({ jsonrpc: "2.0", id: "s1", method: "sampling/createMessage", params: {} }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const replies = server.received.filter((message) => message.method === undefined);
    expect(replies).toEqual([
      { jsonrpc: "2.0", id: "p1", result: {} },
      {
        jsonrpc: "2.0",
        id: "s1",
        error: { code: -32601, message: "Paleonyx Studio does not support sampling/createMessage." },
      },
    ]);
  });

  // A current client must never send a response, and a current server
  // must never ask for one.
  it("stays silent when a current server sends a request", async () => {
    const { server } = await connect({ era: "modern" });
    server.write(JSON.stringify({ jsonrpc: "2.0", id: "p1", method: "ping" }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.received.filter((message) => message.method === undefined)).toEqual([]);
  });
});

describe("stopping", () => {
  it("asks the server to stop, and refuses requests afterwards", async () => {
    const { server, client } = await connect({ era: "modern" });
    await client.close();
    expect(server.closeRequests).toBe(1);
    expect(client.stopped).toBe(true);
    const error = (await client.listTools().catch((caught: unknown) => caught)) as McpError;
    expect(error.kind).toBe("stopped");
  });

  it("tells listeners once, however it stops", async () => {
    const { server, client } = await connect({ era: "modern" });
    const exits: unknown[] = [];
    client.onExit((exit) => exits.push(exit));
    server.exit({ exitCode: 2, log: "" });
    await client.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(exits).toEqual([{ exitCode: 2, log: "" }]);
  });
});
