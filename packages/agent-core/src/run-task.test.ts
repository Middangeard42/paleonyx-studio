import { describe, expect, it } from "vitest";
import type { FileSystemReader, ProjectFile, SkillLevel } from "@paleonyx/shared-types";
import { MockAdapter, demoRespond } from "@paleonyx/runtime";
import { runAgentTask } from "./run-task.js";

/**
 * End-to-end over the offline path: MockAdapter's canned responses
 * through prompt construction, the gated readFile tool, and response
 * parsing.
 *
 * This suite exists because a bug got past every other check. The
 * desktop app shipped a placeholder responder returning `{}` while the
 * web app had real canned responses, so with no local model reachable
 * the desktop app could not produce a usable result at all. Unit tests
 * on either side passed — nothing asserted that what the mock emits is
 * something the parser accepts. That seam is what these cover.
 */

const BUGGY_SUM = `export function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i <= numbers.length; i++) {
    total += numbers[i];
  }
  return total;
}
`;

class FakeFs implements FileSystemReader {
  constructor(private readonly files: Record<string, string>) {}
  async listFiles(): Promise<ProjectFile[]> {
    return Object.keys(this.files).map((path) => ({ path }));
  }
  async readFile(path: string): Promise<string> {
    const content = this.files[path];
    if (content === undefined) throw new Error(`missing ${path}`);
    return content;
  }
}

function provider() {
  return new MockAdapter({ respond: demoRespond, latencyMs: 0 });
}

describe("runAgentTask with the offline demo responder", () => {
  it("produces a parseable bug-fix plan with a usable diff", async () => {
    const result = await runAgentTask({
      provider: provider(),
      fs: new FakeFs({ "src/sum.ts": BUGGY_SUM }),
      input: {
        taskType: "bug-fix",
        instructions: "sum returns NaN",
        targetFiles: ["src/sum.ts"],
      },
      skillLevel: "experienced",
    });

    expect(result.escalation).toBeUndefined();
    expect(result.plan.summary).not.toBe("");
    expect(result.plan.steps.length).toBeGreaterThan(0);
    expect(result.diff.length).toBeGreaterThan(0);
    expect(result.diff[0]?.hunks.length).toBeGreaterThan(0);
  });

  it("produces a parseable explanation with no diff for an explain task", async () => {
    const result = await runAgentTask({
      provider: provider(),
      fs: new FakeFs({ "src/sum.ts": BUGGY_SUM }),
      input: {
        taskType: "explain",
        instructions: "what does this do",
        targetFiles: ["src/sum.ts"],
      },
      skillLevel: "new-to-coding",
    });

    expect(result.escalation).toBeUndefined();
    expect(result.explanation).not.toBe("");
    expect(result.diff).toHaveLength(0);
  });

  it("emits a diff that actually applies to the file it was generated from", async () => {
    // The strongest form of this check: the canned fix has to be a real
    // patch against the real fixture, not merely well-formed JSON.
    const { applyFileDiff } = await import("@paleonyx/vcs");
    const result = await runAgentTask({
      provider: provider(),
      fs: new FakeFs({ "src/sum.ts": BUGGY_SUM }),
      input: {
        taskType: "bug-fix",
        instructions: "sum returns NaN",
        targetFiles: ["src/sum.ts"],
      },
      skillLevel: "professional",
    });

    const patched = applyFileDiff(BUGGY_SUM, result.diff[0]!);
    expect(patched.ok).toBe(true);
    if (patched.ok) {
      expect(patched.content).toContain("i < numbers.length");
      expect(patched.content).not.toContain("i <= numbers.length");
    }
  });

  it("works at every skill level", async () => {
    const levels: SkillLevel[] = ["new-to-coding", "experienced", "professional"];
    for (const skillLevel of levels) {
      const result = await runAgentTask({
        provider: provider(),
        fs: new FakeFs({ "src/sum.ts": BUGGY_SUM }),
        input: {
          taskType: "bug-fix",
          instructions: "sum returns NaN",
          targetFiles: ["src/sum.ts"],
        },
        skillLevel,
      });
      expect(result.escalation, `escalated at ${skillLevel}`).toBeUndefined();
    }
  });

  it("escalates rather than inventing a plan when the model returns nothing usable", async () => {
    // The exact shape of the bug this suite was written for.
    const result = await runAgentTask({
      provider: new MockAdapter({ respond: () => "```json\n{}\n```", latencyMs: 0 }),
      fs: new FakeFs({ "src/sum.ts": BUGGY_SUM }),
      input: {
        taskType: "bug-fix",
        instructions: "sum returns NaN",
        targetFiles: ["src/sum.ts"],
      },
      skillLevel: "experienced",
    });

    expect(result.escalation?.reason).toBe("low-confidence");
    expect(result.diff).toHaveLength(0);
  });

  it("asks once more when the first reply is not the agreed JSON", async () => {
    // Observed with a small tool-calling model: after using tools it
    // replies with prose, the contract being several messages back. One
    // reminder usually recovers it, and giving up instead would discard
    // work already paid for.
    let call = 0;
    const provider = new MockAdapter({
      respond: (request) => {
        call += 1;
        if (call === 1) return "Let me look at that for you.";
        return demoRespond(request);
      },
      latencyMs: 0,
    });

    const result = await runAgentTask({
      provider,
      fs: new FakeFs({ "src/sum.ts": BUGGY_SUM }),
      input: {
        taskType: "bug-fix",
        instructions: "sum returns NaN",
        targetFiles: ["src/sum.ts"],
      },
      skillLevel: "experienced",
    });

    expect(call).toBe(2);
    expect(result.escalation).toBeUndefined();
    expect(result.diff.length).toBeGreaterThan(0);
  });

  it("gives up after one retry rather than pestering a model that cannot comply", async () => {
    let call = 0;
    const provider = new MockAdapter({
      respond: () => {
        call += 1;
        return "still not JSON";
      },
      latencyMs: 0,
    });

    const result = await runAgentTask({
      provider,
      fs: new FakeFs({ "src/sum.ts": BUGGY_SUM }),
      input: {
        taskType: "bug-fix",
        instructions: "sum returns NaN",
        targetFiles: ["src/sum.ts"],
      },
      skillLevel: "experienced",
    });

    expect(call).toBe(2);
    expect(result.escalation?.reason).toBe("low-confidence");
  });

  it("escalates on a tool failure instead of proceeding without the file", async () => {
    const result = await runAgentTask({
      provider: provider(),
      fs: new FakeFs({}),
      input: {
        taskType: "bug-fix",
        instructions: "sum returns NaN",
        targetFiles: ["src/missing.ts"],
      },
      skillLevel: "experienced",
    });

    expect(result.escalation?.reason).toBe("tool-failure");
  });
});
