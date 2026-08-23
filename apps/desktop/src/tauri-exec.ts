import { invoke } from "@tauri-apps/api/core";
import type { CommandResult } from "@paleonyx/agent-core";

/**
 * Runs a project command.
 *
 * Program and arguments stay separate all the way down to the process
 * spawn — there is no shell anywhere on this path, so nothing in an
 * argument can turn into another command.
 *
 * Whether a command *may* run is decided in agent-core against the
 * allowlist before this is ever called. This is the mechanism only.
 */
export async function runProjectCommand(
  program: string,
  args: string[]
): Promise<CommandResult> {
  return invoke<CommandResult>("run_command", { program, args });
}
