import type { AgentTaskType, SkillLevel } from "@paleonyx/shared-types";
import { taskProducesEdits } from "@paleonyx/shared-types";

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
  "Among the ways of building what was asked for, take the one with the fewest moving parts and the least to install. Do not add a dependency the project can do without. This chooses between approaches that meet the stated target — it is not a reason to build something else.",
  "If you cannot build what was asked for, or judge that a different form is the better first version, say so in the first sentence of `explanation` and say why. Never substitute silently.",
  "Anything that runs in a browser with no build step must be plain JavaScript. A browser cannot execute TypeScript: `<script src=\"app.ts\">` fails to load, and type annotations or `export` in a classic script are syntax errors. Use `.js` files, and `<script type=\"module\">` if you want imports. Only write TypeScript when the project actually has a build step, and then include it.",
  "The result must run as delivered. Do not reference a file, script, or command the project does not contain.",
  "Include a README.md giving, in plain language, the exact steps to run it. Assume the reader has never run a project before.",
  "Every file is new, so every hunk is all `add` lines.",
].join(" ");

/**
 * Changing what the user pointed at, and only that.
 *
 * The distinctive risk of this task is scope. The user selected one
 * button; a model given a whole page and asked to "make it green" will
 * cheerfully restyle the rest of it, and because the request came from
 * pointing rather than naming, the user has no file in mind to check
 * against. Narrowness is the property that makes pointing trustworthy.
 */
const DESIGN_CHANGE_INSTRUCTIONS = [
  "Task type: Design Change. The user is looking at their project running, has clicked one element on the page, and described how they want it to change.",
  "Change only that element. Leave everything else on the page exactly as it is, including elements that look like it — a request about one button is not a request about every button.",
  "Prefer the smallest edit that achieves it. Restructuring the page to make a colour change is not the change that was asked for.",
  "If what they asked for is ambiguous about the element you found, say what you assumed in `explanation` rather than picking silently.",
].join(" ")

/**
 * Restructuring without changing what the code does.
 *
 * The failure mode is a refactor that quietly alters behaviour while
 * being described as one that does not — the user approves a diff on
 * the promise that nothing changes, which is exactly why they may read
 * it less carefully than a bug fix. Bundling a fix in is the same
 * problem wearing a helpful face.
 */
const REFACTOR_INSTRUCTIONS = [
  "Task type: Refactor. Restructure the code the user points at so it is clearer or better organised, without changing what it does.",
  "Behaviour must be identical afterwards, including edge cases and error handling. Same inputs, same outputs, same failures.",
  "If you notice a bug while refactoring, say so in `explanation` and leave it alone. Fixing it here hides a behaviour change inside a diff the user was told does not have one.",
  "Follow the conventions already in the file. A refactor that also restyles the code makes the real change hard to see.",
].join(" ");

/**
 * Tests that would actually catch something.
 *
 * Two things go wrong. A model invents a framework the project does not
 * have, producing tests nobody can run; or it writes tests that pass no
 * matter what the code does, which is worse than no tests because they
 * look like coverage.
 */
const WRITE_TESTS_INSTRUCTIONS = [
  "Task type: Write Tests. Add tests for the code the user points at.",
  "Use the test framework this project already uses — look at its config and its existing tests before writing any. If it has no test setup at all, say so in `explanation` and propose one rather than silently picking a framework and writing tests that cannot run.",
  "Every test must be able to fail. Assert on real behaviour, not on the fact that a function returned; a test that passes whatever the code does is worse than none, because it reads as coverage.",
  "Cover the cases that actually break: empty input, boundaries, the error path. A test for the happy path alone rarely catches anything.",
  "Do not change the code under test to make a test pass. If it looks wrong, say so and leave it.",
].join(" ");

/**
 * Documentation that says something the code does not.
 *
 * The default failure is narration — a comment restating the line below
 * it. What earns its place is intent, constraint, and the reason a
 * choice was made, none of which is recoverable from reading the code.
 */
const DOCUMENT_INSTRUCTIONS = [
  "Task type: Document. Add or improve documentation for the code the user points at.",
  "Explain why the code is the way it is: what it is for, what it assumes, what it refuses to do and why. Do not narrate what the next line does — the reader can see that.",
  "Match the documentation style already in the project. If files use a particular comment form, use it too.",
  "Change only comments and documentation. If the code needs fixing to match its documentation, say so in `explanation` rather than editing it here.",
].join(" ");

