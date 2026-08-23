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

/**
 * Instructions for the phase before the answer.
 *
 * Without this the prompt actively defeats the tool loop: telling a
 * model to reply with a JSON block "and nothing else" is an instruction
 * not to call tools, and a well-behaved model obeys it — describing the
 * file it would like to read instead of reading it. Offering tools while
 * forbidding their use gets the worst of both.
 */
const TOOL_PHASE_INSTRUCTIONS = [
  "Before answering, you may call the provided tools to gather what you need: read other files, or run an allowlisted command such as the test suite, and read its output.",
  "Prefer checking to guessing. If you need a file, read it rather than saying you would like to.",
  "A tool may fail: a file may not exist, a command may not be permitted. That is information. Report what you actually found rather than assuming the thing you expected is there.",
  "When you have enough to answer, stop calling tools and reply with the JSON block described below.",
].join(" ");

export function buildSystemPrompt(
  taskType: AgentTaskType,
  skillLevel: SkillLevel,
  toolsAvailable = false
): string {
  return [
    "You are the planning/response engine for Paleonyx Studio, a local-first AI IDE. You never write files directly — you only ever propose plans, explanations, and diffs for the user to review.",
    TASK_TYPE_INSTRUCTIONS[taskType],
    SKILL_LEVEL_INSTRUCTIONS[skillLevel],
    ...(toolsAvailable ? [TOOL_PHASE_INSTRUCTIONS] : []),
    'Set `confidence` to "low" if what you have is insufficient to answer confidently, rather than guessing. Proposing no change is a valid answer when nothing is actually wrong.',
    toolsAvailable ? `When you are ready to answer: ${RESPONSE_CONTRACT}` : RESPONSE_CONTRACT,
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
