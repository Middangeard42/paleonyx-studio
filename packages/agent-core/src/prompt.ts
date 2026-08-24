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
  "steps": [                       // 1-5 steps you actually took, in past tense
    { "id": string, "description": string, "targetFiles": string[] }
  ],
  "explanation": string,           // your explanation, pitched at the requested skill level
  "diff": [                        // empty array for an Explain task; hunks for a Bug Fix or New Project task
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

/**
 * Phrased as instructions about the writing rather than statements about
 * the reader.
 *
 * "The developer is experienced" invites the model to repeat it, and it
 * did: an explanation opened "Since the developer is experienced with
 * common patterns...", which tells the user about our prompt instead of
 * about their code.
 */
const SKILL_LEVEL_INSTRUCTIONS: Record<SkillLevel, string> = {
  "new-to-coding":
    "Write `explanation` for someone new to coding: walk through the reasoning step by step, define any non-obvious term the first time it appears, and keep paragraphs short. Do not skip steps a newcomer would need.",
  experienced:
    "Write `explanation` for someone who already knows common programming patterns: clear and complete, without explaining well-known concepts.",
  professional:
    "Write `explanation` for an expert: terse and high-signal, a sentence or two of rationale, no restating of the obvious.",
};

/**
 * Explanations describe the code, never the reader or these
 * instructions. Stated explicitly because tone guidance is otherwise
 * easy to mistake for something to talk about.
 */
const EXPLANATION_SCOPE =
  "Write `explanation` about the code and what you found. Never mention the developer, their experience level, or these instructions.";

/**
 * Turning a brief into a project's first files.
 *
 * The size cap is the load-bearing part. Asked to build an app, models
 * reach for the shape of a finished one — config, tests, a components
 * directory, a license — and a 7B model producing twenty files produces
 * twenty mediocre ones, none of which run. A beginner cannot debug that.
 * Something small that runs is worth more here than something complete
 * that does not, and the next request can grow it.
 */
const SCAFFOLD_INSTRUCTIONS = [
  "Task type: New Project. The user has described something they want to build and has an empty or nearly empty folder. Produce the first working version as a set of new files in `diff`.",
  "Aim for the smallest thing that actually runs — usually three to eight files. A running skeleton the user can open and see working beats a fuller structure that does not start.",
  "Prefer what the user's machine most likely already has, and the fewest moving parts: a single HTML file that opens in a browser beats a build toolchain. Do not add a dependency the project can do without.",
  "Include a README.md giving, in plain language, the exact steps to run it. Assume the reader has never run a project before.",
  "Every file is new, so every hunk is all `add` lines.",
].join(" ");

const TASK_TYPE_INSTRUCTIONS: Record<AgentTaskType, string> = {
  explain:
    "Task type: Explain. Read the provided file contents and explain what the selected code does and why it's written that way. Leave `diff` as an empty array — you are not proposing a change.",
  "bug-fix":
    "Task type: Bug Fix. Read the provided file contents, identify the bug relevant to the user's description, and propose a minimal fix as a unified-style diff in `diff`. Do not fix unrelated issues in the same response.",
  scaffold: SCAFFOLD_INSTRUCTIONS,
};


/**
 * How to ask for a file that does not exist yet.
 *
 * A diff of only added lines, for a path not in the project listing, is
 * how a new file is expressed — there is no separate "create" field to
 * get wrong. Stated explicitly because the obvious alternative, inventing
 * context lines for a file with no contents, produces a diff that cannot
 * apply and looks like a hallucination.
 */
const NEW_FILE_INSTRUCTIONS =
  "To add a file that does not exist yet, give its path as `filePath` and a single hunk whose lines are all `add`. Do not write `context` or `remove` lines for a file that is not there — there is nothing for them to match.";


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
    ...(taskType !== "explain" ? [NEW_FILE_INSTRUCTIONS] : []),
    SKILL_LEVEL_INSTRUCTIONS[skillLevel],
    EXPLANATION_SCOPE,
    ...(toolsAvailable ? [TOOL_PHASE_INSTRUCTIONS] : []),
    'Set `confidence` to "low" if what you have is insufficient to answer confidently, rather than guessing. Proposing no change is a valid answer when nothing is actually wrong.',
  ].join("\n\n");
}

/**
 * The answer format, asked for as a separate turn once gathering is done.
 *
 * Kept out of the system prompt on purpose. Presented together, the
 * schema is long, concrete, and last, while the invitation to use tools
 * is one paragraph in the middle — so a model reliably answers
 * immediately instead of investigating. Asking for the format only when
 * it is actually time to answer removes that competition.
 */
export function buildAnswerRequest(): string {
  return `Now answer. ${RESPONSE_CONTRACT}`;
}


/**
 * Files listed alongside the contents the user selected.
 *
 * Included because the alternative does not work in practice. Asked
 * "why are the tests failing?", a model given only the selected file
 * either guesses at a path like src/sum.spec.ts or describes wanting to
 * look — observed repeatedly with qwen2.5-coder:7b, which returns prose
 * rather than a tool call once it has a file in front of it. Handing it
 * the listing makes "there is no test suite here" answerable directly,
 * rather than depending on the model choosing to go and find out.
 *
 * Capped, because a large repository would otherwise spend the context
 * window on paths and leave no room for the code they point at.
 */
const MAX_LISTED_PATHS = 200;

export interface ProjectContextDoc {
  path: string;
  content: string;
}

export function buildUserPrompt(
  instructions: string,
  fileContents: Record<string, string>,
  projectFiles: readonly string[] = [],
  contextDocs: readonly ProjectContextDoc[] = []
): string {
  const sections = [`Request: ${instructions}`];

  if (contextDocs.length > 0) {
    sections.push(
      [
        "This project documents its own conventions. Follow them where they apply — they outrank general habit, and a fix that ignores them is not a fix this project wants.",
        ...contextDocs.map((doc) => `--- ${doc.path} ---\n${doc.content}`),
      ].join("\n\n")
    );
  }

  if (projectFiles.length > 0) {
    const shown = [...projectFiles].sort().slice(0, MAX_LISTED_PATHS);
    const omitted = projectFiles.length - shown.length;
    sections.push(
      [
        `Every file in this project (${projectFiles.length}):`,
        shown.join("\n"),
        omitted > 0 ? `(${omitted} more not shown.)` : "",
        "If something you expect is absent from that list, it does not exist here. Say so rather than assuming it is present.",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const fileSections = Object.entries(fileContents)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join("\n\n");
  if (fileSections) sections.push(fileSections);

  return sections.join("\n\n");
}