const TASK_TYPE_INSTRUCTIONS: Record<AgentTaskType, string> = {
  explain:
    "Task type: Explain. Read the provided file contents and explain what the selected code does and why it's written that way. Leave `diff` as an empty array — you are not proposing a change.",
  "bug-fix":
    "Task type: Bug Fix. Read the provided file contents, identify the bug relevant to the user's description, and propose a minimal fix as a unified-style diff in `diff`. Do not fix unrelated issues in the same response.",
  refactor: REFACTOR_INSTRUCTIONS,
  "write-tests": WRITE_TESTS_INSTRUCTIONS,
  document: DOCUMENT_INSTRUCTIONS,
  scaffold: SCAFFOLD_INSTRUCTIONS,
  "design-change": DESIGN_CHANGE_INSTRUCTIONS,
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
 * The shape of a hunk that edits a file that already exists.
 *
 * Written after watching a correct piece of reasoning produce an
 * unusable diff. Asked to enlarge a button, the model found the right
 * line, computed the right size, and then expressed the substitution as
 * an `add` with no `remove` — and repeated a context line that occurs
 * once in the file. The search sequence it described therefore did not
 * exist, and the change was refused.
 *
 * The rules are stated as an example because that is the form the
 * mistake takes: the intent was right and the encoding was wrong, and a
 * worked example is a better corrective than a description of one.
 */
const EDIT_SHAPE_INSTRUCTIONS = [
  "How to write a hunk that changes a file that already exists:",
  "To change a line, emit a `remove` line holding the file's current text and an `add` line holding the replacement. An `add` on its own inserts a new line and leaves the old one in place — if you meant to change something and wrote only `add`, the file ends up with both versions.",
  "`context` and `remove` lines together must reproduce an unbroken run of consecutive lines from the file, copied as they actually appear and in the order they appear. Do not repeat a line that occurs once, do not reorder them, and do not include a line you have not actually seen in the file.",
  "Two or three context lines are plenty. More is not safer — every extra line is another chance to misquote the file, and one wrong character means the change cannot be placed at all.",
  "For example, changing `<button id='go'>Go</button>` to add a style, where the button sits between a heading and a paragraph:",
  '{"header": "@@ -9,3 +9,3 @@", "lines": [{"type": "context", "content": "<h1>Title</h1>"}, {"type": "remove", "content": "<button id=\'go\'>Go</button>"}, {"type": "add", "content": "<button id=\'go\' style=\'width:220px\'>Go</button>"}, {"type": "context", "content": "<p>After</p>"}]}',
  "Note what that does and does not do: one `remove` paired with one `add`, each context line appearing exactly once, and nothing quoted that is not in the file.",
].join(" ");


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
  "Use the provided tools for what they cover. To see a file, call the read tool — do not run `cat`, `type`, `head` or `less`; you already have its contents once you have read it, and reading it a second way tells you nothing new. Commands are for what no tool covers, such as running the test suite.",
  "Commands are for finding things out, never for changing them. Do not run `sed`, do not redirect output into a file, do not use any command that writes, moves, or deletes anything — not even to make the change you were asked for. A change made that way never reaches the diff, so the user never sees it, it is not recorded, and it cannot be undone. Every change you want goes in `diff` and nowhere else.",
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
    ...(taskProducesEdits(taskType)
      ? [NEW_FILE_INSTRUCTIONS, EDIT_SHAPE_INSTRUCTIONS]
      : []),
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
  contextDocs: readonly ProjectContextDoc[] = [],
  /**
   * Files given as a map of what is in them rather than their text,
   * because sending them whole would spend the context window on code
   * nobody asked about. Kept in their own section, labelled: a model
   * shown an outline and led to believe it is the file will answer
   * about code it has not seen.
   */
  outlines: Record<string, string> = {}
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

  const outlineEntries = Object.values(outlines);
  if (outlineEntries.length > 0) {
    sections.push(
      [
        "These files are too long to include in full, so here is what is in each one instead of its text. You have NOT been shown this code — to see any of it, read the file. The line numbers tell you where to look.",
        ...outlineEntries,
      ].join("\n\n")
    );
  }

  const fileSections = Object.entries(fileContents)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join("\n\n");
  if (fileSections) sections.push(fileSections);

  return sections.join("\n\n");
}
