import { describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "@paleonyx/shared-types";
import { fingerprintServer } from "@paleonyx/mcp-client";
import { ScriptedServer, textTool } from "@paleonyx/mcp-client/testing";
import type { ScriptedServerOptions } from "@paleonyx/mcp-client/testing";
import { ServerManager } from "./connected-servers.js";

const NOTES: McpServerConfig = { id: "notes", command: "node", args: ["notes.js"], env: {} };

function setup(behaviour: (config: McpServerConfig) => ScriptedServerOptions = () => ({
  era: "legacy",
  tools: [textTool("lookup")],
})) {
  const started: { config: McpServerConfig; server: ScriptedServer }[] = [];
  const onToolsListed = vi.fn();
  const manager = new ServerManager({
    clientInfo: { name: "test", version: "0" },
    onChange: () => {},
    onToolsListed,
    openTransport: (config) => {
      const server = new ScriptedServer(behaviour(config));
      started.push({ config, server });
      return server.open;
    },
  });
  return { manager, started, onToolsListed };
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("ServerManager", () => {
  it("starts what is wanted and reports its tools", async () => {
    const { manager, started, onToolsListed } = setup();
    manager.reconcile([NOTES]);
    expect(manager.status("notes").kind).toBe("starting");
    await until(() => manager.status("notes").kind === "running", "running");

    expect(started).toHaveLength(1);
    expect(manager.running().map((session) => session.serverId)).toEqual(["notes"]);
    expect(onToolsListed).toHaveBeenCalledWith("notes", fingerprintServer(NOTES), [
      expect.objectContaining({ name: "lookup" }),
    ]);
  });

  it("does not start a server twice", async () => {
    const { manager, started } = setup();
    manager.reconcile([NOTES]);
    manager.reconcile([NOTES]);
    await until(() => manager.status("notes").kind === "running", "running");
    manager.reconcile([NOTES]);
    expect(started).toHaveLength(1);
  });

  it("stops a server that is no longer wanted", async () => {
    const { manager, started } = setup();
    manager.reconcile([NOTES]);
    await until(() => manager.status("notes").kind === "running", "running");

    manager.reconcile([]);
    expect(manager.status("notes").kind).toBe("stopped");
    expect(manager.running()).toEqual([]);
    await until(() => started[0]!.server.closeRequests === 1, "the close");
  });

  // The case approval pinning exists for: the command behind a name
  // changes while the old one is running.
  it("restarts a server whose configuration changed", async () => {
    const { manager, started } = setup();
    manager.reconcile([NOTES]);
    await until(() => manager.status("notes").kind === "running", "running");

    const changed = { ...NOTES, args: ["other.js"] };
    manager.reconcile([changed]);
    await until(() => started.length === 2 && manager.status("notes").kind === "running", "restart");
    expect(started[0]!.server.closeRequests).toBe(1);
    expect(started[1]!.config).toEqual(changed);
  });

  it("reports a server that could not start, and leaves it until asked again", async () => {
    const { manager, started } = setup(() => ({ era: "modern", modernVersions: ["2099-01-01"] }));
    manager.reconcile([NOTES]);
    await until(() => manager.status("notes").kind === "failed", "the failure");

    const status = manager.status("notes");
    expect(status.kind === "failed" && status.message).toMatch(/2099-01-01/);
    manager.reconcile([NOTES]);
    expect(started).toHaveLength(1);

    manager.retry("notes");
    expect(started).toHaveLength(2);
  });

  it("tries a failed server again once its configuration changes", async () => {
    const { manager, started } = setup((config) =>
      config.args[0] === "fixed.js"
        ? { era: "legacy", tools: [] }
        : { era: "modern", modernVersions: ["2099-01-01"] }
    );
    manager.reconcile([NOTES]);
    await until(() => manager.status("notes").kind === "failed", "the failure");
    manager.reconcile([{ ...NOTES, args: ["fixed.js"] }]);
    await until(() => manager.status("notes").kind === "running", "running");
    expect(started).toHaveLength(2);
  });

  it("reports a server that stops by itself, with what it printed, and does not restart it", async () => {
    const { manager, started } = setup();
    manager.reconcile([NOTES]);
    await until(() => manager.status("notes").kind === "running", "running");

    started[0]!.server.exit({ exitCode: 1, log: "out of memory" });
    await until(() => manager.status("notes").kind === "failed", "the failure");
    const status = manager.status("notes");
    expect(status).toMatchObject({ kind: "failed", log: "out of memory" });
    expect(manager.running()).toEqual([]);

    manager.reconcile([NOTES]);
    expect(started).toHaveLength(1);
  });

  it("keeps a server the user stopped stopped, until they start it", async () => {
    const { manager, started } = setup();
    manager.reconcile([NOTES]);
    await until(() => manager.status("notes").kind === "running", "running");

    manager.pause("notes");
    expect(manager.status("notes").kind).toBe("stopped");
    manager.reconcile([NOTES]);
    expect(started).toHaveLength(1);

    manager.resume("notes");
    await until(() => manager.status("notes").kind === "running", "running again");
    expect(started).toHaveLength(2);
  });

  // A server still in its handshake has no client yet. Stopping it must
  // still end the process, not wait for a handshake that may never come.
  it("ends a server stopped before it finished starting", async () => {
    const { manager, started } = setup(() => ({ era: "legacy", beforeInitialize: "silent" }));
    manager.reconcile([NOTES]);
    await until(() => started.length === 1 && started[0]!.server.received.length > 0, "the probe");

    manager.reconcile([]);
    await until(() => started[0]!.server.closeRequests === 1, "the close");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(manager.status("notes").kind).toBe("stopped");
    expect(manager.running()).toEqual([]);
  });

  // Earlier still: stopped while the shell is still starting the process.
  // Once it has started, it must be closed straight away, not adopted.
  it("ends a server stopped while its process was still starting", async () => {
    const server = new ScriptedServer({ era: "legacy" });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const manager = new ServerManager({
      clientInfo: { name: "test", version: "0" },
      onChange: () => {},
      onToolsListed: () => {},
      openTransport: () => async (events) => {
        await gate;
        return server.open(events);
      },
    });

    manager.reconcile([NOTES]);
    manager.reconcile([]);
    release();
    await until(() => server.closeRequests === 1, "the close");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(manager.status("notes").kind).toBe("stopped");
    expect(server.requests("initialize")).toEqual([]);
  });

  it("stops everything at once", async () => {
    const { manager, started } = setup();
    const other = { ...NOTES, id: "other" };
    manager.reconcile([NOTES, other]);
    await until(() => manager.running().length === 2, "both running");
    manager.stopAll();
    expect(manager.running()).toEqual([]);
    await until(() => started.every(({ server }) => server.closeRequests === 1), "both closed");
  });
});
