import type { AgentTaskType, SkillLevel } from "@paleonyx/shared-types";

/**
 * The model must respond with exactly one fenced ```json block matching
 * this shape. It's the parsing contract for parse-response.ts — keep the
 * two in sync.
 */
const RESPONSE_CONTRACT = `Respond with exactly one fenced `.concat(
  "```json",
  ` code block and nothing else outside it. The JSON must match this shape:
{
  "summary": string,               // one sentence describing the plan
  "steps": [                       // 1-5 steps you took or would take
    { "id": string, "description": string, "targetFiles": string[] }
  ],
  "explanation": string,           // your explanation, pitched at the requested skill level
  "diff": [                        // empty array for an Explain task; hunks for a Bug Fix task
    {
      "filePath": string,
      "hunks": [
        {
          "header": string,       // e.g. "@@ -12,3 +12,4 @@"
          "lines": [
            { "type": "context" | "add" | "remove", "content": string }
          ]
        }
      ]
    }
  ],
  "confidence": "high" | "medium" | "low"
}`
);

const SKILL_LEVEL_INSTRUCTIONS: Record<SkillLevel, string> = {
  "new-to-coding":
    "The developer is new to coding. In `explanation`, walk through your reasoning step by step, define any non-obvious term the first time you use it, and keep paragraphs short. Do not skip steps a newcomer would need.",
  experienced:
    "The developer is experienced with common patterns. In `explanation`, be clear and complete but do not over-explain well-known concepts.",
  professional:
    "The developer is a professional. In `explanation`, be terse and high-signal: a one- or two-sentence rationale by default, no restating of the obvious. Depth is available only if asked for.",
};

const TASK_TYPE_INSTRUCTIONS: Record<AgentTaskType, string> = {
  explain:
    "Task type: Explain. Read the provided file contents and explain what the selected code does and why it's written that way. Leave `diff` as an empty array — you are not proposing a change.",
  "bug-fix":
    "Task type: Bug Fix. Read the provided file contents, identify the bug relevant to the user's description, and propose a minimal fix as a unified-style diff in `diff`. Do not fix unrelated issues in the same response.",
};

export function buildSystemPrompt(
  taskType: AgentTaskType,
  skillLevel: SkillLevel
): string {
  return [
    "You are the planning/response engine for Paleonyx Studio, a local-first AI IDE. You never write files directly — you only ever propose plans, explanations, and diffs for the user to review.",
    TASK_TYPE_INSTRUCTIONS[taskType],
    SKILL_LEVEL_INSTRUCTIONS[skillLevel],
    "Set `confidence` to \"low\" if the provided file contents are insufficient to complete the task confidently, rather than guessing.",
    RESPONSE_CONTRACT,
  ].join("\n\n");
}

export function buildUserPrompt(
  instructions: string,
  fileContents: Record<string, string>
): string {
  const fileSections = Object.entries(fileContents)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join("\n\n");
  return [`Request: ${instructions}`, fileSections].join("\n\n");
}
