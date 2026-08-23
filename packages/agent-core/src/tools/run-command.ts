import type { ToolCall, ToolDefinition } from "@paleonyx/shared-types";

export const RUN_COMMAND_TOOL_NAME = "runCommand";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

/**
 * Executes a command. Supplied by the host, because running a process is
 * a shell capability the agent layer must not reach for directly
 * (CLAUDE.md §2).
 */
export type CommandRunner = (
  program: string,
  args: string[]
) => Promise<CommandResult>;

/**
 * Program and arguments are separate fields, not one string.
 *
 * A single `command` string would have to be split somewhere, and every
 * splitter eventually meets quoting, `&&`, or a semicolon. Keeping them
 * apart means the allowlist checks the same structure that is executed,
 * with nothing in between to reinterpret it.
 */
export const runCommandToolDefinition: ToolDefinition = {
  name: RUN_COMMAND_TOOL_NAME,
  description:
    "Run one allowlisted project command, such as a test suite or linter, and read its output. Provide the program and its arguments separately. Shell syntax such as pipes, &&, or redirection is not available.",
  parameters: {
    type: "object",
    properties: {
      program: {
        type: "string",
        description: "The executable to run, e.g. 'cargo' or 'npm'.",
      },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Arguments, one per element, e.g. ['test', '--lib'].",
      },
    },
    required: ["program"],
  },
};

export interface ParsedCommandCall {
  program: string;
  args: string[];
}

/**
 * A real boundary: these arguments come from a model. Validated rather
 * than cast, and non-string array entries are rejected outright instead
 * of being coerced — a number where a flag was expected means the model
 * meant something we have not understood.
 */
export function parseCommandCall(call: ToolCall): ParsedCommandCall | undefined {
  const program = call.arguments.program;
  if (typeof program !== "string" || program.trim().length === 0) return undefined;

  const rawArgs = call.arguments.args;
  if (rawArgs === undefined) return { program, args: [] };
  if (!Array.isArray(rawArgs)) return undefined;
  if (!rawArgs.every((arg): arg is string => typeof arg === "string")) return undefined;

  return { program, args: rawArgs };
}

/** Formats output for the model: exit status first, then the streams. */
export function describeCommandResult(result: CommandResult): string {
  const status = result.timedOut
    ? "timed out"
    : `exited with code ${result.exitCode ?? "unknown"}`;
  const parts = [`Command ${status} after ${result.durationMs}ms.`];
  if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.trim()}`);
  if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.trim()}`);
  if (!result.stdout.trim() && !result.stderr.trim()) parts.push("No output.");
  if (result.truncated) parts.push("(Output was truncated; the end is shown.)");
  return parts.join("\n\n");
}
