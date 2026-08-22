import { invoke } from "@tauri-apps/api/core";
import type { FileSystemReader, ProjectFile } from "@paleonyx/shared-types";

/**
 * The desktop counterpart to apps/web's InMemoryFileSystem — same
 * FileSystemReader contract, backed by the real filesystem through the
 * three gated Rust commands in src-tauri/src/commands.rs instead of
 * calling fs APIs directly from the frontend (CLAUDE.md §2/§9: no
 * reaching for filesystem APIs directly from UI code).
 */
export class TauriFileSystem implements FileSystemReader {
  async listFiles(): Promise<ProjectFile[]> {
    return invoke<ProjectFile[]>("list_project_files");
  }

  async readFile(path: string): Promise<string> {
    return invoke<string>("read_project_file", { path });
  }
}

export async function openProject(path: string): Promise<void> {
  await invoke("open_project", { path });
}
