import type {
  AgentPlan,
  AgentTaskInput,
  AgentTaskResult,
  AgentTaskType,
  ChatCompletionResult,
  ChatMessage,
  EscalationReason,
  FileSystemReader,
  CodeSymbol,
  ModelReply,
  PermissionMode,
  SkillLevel,
  ToolCall,
} from "@paleonyx/shared-types";
import {
  DEFAULT_PERMISSION_MODE,
  canProposeEdits,
  canRunCommands,
  taskProducesEdits,
} from "@paleonyx/shared-types";
import type { ChatModelProvider } from "@paleonyx/runtime";
import { BudgetTracker, DEFAULT_BUDGET_LIMITS } from "./budget.js";
import { buildAnswerRequest, buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import { formatOutline, shouldOutline } from "@paleonyx/indexing";
import { parseAgentResponse } from "./parse-response.js";
import { READ_FILE_TOOL_NAME, executeReadFile } from "./tools/read-file.js";
import { investigate } from "./investigate.js";
import type { InvestigationStep } from "./investigate.js";
import type { CommandRunner } from "./tools/run-command.js";
import { DEFAULT_COMMAND_ALLOWLIST } from "./tools/command-allowlist.js";
import type { ConnectedTool } from "./tools/connected-tool.js";

export interface RunAgentTaskOptions {
  provider: ChatModelProvider;
  fs: FileSystemReader;
  input: AgentTaskInput;
  skillLevel: SkillLevel;
  /**
   * What the agent is allowed to do. Checked here rather than trusted to
   * the UI: this is the auditable surface, and a caller that forgets to
   * pass one gets the safe default rather than unrestricted behaviour.
   */
  permissionMode?: PermissionMode;
  budgetLimits?: typeof DEFAULT_BUDGET_LIMITS;
  /**
   * Enables the runCommand tool. Absent means the host cannot run
   * processes at all — the web harness — which is distinct from a
   * permission mode that forbids it.
   */
  runCommand?: CommandRunner;
  commandAllowlist?: readonly string[];
  /**
   * Tools from servers the user connected and enabled. Offered only in a
   * mode that permits running commands; see `investigate`.
   */
  connectedTools?: readonly ConnectedTool[];
  /**
   * The project's own conventions, from files like AGENTS.md. Passed in
   * rather than discovered here: finding them is an indexing concern,
   * and the caller may let the user turn them off.
   */
  contextDocs?: readonly { path: string; content: string }[];
  /**
   * Parses a file's symbols, when the host can. A callback rather than a
   * dependency for the same reason `runCommand` is one: tree-sitter runs
   * in the desktop shell, and agent-core must not know that. Absent
   * means every file goes in whole, which is what happened before AST
   * indexing existed.
   */
  getSymbols?: (path: string) => Promise<CodeSymbol[]>;
  /** Lets the UI render the Task Plan Card as soon as the plan is known. */
  onPlan?: (plan: AgentPlan) => void;
  /**
   * Real phase transitions ("Reading 2 files…", "Thinking…"), not a bare
   * spinner (DESIGN.md §5.2) — the UI renders whatever string is passed.
   */
  onStatus?: (message: string) => void;
}

/**
 * Runs one agent task end to end: read the files the user put in
 * context, let the agent gather whatever else it needs, then ask for the
 * structured plan, explanation, and diff.
 *
 * The gathering phase is skipped entirely for providers that do not
 * declare tool-calling support, which keeps the single-pass path — still
 * the one most local models take — unchanged.
 */
export async function runAgentTask(
  options: RunAgentTaskOptions
): Promise<AgentTaskResult> {
  const budget = new BudgetTracker(options.budgetLimits ?? DEFAULT_BUDGET_LIMITS);
  const { taskType } = options.input;
  const permissionMode = options.permissionMode ?? DEFAULT_PERMISSION_MODE;

  // Every task that produces a diff clears the same bar, whatever
  // its shape — scaffolding and refactoring are writes like any other.
  if (taskProducesEdits(taskType) && !canProposeEdits(permissionMode)) {
    return escalate(
      taskType,
      budget,
      "permission-denied",
      "This project is set to read-only, so the agent can explain code but not propose changes. Change the permission mode in the status bar to let it suggest edits."
    );
  }

  // Best effort: a project whose files cannot be listed is still worth
  // answering about from the contents the user selected.
  const projectFiles = await options.fs
    .listFiles()
    .then((files) => files.map((file) => file.path))
    .catch(() => [] as string[]);

  const fileContents: Record<string, string> = {};
  /**
   * Long files summarized rather than sent. The agent still knows they
   * exist and what is in them, and can read a range when it needs the
   * code — which beats spending the window on a file the question was
   * not about.
   */
  const outlines: Record<string, string> = {};
  const filesSeen: Record<string, string> = {};
  for (const [index, path] of options.input.targetFiles.entries()) {
    if (budget.isExhausted()) {
      return escalate(taskType, budget, "budget-exhausted", "Ran out of tool-call budget while reading target files.");
    }
    options.onStatus?.(
      options.input.targetFiles.length === 1
        ? `Reading ${path}…`
        : `Reading ${path}… (${index + 1}/${options.input.targetFiles.length})`
    );
    const call: ToolCall = { id: path, name: READ_FILE_TOOL_NAME, arguments: { path } };
    try {
      const content = await executeReadFile(options.fs, call);
      budget.recordToolCall();

      // Best effort: a file whose symbols cannot be read is simply sent
      // whole, which is the behaviour that existed before this.
      const symbols = options.getSymbols
        ? await options.getSymbols(path).catch(() => [])
        : [];
      // Kept whatever form it was sent in: this is the content the
      // model actually saw, and the apply path compares against it to
      // tell "the model misquoted the file" from "the user edited it".
      filesSeen[path] = content;
      if (shouldOutline(content, symbols)) {
        outlines[path] = formatOutline(path, symbols);
      } else {
        fileContents[path] = content;
      }
    } catch (error) {
      return escalate(
        taskType,
        budget,
        "tool-failure",
        `Failed to read ${path}: ${(error as Error).message}`
      );
    }
  }

  const supportsToolCalling = options.provider.model.capabilities.supportsToolCalling;
  const baseMessages: ChatMessage[] = [
    {
      role: "system",
      // The tool phase is only described when tools will actually be
      // offered; otherwise it advertises abilities the model does not have.
      content: buildSystemPrompt(
        taskType,
        options.skillLevel,
        supportsToolCalling,
        canRunCommands(permissionMode) && (options.connectedTools?.length ?? 0) > 0
      ),
    },
    {
      role: "user",
      // The file listing goes in unconditionally: knowing what exists is
      // cheap, and without it the agent cannot tell "absent" from
      // "somewhere I have not looked".
      content: buildUserPrompt(
        options.input.instructions,
        fileContents,
        projectFiles,
        options.contextDocs ?? [],
        outlines
      ),
    },
  ];

  // Gather anything else the agent wants before answering. Providers
  // without tool calling pass straight through.
  options.onStatus?.("Thinking…");
  const investigation = await investigate({
    provider: options.provider,
    fs: options.fs,
    messages: baseMessages,
    budget,
    permissionMode,
    commandAllowlist: options.commandAllowlist ?? DEFAULT_COMMAND_ALLOWLIST,
    runCommand: options.runCommand,
    connectedTools: options.connectedTools,
    onStatus: options.onStatus,
  });

  if (investigation.kind === "blocked") {
    return escalate(taskType, budget, investigation.reason, investigation.message, investigation.steps);
  }

  // The answer format is asked for now, as its own turn, rather than
  // sitting in the system prompt competing with the invitation to
  // investigate.
  const messages: ChatMessage[] = [
    ...investigation.messages,
    { role: "user", content: buildAnswerRequest() },
  ];
  options.onStatus?.("Writing up…");
  const result = await options.provider.chat({ messages });
  const replies: ModelReply[] = [toModelReply("Answer", result)];
  budget.recordTokens((result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0));

  if (budget.isExhausted()) {
    return escalate(taskType, budget, "budget-exhausted", "Token budget exhausted after the model responded.", [], replies);
  }

  let parsed = parseAgentResponse(result.content);

  // Ask once more before giving up.
  //
  // A model that has just been calling tools often replies with another
  // tool call, or with prose, rather than the JSON block — the contract
  // is several messages back by then. Smaller models especially need the
  // reminder. One retry, budget permitting: repeated nudging would be
  // pestering a model that cannot do it.
  //
  // Not when the reply was cut off: the same request would be cut off at
  // the same place, and the reason is one the user can act on.
  const cutOff = result.finishReason === "length";
  if (!parsed.ok && !cutOff && !budget.isExhausted()) {
    options.onStatus?.("Asking for the summary again…");
    const retry = await options.provider.chat({
      messages: [
        ...messages,
        { role: "assistant", content: result.content },
        {
          role: "user",
          // The parser's own words go back with the reminder: "not valid
          // JSON near ..." lets a model fix that spot rather than
          // rewriting everything and slipping somewhere else.
          content: `Your reply could not be used: ${parsed.error}. Reply with only the fenced \`\`\`json block described earlier, valid JSON with a comma between every array element. No tool calls, no prose around it.`,
        },
      ],
    });
    budget.recordTokens(
      (retry.usage?.promptTokens ?? 0) + (retry.usage?.completionTokens ?? 0)
    );
    replies.push(toModelReply("Second try", retry));
    parsed = parseAgentResponse(retry.content);
  }

  if (!parsed.ok && cutOff) {
    return escalate(
      taskType,
      budget,
      "low-confidence",
      "The model ran out of room before it finished its answer, so the plan is incomplete and was not used. Try a smaller task, a model with a larger context window, or raise the model's context size.",
      investigation.steps,
      replies
    );
  }

  if (!parsed.ok) {
    return escalate(
      taskType,
      budget,
      "low-confidence",
      `Could not parse a structured plan from the model's response: ${parsed.error}`,
      investigation.steps,
      replies
    );
  }

  const plan: AgentPlan = {
    taskType,
    summary: parsed.value.summary,
    steps: parsed.value.steps,
  };
  options.onPlan?.(plan);

  // A response that needed mending is shown as such: the reader should
  // check it more closely than one that parsed as sent.
  const repaired = parsed.value.repairs > 0;

  return {
    plan,
    explanation: repaired
      ? `${parsed.value.explanation}\n\nNote: the model's reply had a formatting slip that was repaired automatically (${parsed.value.repairs} ${parsed.value.repairs === 1 ? "fix" : "fixes"}). Read the changes closely before applying.`
      : parsed.value.explanation,
    diff: taskProducesEdits(taskType) ? parsed.value.diff : [],
    confidence: repaired && parsed.value.confidence === "high" ? "medium" : parsed.value.confidence,
    budgetUsage: budget.current,
    investigation: investigation.steps,
    modelReplies: replies,
    filesSeen,
  };
}

function toModelReply(label: string, reply: ChatCompletionResult): ModelReply {
  return {
    label,
    content: reply.content,
    finishReason: reply.finishReason,
    promptTokens: reply.usage?.promptTokens,
    completionTokens: reply.usage?.completionTokens,
  };
}

function escalate(
  taskType: AgentTaskType,
  budget: BudgetTracker,
  reason: EscalationReason,
  message: string,
  steps: InvestigationStep[] = [],
  modelReplies: ModelReply[] = []
): AgentTaskResult {
  return {
    plan: { taskType, summary: "Paused before completing the task.", steps: [] },
    explanation: "",
    diff: [],
    confidence: "low",
    escalation: { reason, message },
    budgetUsage: budget.current,
    // Kept even on a pause: seeing which commands ran and what they said
    // is usually what explains why the agent stopped (CLAUDE.md §7).
    investigation: steps,
    modelReplies,
    // An escalation carries no diff, so there is nothing to place and
    // nothing to compare against.
    filesSeen: {},
  };
}
