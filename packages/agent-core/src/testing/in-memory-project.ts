import type {
  AgentChangeRecord,
  FileSystemReader,
  ProjectFile,
} from "@paleonyx/shared-types";
import type { ChangeStore } from "@paleonyx/vcs";

/**
 * A fixture repository (CLAUDE.md §8) that the agent reads and `vcs`
 * writes, backed by one map.
 *
 * One map on purpose. The desktop app reads through Tauri and writes
 * through Tauri, so a change the agent proposes is applied to the same
 * files it read — and the anchoring rule depends on exactly that, since
 * it compares what the agent saw against what is there now. Two
 * separate fakes would let those drift apart and hide the case it
 * exists for.
 */
export class InMemoryProject implements FileSystemReader, ChangeStore {
  readonly files: Map<string, string>;
  readonly records: { commitId: string; json: string }[] = [];

  constructor(files: Record<string, string>) {
    this.files = new Map(Object.entries(files));
  }

  /** What a user editing a file in their editor looks like from here. */
  edit(path: string, change: (content: string) => string): void {
    const current = this.files.get(path);
    if (current === undefined) throw new Error(`no such file: ${path}`);
    this.files.set(path, change(current));
  }

  async listFiles(): Promise<ProjectFile[]> {
    return [...this.files.keys()].sort().map((path) => ({ path }));
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`no such file: ${path}`);
    return content;
  }

  async writeFiles(files: Map<string, string>): Promise<void> {
    for (const [path, content] of files) this.files.set(path, content);
  }

  async deleteFiles(paths: string[]): Promise<void> {
    for (const path of paths) this.files.delete(path);
  }

  async recordChange(record: AgentChangeRecord): Promise<string> {
    const commitId = `commit-${this.records.length + 1}`;
    this.records.push({ commitId, json: JSON.stringify(record) });
    return commitId;
  }

  async listChangeRecords(): Promise<{ commitId: string; json: string }[]> {
    return [...this.records].reverse();
  }
}
