import { describe, expect, it } from "vitest";
import type { FileSystemReader, ProjectFile, SkillLevel } from "@paleonyx/shared-types";
import { MockAdapter, demoRespond } from "@paleonyx/runtime";
import { isCreation } from "@paleonyx/vcs";
import { runAgentTask } from "./run-task.js";
import { composeProjectBrief } from "./project-brief.js";

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

  it("names the parse error when it asks again, so the model can fix that spot", async () => {
    const requests: string[] = [];
    const provider = new MockAdapter({
      respond: (request) => {
        const last = request.messages[request.messages.length - 1]?.content ?? "";
        requests.push(last);
        if (requests.length === 1) {
          return '```json\n{"summary": "say "hi" now"}\n```';
        }
        return demoRespond(request);
      },
      latencyMs: 0,
    });

    await runAgentTask({
      provider,
      fs: new FakeFs({ "src/sum.ts": BUGGY_SUM }),
      input: { taskType: "bug-fix", instructions: "sum returns NaN", targetFiles: ["src/sum.ts"] },
      skillLevel: "experienced",
    });

    expect(requests[1]).toContain("not valid JSON");
  });

  it("uses a response with a dropped comma, but says so and never rates it high", async () => {
    const provider = new MockAdapter({
      respond: (request) => {
        const good = demoRespond(request);
        // Drop the first comma that separates two objects.
        const broken = good.replace(/\},(\s*)\{/, "}$1{");
        expect(broken).not.toBe(good);
        return broken;
      },
      latencyMs: 0,
    });

    const result = await runAgentTask({
      provider,
      fs: new FakeFs({ "src/sum.ts": BUGGY_SUM }),
      input: { taskType: "bug-fix", instructions: "sum returns NaN", targetFiles: ["src/sum.ts"] },
      skillLevel: "experienced",
    });

    expect(result.escalation).toBeUndefined();
    expect(result.diff.length).toBeGreaterThan(0);
    expect(result.confidence).not.toBe("high");
    expect(result.explanation).toContain("repaired");
  });

  it("says the model ran out of room, and does not ask again, when a reply is cut off", async () => {
    let call = 0;
    const provider = new MockAdapter({ respond: demoRespond, latencyMs: 0 });
    provider.chat = async () => {
      call += 1;
      return { content: '```json\n{"summary": "x', finishReason: "length" };
    };

    const result = await runAgentTask({
      provider,
      fs: new FakeFs({ "src/sum.ts": BUGGY_SUM }),
      input: { taskType: "bug-fix", instructions: "sum returns NaN", targetFiles: ["src/sum.ts"] },
      skillLevel: "experienced",
    });

    expect(call).toBe(1);
    expect(result.escalation?.reason).toBe("low-confidence");
    expect(result.escalation?.message).toContain("ran out of room");
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

/**
 * The scaffold path (PRD.md §3 journey 13) end to end.
 *
 * A brief goes in; a set of all-new files comes out, and packages/vcs
 * recognises them as creations. That last part is what makes the wizard
 * safe: the files arrive as an ordinary reviewable change rather than
 * something written straight to the folder.
 */
describe("runAgentTask for a new project", () => {
  function scaffoldProvider() {
    return new MockAdapter({
      respond: () =>
        JSON.stringify({
          summary: "Create a single-page water tracker.",
          steps: [{ id: "1", description: "Wrote index.html", targetFiles: ["index.html"] }],
          explanation: "Open index.html in a browser to use it.",
          diff: [
            {
              filePath: "index.html",
              hunks: [
                {
                  header: "@@ -0,0 +1,2 @@",
                  lines: [
                    { type: "add", content: "<!doctype html>" },
                    { type: "add", content: "<h1>Water</h1>" },
                  ],
                },
              ],
            },
            {
              filePath: "README.md",
              hunks: [
                {
                  header: "@@ -0,0 +1,1 @@",
                  lines: [{ type: "add", content: "Open index.html." }],
                },
              ],
            },
          ],
          confidence: "medium",
        }),
      latencyMs: 0,
    });
  }

  const input = {
    taskType: "scaffold" as const,
    instructions: composeProjectBrief({
      description: "a page that tracks how much water I drink",
      audience: "",
      platforms: ["web" as const],
      features: [],
    }),
    targetFiles: [],
  };

  it("returns the proposed files as a diff of creations", async () => {
    const result = await runAgentTask({
      provider: scaffoldProvider(),
      fs: new FakeFs({}),
      input,
      skillLevel: "new-to-coding",
    });

    expect(result.escalation).toBeUndefined();
    expect(result.plan.taskType).toBe("scaffold");
    expect(result.diff.map((d) => d.filePath)).toEqual(["index.html", "README.md"]);
    // Every file is new, so packages/vcs must see each as a creation —
    // otherwise applying would look for context lines that cannot exist.
    expect(result.diff.every(isCreation)).toBe(true);
  });

  // Scaffolding writes files, so read-only has to stop it for the same
  // reason it stops a bug fix — nothing about "there is no code yet"
  // makes writing more permissible.
  it("is refused under read-only, before the model is called", async () => {
    let called = false;
    const result = await runAgentTask({
      provider: new MockAdapter({
        respond: () => {
          called = true;
          return "{}";
        },
        latencyMs: 0,
      }),
      fs: new FakeFs({}),
      input,
      skillLevel: "new-to-coding",
      permissionMode: "read-only",
    });

    expect(result.escalation?.reason).toBe("permission-denied");
    expect(called).toBe(false);
  });
});

describe("permission gating across task types", () => {
  // Read-only has to stop every task that writes, not just the ones that
  // existed when the check was written.
  it("refuses every editing task under read-only, before the model is called", async () => {
    for (const taskType of [
      "bug-fix",
      "refactor",
      "write-tests",
      "document",
      "scaffold",
      "design-change",
    ] as const) {
      let called = false;
      const result = await runAgentTask({
        provider: new MockAdapter({
          respond: () => {
            called = true;
            return "{}";
          },
          latencyMs: 0,
        }),
        fs: new FakeFs({}),
        input: { taskType, instructions: "do the thing", targetFiles: [] },
        skillLevel: "experienced",
        permissionMode: "read-only",
      });

      expect(result.escalation?.reason, taskType).toBe("permission-denied");
      expect(called, `${taskType} reached the model`).toBe(false);
    }
  });

  it("allows explaining under read-only", async () => {
    const result = await runAgentTask({
      provider: provider(),
      fs: new FakeFs({ "src/sum.ts": BUGGY_SUM }),
      input: {
        taskType: "explain",
        instructions: "what does this do",
        targetFiles: ["src/sum.ts"],
      },
      skillLevel: "experienced",
      permissionMode: "read-only",
    });
    expect(result.escalation).toBeUndefined();
  });
});

describe("long files are outlined rather than sent whole", () => {
  const LONG = Array.from({ length: 600 }, (_, i) => `  const line${i} = ${i};`).join("\n");
  const SYMBOLS = [
    { name: "compute", kind: "function" as const, startLine: 10, endLine: 300 },
    { name: "Helper", kind: "class" as const, startLine: 310, endLine: 590 },
  ];

  /** Captures the prompt the model actually received. */
  function capturing(seen: string[]) {
    return new MockAdapter({
      respond: (request) => {
        seen.push(request.messages.map((m) => m.content).join("\n"));
        return JSON.stringify({
          summary: "s",
          steps: [{ id: "1", description: "d", targetFiles: [] }],
          explanation: "e",
          diff: [],
          confidence: "high",
        });
      },
      latencyMs: 0,
    });
  }

  it("sends the map of a long file instead of its text", async () => {
    const seen: string[] = [];
    await runAgentTask({
      provider: capturing(seen),
      fs: new FakeFs({ "src/big.ts": LONG }),
      input: { taskType: "explain", instructions: "what is here", targetFiles: ["src/big.ts"] },
      skillLevel: "experienced",
      getSymbols: async () => SYMBOLS,
    });

    const prompt = seen[0]!;
    expect(prompt).toContain("function compute (lines 10-300)");
    expect(prompt).toContain("class Helper (lines 310-590)");
    // The body must not be there, or the window is spent anyway.
    expect(prompt).not.toContain("const line42");
  });

  // A model shown an outline and led to believe it is the file will
  // answer about code it has never seen.
  it("says plainly that the code was not included", async () => {
    const seen: string[] = [];
    await runAgentTask({
      provider: capturing(seen),
      fs: new FakeFs({ "src/big.ts": LONG }),
      input: { taskType: "explain", instructions: "x", targetFiles: ["src/big.ts"] },
      skillLevel: "experienced",
      getSymbols: async () => SYMBOLS,
    });
    expect(seen[0]!).toMatch(/have NOT been shown this code/i);
  });

  it("sends a short file whole", async () => {
    const seen: string[] = [];
    await runAgentTask({
      provider: capturing(seen),
      fs: new FakeFs({ "src/sum.ts": BUGGY_SUM }),
      input: { taskType: "explain", instructions: "x", targetFiles: ["src/sum.ts"] },
      skillLevel: "experienced",
      getSymbols: async () => [
        { name: "sum", kind: "function" as const, startLine: 1, endLine: 7 },
      ],
    });
    expect(seen[0]!).toContain("export function sum");
  });

  // Before AST indexing there was no getSymbols at all, and a host that
  // cannot parse must behave exactly as it did then.
  it("sends everything whole when the host cannot parse", async () => {
    const seen: string[] = [];
    await runAgentTask({
      provider: capturing(seen),
      fs: new FakeFs({ "src/big.ts": LONG }),
      input: { taskType: "explain", instructions: "x", targetFiles: ["src/big.ts"] },
      skillLevel: "experienced",
    });
    expect(seen[0]!).toContain("const line42");
  });

  it("sends a long file whole when parsing finds nothing", async () => {
    const seen: string[] = [];
    await runAgentTask({
      provider: capturing(seen),
      fs: new FakeFs({ "src/big.ts": LONG }),
      input: { taskType: "explain", instructions: "x", targetFiles: ["src/big.ts"] },
      skillLevel: "experienced",
      getSymbols: async () => [],
    });
    expect(seen[0]!).toContain("const line42");
  });

  it("still sends the file whole when parsing throws", async () => {
    const seen: string[] = [];
    await runAgentTask({
      provider: capturing(seen),
      fs: new FakeFs({ "src/big.ts": LONG }),
      input: { taskType: "explain", instructions: "x", targetFiles: ["src/big.ts"] },
      skillLevel: "experienced",
      getSymbols: async () => {
        throw new Error("parser exploded");
      },
    });
    expect(seen[0]!).toContain("const line42");
  });
});
