import type { FileSystemReader, ProjectFile } from "@paleonyx/shared-types";

/**
 * A tiny in-memory project so the web dev harness can exercise the full
 * file tree / editor / agent flow without needing real disk access from
 * the browser. apps/desktop's Tauri fs adapter replaces this with the
 * real filesystem — same FileSystemReader contract either way
 * (packages/shared-types's filesystem.ts).
 */
const DEMO_FILES: Record<string, string> = {
  "src/sum.ts": `export function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i <= numbers.length; i++) {
    total += numbers[i];
  }
  return total;
}
`,
  "src/greet.ts": `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`,
  "README.md": `# Demo Project

A tiny in-memory project used to exercise Paleonyx Studio's v0 agent flow
in the browser dev harness. Try selecting src/sum.ts, adding it to
context, and running a Bug Fix task — it has a real off-by-one bug.
`,
};

export class InMemoryFileSystem implements FileSystemReader {
  async listFiles(): Promise<ProjectFile[]> {
    return Object.keys(DEMO_FILES).map((path) => ({ path }));
  }

  async readFile(path: string): Promise<string> {
    const content = DEMO_FILES[path];
    if (content === undefined) {
      throw new Error(`File not found in demo project: ${path}`);
    }
    return content;
  }
}
