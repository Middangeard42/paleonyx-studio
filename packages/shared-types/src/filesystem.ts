import type { ProjectFile } from "./project.js";

/**
 * The read-only filesystem contract shared by packages/indexing and
 * agent-core's gated readFile tool. Defined here (not in either package)
 * so neither has to depend on the other just to agree on how a project's
 * files are listed and read — apps/desktop (Tauri fs) and apps/web (an
 * in-memory demo project) each provide their own implementation.
 *
 * Deliberately has no write method: per CLAUDE.md §2, indexing never
 * writes to project files, and any writes the agent makes route through
 * agent-core's separate, permission-gated tool-execution surface, not
 * this interface.
 */
export interface FileSystemReader {
  listFiles(): Promise<ProjectFile[]>;
  readFile(path: string): Promise<string>;
}
