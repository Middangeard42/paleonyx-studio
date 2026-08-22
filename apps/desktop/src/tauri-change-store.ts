import { invoke } from "@tauri-apps/api/core";
import type { AgentChangeRecord, GitStatus } from "@paleonyx/shared-types";
import type { ChangeStore } from "@paleonyx/vcs";

/**
 * Backs `packages/vcs` with the real filesystem and the user's own git
 * repository. Every operation goes through a Tauri command — the
 * frontend never touches `fs` or spawns a process itself (CLAUDE.md §9).
 */
export class TauriChangeStore implements ChangeStore {
  async readFile(path: string): Promise<string> {
    return invoke<string>("read_project_file", { path });
  }

  async writeFiles(files: Map<string, string>): Promise<void> {
    await invoke("write_project_files", { files: Object.fromEntries(files) });
  }

  async recordChange(record: AgentChangeRecord): Promise<string> {
    return invoke<string>("record_agent_change", {
      changeJson: JSON.stringify(record),
      summary: record.summary,
    });
  }

  async listChangeRecords(): Promise<{ commitId: string; json: string }[]> {
    // The Rust side returns records newest-first but without their commit
    // ids, which nothing needs yet — the id is carried inside the record.
    // Kept in the shape ChangeStore expects so adding real ids later
    // doesn't ripple outward.
    const raw = await invoke<string[]>("list_agent_changes");
    return raw.map((json, index) => ({ commitId: `history~${index}`, json }));
  }
}

/**
 * Saves the user's own edits.
 *
 * Deliberately separate from `ChangeStore.writeFiles`: a person editing
 * their own file is not an agent change and must not land in the agent
 * timeline. Only writes the agent makes are recorded there, which is
 * what keeps "undo this agent change" meaningful.
 */
export async function saveUserEdits(files: Map<string, string>): Promise<void> {
  await invoke("write_project_files", { files: Object.fromEntries(files) });
}

export async function getGitStatus(): Promise<GitStatus> {
  return invoke<GitStatus>("git_status");
}

/**
 * Creates a repository in the opened project. Only ever called after the
 * user has been shown and accepted the one-time notice required by
 * CLAUDE.md §10 — this mutates their folder and must not happen quietly.
 */
export async function initGitRepository(): Promise<void> {
  await invoke("git_init");
}
