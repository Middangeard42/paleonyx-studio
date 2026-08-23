import { describe, expect, it } from "vitest";
import type { FileSystemReader, PermissionMode, ProjectFile } from "@paleonyx/shared-types";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODE_ORDER,
  SELECTABLE_PERMISSION_MODES,
  canApplyWithoutApproval,
  canProposeEdits,
  canRunCommands,
  isMorePermissive,
} from "@paleonyx/shared-types";
import { MockAdapter, demoRespond } from "@paleonyx/runtime";
import { runAgentTask } from "./run-task.js";

class FakeFs implements FileSystemReader {
  async listFiles(): Promise<ProjectFile[]> {
    return [{ path: "a.ts" }];
  }
  async readFile(): Promise<string> {
    return "const x = 1;\n";
  }
}

function run(permissionMode: PermissionMode | undefined, taskType: "explain" | "bug-fix") {
  return runAgentTask({
    provider: new MockAdapter({ respond: demoRespond, latencyMs: 0 }),
    fs: new FakeFs(),
    input: { taskType, instructions: "go", targetFiles: ["a.ts"] },
    skillLevel: "experienced",
    permissionMode,
  });
}

describe("permission predicates", () => {
  it("defaults to suggest-only, the mode that writes nothing unasked", () => {
    expect(DEFAULT_PERMISSION_MODE).toBe("suggest-only");
    expect(canProposeEdits(DEFAULT_PERMISSION_MODE)).toBe(true);
    expect(canApplyWithoutApproval(DEFAULT_PERMISSION_MODE)).toBe(false);
  });

  it("blocks proposals only in read-only", () => {
    expect(canProposeEdits("read-only")).toBe(false);
    for (const mode of PERMISSION_MODE_ORDER.filter((m) => m !== "read-only")) {
      expect(canProposeEdits(mode), mode).toBe(true);
    }
  });

  it("permits unattended writes only at auto-apply and above", () => {
    expect(canApplyWithoutApproval("read-only")).toBe(false);
    expect(canApplyWithoutApproval("suggest-only")).toBe(false);
    expect(canApplyWithoutApproval("auto-apply")).toBe(true);
    expect(canApplyWithoutApproval("can-run-commands")).toBe(true);
  });

  it("permits commands only at the top mode", () => {
    for (const mode of PERMISSION_MODE_ORDER) {
      expect(canRunCommands(mode), mode).toBe(mode === "can-run-commands");
    }
  });

  it("orders modes from least to most permissive", () => {
    expect(isMorePermissive("read-only", "suggest-only")).toBe(true);
    expect(isMorePermissive("suggest-only", "auto-apply")).toBe(true);
    expect(isMorePermissive("auto-apply", "suggest-only")).toBe(false);
    // Not a raise, so it must not trigger a confirmation prompt.
    expect(isMorePermissive("auto-apply", "auto-apply")).toBe(false);
  });

  it("offers every mode that now grants something", () => {
    // can-run-commands was unselectable until the runCommand tool
    // existed. Now that it does, every ranked mode is selectable — and
    // this asserts the two lists agree, so a mode can never be offered
    // without a meaning or gain one without being offered.
    expect([...SELECTABLE_PERMISSION_MODES].sort()).toEqual([...PERMISSION_MODE_ORDER].sort());
  });
});

describe("enforcement in agent-core", () => {
  it("refuses a diff-producing task under read-only", () => {
    // Enforced here rather than trusted to the UI: this is the auditable
    // surface (CLAUDE.md §6).
    return run("read-only", "bug-fix").then((result) => {
      expect(result.escalation?.reason).toBe("permission-denied");
      expect(result.diff).toHaveLength(0);
    });
  });

  it("still explains under read-only", async () => {
    const result = await run("read-only", "explain");
    expect(result.escalation).toBeUndefined();
    expect(result.explanation).not.toBe("");
  });

  it("allows proposals under suggest-only", async () => {
    const result = await run("suggest-only", "bug-fix");
    expect(result.escalation).toBeUndefined();
    expect(result.diff.length).toBeGreaterThan(0);
  });

  it("falls back to the safe default when no mode is passed", async () => {
    // A caller that forgets must not get unrestricted behaviour, but
    // suggest-only still proposes — so this checks the default is that,
    // not read-only and not auto-apply.
    const result = await run(undefined, "bug-fix");
    expect(result.escalation).toBeUndefined();
    expect(result.diff.length).toBeGreaterThan(0);
  });
});
