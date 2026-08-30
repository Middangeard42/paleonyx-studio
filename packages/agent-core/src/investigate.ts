import type {
  ChatMessage,
  FileSystemReader,
  PermissionMode,
  ToolCall,
} from "@paleonyx/shared-types";
import { canRunCommands } from "@paleonyx/shared-types";
import type { ChatModelProvider } from "@paleonyx/runtime";
import type { BudgetTracker } from "./budget.js";
import { READ_FILE_TOOL_NAME, executeReadFile, readFileToolDefinition } from "./tools/read-file.js";
import {
  LIST_FILES_TOOL_NAME,
  executeListFiles,
  listFilesToolDefinition,
} from "./tools/list-files.js";
import {
  RUN_COMMAND_TOOL_NAME,
  describeCommandResult,
  parseCommandCall,
  runCommandToolDefinition,
} from "./tools/run-command.js";
import type { CommandRunner } from "./tools/run-command.js";
import { checkAllowlist, formatCommand } from "./tools/command-allowlist.js";

export interface InvestigationStep {
  tool: string;
  /** Human-readable, for the timeline and the task panel. */
  summary: string;
  /** Full tool output, available on expand rather than inline. */
  detail: string;
  ok: boolean;
}

export interface InvestigateOptions {
  provider: ChatModelProvider;
  fs: FileSystemReader;
  messages: ChatMessage[];
  budget: BudgetTracker;
  permissionMode: PermissionMode;
  commandAllowlist: readonly string[];
  runCommand?: CommandRunner;
  onStatus?: (message: string) => void;
  maxIterations?: number;
}

export type InvestigationOutcome =
  | { kind: "ready"; messages: ChatMessage[]; steps: InvestigationStep[] }
  | {
      kind: "blocked";
      reason: "budget-exhausted" | "permission-denied" | "tool-failure";
      message: string;
      steps: InvestigationStep[];
    };

/**
 * Lets the agent gather what it needs before answering: read more files,
 * run a test suite, read the failure, try again.
 *
 * Only runs for providers that declare tool-calling support. Everything
 * else takes the single-pass path, because discovering the capability by
 * watching a request fail is exactly what CLAUDE.md §4 rules out — the
 * adapter says what it can do, and this believes it.
 *
 * Returns the conversation with tool results appended. The caller then
 * asks for the final structured answer, so the plan/diff contract is
 * unchanged by anything that happened here.
 */
export async function investigate(
  options: InvestigateOptions
): Promise<InvestigationOutcome> {
  const steps: InvestigationStep[] = [];
  const messages = [...options.messages];

  if (!options.provider.model.capabilities.supportsToolCalling) {
    return { kind: "ready", messages, steps };
  }

  const tools = [listFilesToolDefinition, readFileToolDefinition];
  const commandsAvailable =
    canRunCommands(options.permissionMode) && options.runCommand !== undefined;
  if (commandsAvailable) tools.push(runCommandToolDefinition);

  const maxIterations = options.maxIterations ?? 6;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (options.budget.isExhausted()) {
      return {
        kind: "blocked",
        reason: "budget-exhausted",
        message: "Ran out of budget while investigating.",
        steps,
      };
    }

    const response = await options.provider.chat({ messages, tools });
    options.budget.recordTokens(
      (response.usage?.promptTokens ?? 0) + (response.usage?.completionTokens ?? 0)
    );

    if (!response.toolCalls?.length) {
      // Nothing more it wants to look at. Keep the reply in the
      // conversation so the final request builds on it rather than
      // discarding reasoning already paid for.
      messages.push({ role: "assistant", content: response.content });
      return { kind: "ready", messages, steps };
    }

    messages.push({
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls,
    });

    for (const call of response.toolCalls) {
      options.budget.recordToolCall();
      const step = await runTool(call, options, commandsAvailable);
      steps.push(step);
      messages.push({
        role: "tool",
        content: step.detail,
        toolCallId: call.id,
        toolName: call.name,
      });

      // A refused command stops the loop rather than letting the model
      // try variations until something slips through the allowlist.
      if (!step.ok && step.tool === RUN_COMMAND_TOOL_NAME) {
        return {
          kind: "blocked",
          reason: "permission-denied",
          message: step.summary,
          steps,
        };
      }
    }
  }

  // Out of iterations. Returning what was gathered lets the caller still
  // ask for an answer, which beats discarding the work entirely.
  return { kind: "ready", messages, steps };
}

async function runTool(
  call: ToolCall,
  options: InvestigateOptions,
  commandsAvailable: boolean
): Promise<InvestigationStep> {
  if (call.name === LIST_FILES_TOOL_NAME) {
    options.onStatus?.("Looking at what's in the project…");
    try {
      const listing = await executeListFiles(options.fs);
      return {
        tool: call.name,
        summary: "Listed the project's files",
        detail: listing,
        ok: true,
      };
    } catch (error) {
      return {
        tool: call.name,
        summary: "Could not list the project's files",
        detail: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  }

  if (call.name === READ_FILE_TOOL_NAME) {
    const path = typeof call.arguments.path === "string" ? call.arguments.path : "";
    options.onStatus?.(`Reading ${path}…`);
    try {
      const content = await executeReadFile(options.fs, call);
      return {
        tool: call.name,
        summary: `Read ${path}`,
        detail: content,
        ok: true,
      };
    } catch (error) {
      return {
        tool: call.name,
        summary: `Could not read ${path}`,
        detail: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  }

  if (call.name === RUN_COMMAND_TOOL_NAME) {
    if (!commandsAvailable) {
      return {
        tool: call.name,
        summary:
          "Running commands is not enabled for this project. Switch the permission mode to allow it.",
        detail: "The agent asked to run a command while command execution was disabled.",
        ok: false,
      };
    }

    const parsed = parseCommandCall(call);
    if (!parsed) {
      return {
        tool: call.name,
        summary: "The agent asked to run a command in a form that could not be understood.",
        detail: JSON.stringify(call.arguments),
        ok: false,
      };
    }

    const decision = checkAllowlist(parsed, options.commandAllowlist);
    if (!decision.allowed) {
      return {
        tool: call.name,
        summary: `${decision.reason} Add it in Settings if you want the agent to be able to run it.`,
        detail: `Refused: ${formatCommand(parsed)}`,
        ok: false,
      };
    }

    options.onStatus?.(`Running ${formatCommand(parsed)}…`);
    try {
      const result = await options.runCommand!(parsed.program, parsed.args);
      return {
        tool: call.name,
        summary: `${formatCommand(parsed)} — ${
          result.timedOut ? "timed out" : `exit ${result.exitCode ?? "?"}`
        }`,
        detail: describeCommandResult(result),
        // A non-zero exit is information, not a failure of the tool: a
        // failing test suite is often exactly what the agent needs.
        ok: true,
      };
    } catch (error) {
      return {
        tool: call.name,
        summary: `${formatCommand(parsed)} could not be started`,
        detail: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  }

  return {
    tool: call.name,
    summary: `Unknown tool "${call.name}"`,
    detail: "The agent asked for a tool that does not exist.",
    ok: false,
  };
}
