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
import { connectedToolDescription, formatToolInput } from "./tools/connected-tool.js";
import type { ConnectedTool } from "./tools/connected-tool.js";

export interface InvestigationStep {
  tool: string;
  /** Human-readable, for the timeline and the task panel. */
  summary: string;
  /** Full tool output, available on expand rather than inline. */
  detail: string;
  ok: boolean;
  /** What was sent, when the summary does not already say. */
  input?: string;
}

export interface InvestigateOptions {
  provider: ChatModelProvider;
  fs: FileSystemReader;
  messages: ChatMessage[];
  budget: BudgetTracker;
  permissionMode: PermissionMode;
  commandAllowlist: readonly string[];
  runCommand?: CommandRunner;
  /** Tools from servers the user connected and enabled. */
  connectedTools?: readonly ConnectedTool[];
  /**
   * Files whose full text is already in `messages`. Reading one again
   * only adds a second copy to a window that is small on a local model.
   */
  alreadyProvided?: readonly string[];
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
  const connected = offerableConnectedTools(options);
  for (const tool of connected.values()) {
    tools.push({
      ...tool.definition,
      description: connectedToolDescription(tool.source, tool.definition.description),
    });
  }

  const maxIterations = options.maxIterations ?? 6;
  const have = new Set((options.alreadyProvided ?? []).map(normalizePath));

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

    let repeatedRead = false;
    for (const call of response.toolCalls) {
      options.budget.recordToolCall();
      const readPath =
        call.name === READ_FILE_TOOL_NAME && typeof call.arguments.path === "string"
          ? call.arguments.path
          : undefined;
      const repeat = readPath !== undefined && have.has(normalizePath(readPath));
      const step = repeat
        ? {
            tool: call.name,
            summary: `Already had ${readPath}`,
            detail: `${readPath} is already in this conversation in full. Do not read it again; use that copy.`,
            ok: true,
          }
        : await runTool(call, options, commandsAvailable, connected);
      if (repeat) repeatedRead = true;
      else if (readPath !== undefined && step.ok) have.add(normalizePath(readPath));
      steps.push(step);
      messages.push({
        role: "tool",
        content: step.detail,
        toolCallId: call.id,
        toolName: call.name,
      });

      /**
       * A refused command ends the gathering phase, but not the task.
       *
       * The guard is against probing: left running, a model could try
       * variations until one happened to match the allowlist. Stopping
       * here achieves that — no further command can be run — while
       * still answering from what was already gathered.
       *
       * Aborting outright was throwing away work for nothing. Observed:
       * the agent read the file it needed, then guessed at `npm run
       * preview`, and the whole task died on the guess despite having
       * everything required to answer.
       */
      if (!step.ok && step.tool === RUN_COMMAND_TOOL_NAME) {
        messages.push({
          role: "user",
          content:
            "That command was refused, and no further commands will be run for this task. Answer now using what you have already gathered. If the refusal genuinely prevents you from answering, say so in `explanation` rather than guessing.",
        });
        return { kind: "ready", messages, steps };
      }
    }

    // A read of something already held means it has run out of new things
    // to ask for. Going round again only adds more to the window.
    if (repeatedRead) {
      messages.push({
        role: "user",
        content:
          "You already have every file you asked for. Answer now using what is above.",
      });
      return { kind: "ready", messages, steps };
    }
  }

  // Out of iterations. Returning what was gathered lets the caller still
  // ask for an answer, which beats discarding the work entirely.
  return { kind: "ready", messages, steps };
}

/**
 * Connected tools the agent may be offered for this task, by the name the
 * model sees.
 *
 * Only in "Can run commands" mode. A connected tool runs another program
 * with the user's permissions, and nothing it does passes through the
 * diff or can be undone — the same exposure as running a command, so it
 * clears the same bar. A tool may never take a built-in's name: a server
 * calling its tool `readFile` must not receive the calls meant for the
 * app's own.
 */
function offerableConnectedTools(options: InvestigateOptions): Map<string, ConnectedTool> {
  const offered = new Map<string, ConnectedTool>();
  if (!canRunCommands(options.permissionMode)) return offered;
  for (const tool of options.connectedTools ?? []) {
    const { name } = tool.definition;
    if (BUILT_IN_TOOL_NAMES.has(name) || offered.has(name)) continue;
    offered.set(name, tool);
  }
  return offered;
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\.\//, "").replace(/\\/g, "/");
}

const BUILT_IN_TOOL_NAMES = new Set([
  LIST_FILES_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  RUN_COMMAND_TOOL_NAME,
]);

async function runTool(
  call: ToolCall,
  options: InvestigateOptions,
  commandsAvailable: boolean,
  connected: ReadonlyMap<string, ConnectedTool>
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
        // Said outright: a model that only sees a bare error tries the
        // same path again, and again, spending its tool calls.
        detail: `${error instanceof Error ? error.message : String(error)}. Do not try to read ${path} again. If it is a file you mean to create, it not existing yet is expected.`,
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

  const tool = connected.get(call.name);
  if (tool) {
    const label = `${tool.toolName} (${tool.source})`;
    const input = formatToolInput(call.arguments);
    options.onStatus?.(`Using ${label}…`);
    try {
      const result = await tool.call(call.arguments);
      return {
        tool: call.name,
        summary: result.isError ? `${label} reported a problem` : `Used ${label}`,
        detail: result.text,
        input,
        ok: !result.isError,
      };
    } catch (error) {
      return {
        tool: call.name,
        summary: `Could not use ${label}`,
        detail: error instanceof Error ? error.message : String(error),
        input,
        ok: false,
      };
    }
  }

  if (options.connectedTools?.some((known) => known.definition.name === call.name)) {
    return {
      tool: call.name,
      summary:
        "Tools from connected servers can only be used when this project is set to Can run commands.",
      detail: "The agent asked for a connected tool that was not offered in this permission mode.",
      ok: false,
    };
  }

  return {
    tool: call.name,
    summary: `Unknown tool "${call.name}"`,
    detail: "The agent asked for a tool that does not exist.",
    ok: false,
  };
}
