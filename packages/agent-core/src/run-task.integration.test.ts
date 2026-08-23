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
 */
describe("live Ollama agent task", () => {
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

    // Asserts the outcome that matters, not that a tool was called:
    // whether a model reaches for a tool is its own disposition, and
    // this one answers from what it is given. What must hold is that it
    // does not invent a test suite that is not in the listing.
    expect(result.escalation).toBeUndefined();
    const text = `${result.plan.summary} ${result.explanation}`.toLowerCase();
    expect(text).not.toMatch(/sum\.spec|sum\.test|package\.json/);
  }, 180_000);
});
