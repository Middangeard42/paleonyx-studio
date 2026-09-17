import { describe, expect, it } from "vitest";
import { describeCommandLine, describeState } from "./ConnectedToolsView.js";
import type { ConnectedServerView } from "./ConnectedToolsView.js";

describe("describeCommandLine", () => {
  it("shows a plain command as typed", () => {
    expect(describeCommandLine("npx", ["-y", "@example/server"])).toBe("npx -y @example/server");
  });

  // The user decides whether to trust a server from this line, so two
  // different argument lists must never read the same.
  it("keeps argument boundaries visible", () => {
    expect(describeCommandLine("node", ["a b"])).toBe('node "a b"');
    expect(describeCommandLine("node", ["a", "b"])).toBe("node a b");
    expect(describeCommandLine("node", [""])).toBe('node ""');
    expect(describeCommandLine("node", ['say "hi"'])).toBe('node "say \\"hi\\""');
    expect(describeCommandLine("C:\\Program Files\\x.exe", [])).toBe('"C:\\\\Program Files\\\\x.exe"');
  });
});

function view(overrides: Partial<ConnectedServerView>): ConnectedServerView {
  return {
    id: "notes",
    command: "node",
    args: [],
    env: {},
    approval: "approved",
    state: { kind: "stopped" },
    tools: [],
    problems: [],
    ...overrides,
  };
}

describe("describeState", () => {
  // A changed configuration must read as needing attention even while the
  // old one is still described as running somewhere.
  it("puts approval ahead of whatever the server is doing", () => {
    expect(
      describeState(view({ approval: "changed", state: { kind: "running", protocolVersion: "x" } }))
    ).toEqual({ tone: "warning", label: "Changed — check again" });
    expect(describeState(view({ approval: "not-approved" })).label).toBe("Needs your OK");
  });

  it("counts the tools that are on", () => {
    const running = view({
      state: { kind: "running", protocolVersion: "2025-11-25" },
      tools: [
        { name: "a", description: "", enabled: true, isNew: false },
        { name: "b", description: "", enabled: false, isNew: true },
      ],
    });
    expect(describeState(running)).toEqual({ tone: "success", label: "Running · 1 of 2 tools on" });
  });

  it("marks a failure as one", () => {
    expect(describeState(view({ state: { kind: "failed", message: "x", log: "" } })).tone).toBe("danger");
  });
});
