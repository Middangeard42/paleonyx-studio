import type {
  AgentPlan,
  AgentTaskInput,
  AgentTaskResult,
  AgentTaskType,
  ChatMessage,
  EscalationReason,
  FileSystemReader,
  PermissionMode,
  SkillLevel,
  ToolCall,
} from "@paleonyx/shared-types";
import { DEFAULT_PERMISSION_MODE, canProposeEdits } from "@paleonyx/shared-types";
import type { ChatModelProvider } from "@paleonyx/runtime";
import { BudgetTracker, DEFAULT_BUDGET_LIMITS } from "./budget.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import { parseAgentResponse } from "./parse-response.js";
import { READ_FILE_TOOL_NAME, executeReadFile } from "./tools/read-file.js";

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
  /** Lets the UI render the Task Plan Card as soon as the plan is known. */
  onPlan?: (plan: AgentPlan) => void;
  /**
   * Real phase transitions ("Reading 2 files…", "Thinking…"), not a bare
   * spinner (DESIGN.md §5.2) — the UI renders whatever string is passed.
   */
  onStatus?: (message: string) => void;
}

/**
 * v0's agent loop: read the explicitly targeted files through the gated
 * readFile tool, ask the model once for a structured plan/explanation/
 * diff, validate the response, done. This is deliberately not a
 * multi-turn tool-calling loop with self-correction — that's real
 * complexity earned once auto-apply and the vcs write path exist (v1).
 * For a read/suggest-only Explain or Bug Fix flow scoped to files the
 * user already picked via the guided task form, a single pass is
 * sufficient and keeps this stub honest about what it actually does.
 */
export async function runAgentTask(
  options: RunAgentTaskOptions
): Promise<AgentTaskResult> {
  const budget = new BudgetTracker(options.budgetLimits ?? DEFAULT_BUDGET_LIMITS);
  const { taskType } = options.input;
  const permissionMode = options.permissionMode ?? DEFAULT_PERMISSION_MODE;

  if (taskType === "bug-fix" && !canProposeEdits(permissionMode)) {
    return escalate(
      taskType,
      budget,
      "permission-denied",
      "This project is set to read-only, so the agent can explain code but not propose changes. Change the permission mode in the status bar to let it suggest edits."
    );
  }

  const fileContents: Record<string, string> = {};
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
      fileContents[path] = await executeReadFile(options.fs, call);
      budget.recordToolCall();
    } catch (error) {
      return escalate(
        taskType,
        budget,
        "tool-failure",
        `Failed to read ${path}: ${(error as Error).message}`
      );
    }
  }

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(taskType, options.skillLevel) },
    { role: "user", content: buildUserPrompt(options.input.instructions, fileContents) },
  ];

  options.onStatus?.("Thinking…");
  const result = await options.provider.chat({ messages });
  budget.recordTokens((result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0));

  if (budget.isExhausted()) {
    return escalate(taskType, budget, "budget-exhausted", "Token budget exhausted after the model responded.");
  }

  const parsed = parseAgentResponse(result.content);
  if (!parsed.ok) {
    return escalate(
      taskType,
      budget,
      "low-confidence",
      `Could not parse a structured plan from the model's response: ${parsed.error}`
    );
  }

  const plan: AgentPlan = {
    taskType,
    summary: parsed.value.summary,
    steps: parsed.value.steps,
  };
  options.onPlan?.(plan);

  return {
    plan,
    explanation: parsed.value.explanation,
    diff: taskType === "bug-fix" ? parsed.value.diff : [],
    confidence: parsed.value.confidence,
    budgetUsage: budget.current,
  };
}

function escalate(
  taskType: AgentTaskType,
  budget: BudgetTracker,
  reason: EscalationReason,
  message: string
): AgentTaskResult {
  return {
    plan: { taskType, summary: "Paused before completing the task.", steps: [] },
    explanation: "",
    diff: [],
    confidence: "low",
    escalation: { reason, message },
    budgetUsage: budget.current,
  };
}
