import { describe, expect, it } from "vitest";
import type { FileSystemReader, ProjectFile } from "@paleonyx/shared-types";
import { OllamaAdapter, pingOllama } from "@paleonyx/runtime";
import { runAgentTask } from "./run-task.js";

const MODEL = "qwen2.5-coder:7b";

class DemoFs implements FileSystemReader {
  async listFiles(): Promise<ProjectFile[]> {
    return [{ path: "README.md" }, { path: "src/greet.ts" }, { path: "src/sum.ts" }];
  }
  async readFile(path: string): Promise<string> {
    if (path === "src/sum.ts") {
      return "export function sum(numbers: number[]): number {\n  let total = 0;\n  for (let i = 0; i < numbers.length; i++) {\n    total += numbers[i];\n  }\n  return total;\n}\n";
    }
    throw new Error(`no such file: ${path}`);
  }
}

/**
 * The whole pipeline against a real model, mirroring what the desktop
 * app does. Unit tests could not catch the failures here, which lived in
 * how a real model actually replies rather than in any logic.
 *
 * Opt-in, because part of what it checks is the model's judgement rather
 * than our code. Run three times on unchanged code it failed once and
 * passed twice: qwen2.5-coder sometimes claims it "added a test script
 * to the package.json", which is exactly the invention the last
 * assertion forbids. That is worth knowing and worth checking
 * deliberately, but a suite that fails one run in three stops being
 * evidence of anything — real regressions would hide in the noise.
 *
 * Run it with PALEONYX_LIVE_MODEL_TESTS=1.
 */
// Declared rather than pulling in @types/node: agent-core also runs in
// the browser, and adding Node's globals package-wide would make it easy
// to reach for an API that is not there at runtime.
declare const process: { env: Record<string, string | undefined> };

const LIVE = process.env.PALEONYX_LIVE_MODEL_TESTS === "1";

describe.skipIf(!LIVE)("live Ollama agent task", () => {
  it("investigates before answering", async () => {
    if (!(await pingOllama())) {
      console.warn("skipped: Ollama unreachable");
      return;
    }

    const result = await runAgentTask({
      provider: new OllamaAdapter({ modelId: MODEL, supportsToolCalling: true }),
      fs: new DemoFs(),
      input: {
        taskType: "bug-fix",
        instructions: "Tests are failing, find out why.",
        targetFiles: ["src/sum.ts"],
      },
      skillLevel: "new-to-coding",
      permissionMode: "can-run-commands",
      runCommand: async () => ({
        stdout: "",
        stderr: "npm ERR! Missing script: test",
        exitCode: 1,
        timedOut: false,
        truncated: false,
        durationMs: 10,
      }),
    });

    console.log("=== steps ===", JSON.stringify(result.investigation, null, 2).slice(0, 1500));
    console.log("=== budget ===", result.budgetUsage);
    console.log("=== escalation ===", result.escalation);
    console.log("=== summary ===", result.plan.summary);

    // Two different kinds of check, deliberately kept apart.
    //
    // The pipeline held together: a real model's reply parsed into a
    // plan without escalating. That is about our code and is why this
    // test exists at all.
    expect(result.escalation).toBeUndefined();
    expect(result.plan.summary).not.toBe("");

    // The model behaved: it did not invent a test suite absent from the
    // listing it was given. This one is the model's disposition, not our
    // logic — it is the assertion that makes this run opt-in.
    const text = `${result.plan.summary} ${result.explanation}`.toLowerCase();
    expect(text).not.toMatch(/sum\.spec|sum\.test|package\.json/);
  }, 180_000);
});
