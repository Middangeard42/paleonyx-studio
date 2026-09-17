import { describe, expect, it } from "vitest";
import type { McpServerConfig, McpToolInfo } from "@paleonyx/shared-types";
import {
  acceptToolList,
  approvalState,
  approveServer,
  fingerprintServer,
  isToolEnabled,
  newTools,
  parseApprovals,
  setToolEnabled,
} from "./approval.js";

const server: McpServerConfig = {
  id: "notes",
  command: "node",
  args: ["server.js"],
  env: { B: "2", A: "1" },
};

function tools(...names: string[]): McpToolInfo[] {
  return names.map((name) => ({
    name,
    description: "",
    inputSchema: { type: "object", properties: {} },
  }));
}

describe("approval of a configuration", () => {
  it("ignores the order environment variables are written in", () => {
    expect(fingerprintServer(server)).toBe(
      fingerprintServer({ ...server, env: { A: "1", B: "2" } })
    );
  });

  it("changes with anything that changes what runs", () => {
    const base = fingerprintServer(server);
    expect(fingerprintServer({ ...server, command: "python" })).not.toBe(base);
    expect(fingerprintServer({ ...server, args: ["other.js"] })).not.toBe(base);
    expect(fingerprintServer({ ...server, args: ["server.js", "--x"] })).not.toBe(base);
    expect(fingerprintServer({ ...server, env: { ...server.env, NODE_OPTIONS: "--require evil.js" } })).not.toBe(base);
    expect(fingerprintServer({ ...server, env: { B: "2", A: "changed" } })).not.toBe(base);
  });

  // Not the same as a change: args of ["a b"] and ["a", "b"] would read
  // alike if joined into one line.
  it("keeps argument boundaries", () => {
    expect(fingerprintServer({ ...server, args: ["a b"] })).not.toBe(
      fingerprintServer({ ...server, args: ["a", "b"] })
    );
  });

  it("asks again when the configuration changes after approval", () => {
    const approval = approveServer(server);
    expect(approvalState(server, undefined)).toBe("not-approved");
    expect(approvalState(server, approval)).toBe("approved");
    expect(approvalState({ ...server, command: "python" }, approval)).toBe("changed");
  });

  // The id is not part of what runs; renaming a server in the file does
  // not change the program, but the approval is stored under the id, so
  // a renamed server is simply a new, unapproved one.
  it("does not depend on the name it is listed under", () => {
    expect(fingerprintServer({ ...server, id: "other" })).toBe(fingerprintServer(server));
  });
});

describe("which tools the agent may use", () => {
  it("enables the tools a newly approved server first reports", () => {
    const approval = acceptToolList(approveServer(server), tools("lookup", "search"));
    expect(approval.enabledTools).toEqual(["lookup", "search"]);
    expect(newTools(approval, tools("lookup", "search"))).toEqual([]);
  });

  it("leaves a tool that appears later disabled", () => {
    const first = acceptToolList(approveServer(server), tools("lookup"));
    const later = acceptToolList(first, tools("lookup", "send_email"));
    expect(later).toBe(first);
    expect(isToolEnabled(later, "send_email")).toBe(false);
    expect(newTools(later, tools("lookup", "send_email"))).toEqual(["send_email"]);
  });

  it("leaves tools disabled when the first listing was empty", () => {
    const empty = acceptToolList(approveServer(server), []);
    const later = acceptToolList(empty, tools("send_email"));
    expect(isToolEnabled(later, "send_email")).toBe(false);
    expect(newTools(later, tools("send_email"))).toEqual(["send_email"]);
  });

  it("keeps the user's choice across listings", () => {
    const first = acceptToolList(approveServer(server), tools("lookup", "search"));
    const off = setToolEnabled(first, "search", false);
    expect(isToolEnabled(acceptToolList(off, tools("lookup", "search")), "search")).toBe(false);
  });

  it("counts a choice either way as having seen the tool", () => {
    const first = acceptToolList(approveServer(server), tools("lookup"));
    const on = setToolEnabled(first, "send_email", true);
    expect(isToolEnabled(on, "send_email")).toBe(true);
    expect(newTools(on, tools("lookup", "send_email"))).toEqual([]);

    const off = setToolEnabled(first, "send_email", false);
    expect(isToolEnabled(off, "send_email")).toBe(false);
    expect(newTools(off, tools("lookup", "send_email"))).toEqual([]);
  });

  it("does not list a tool twice when enabled twice", () => {
    const first = acceptToolList(approveServer(server), tools("lookup"));
    const again = setToolEnabled(setToolEnabled(first, "lookup", true), "lookup", true);
    expect(again.enabledTools).toEqual(["lookup"]);
  });
});

describe("parseApprovals", () => {
  it("reads back what was stored", () => {
    const stored = { notes: acceptToolList(approveServer(server), tools("lookup")) };
    expect(parseApprovals(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it("drops entries it cannot trust, leaving them to be approved again", () => {
    const good = approveServer(server);
    expect(
      parseApprovals({
        good,
        noFingerprint: { ...good, fingerprint: 5 },
        noListed: { fingerprint: "x", seenTools: [], enabledTools: [] },
        badTools: { ...good, enabledTools: ["a", 1] },
        notObject: "yes",
      })
    ).toEqual({ good });
    expect(parseApprovals(null)).toEqual({});
    expect(parseApprovals(["x"])).toEqual({});
  });
});
