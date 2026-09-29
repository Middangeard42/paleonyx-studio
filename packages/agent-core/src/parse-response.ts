import type {
  AgentPlanStep,
  ConfidenceLevel,
  DiffHunk,
  DiffLine,
  DiffLineType,
  FileDiff,
} from "@paleonyx/shared-types";

export interface ParsedAgentResponse {
  summary: string;
  steps: AgentPlanStep[];
  explanation: string;
  diff: FileDiff[];
  confidence: ConfidenceLevel;
  /** Characters put back to make the text parse; 0 when it parsed as sent. */
  repairs: number;
}

export type ParseResult =
  | { ok: true; value: ParsedAgentResponse }
  | { ok: false; error: string };

const JSON_FENCE = /```json\s*([\s\S]*?)```/i;
const CONFIDENCE_VALUES: readonly ConfidenceLevel[] = ["high", "medium", "low"];
const DIFF_LINE_TYPES: readonly DiffLineType[] = ["context", "add", "remove"];

/**
 * This is a real boundary — untrusted model output — so it's genuinely
 * validated field by field (CLAUDE.md §3), not just cast. Anything that
 * doesn't match the contract in prompt.ts's RESPONSE_CONTRACT fails with
 * a specific error message rather than silently coercing bad data.
 */
export function parseAgentResponse(rawResponse: string): ParseResult {
  const blocks = extractFileBlocks(rawResponse);
  if (!blocks.ok) return blocks;
  const raw = blocks.rest;
  const fenceMatch = raw.match(JSON_FENCE);
  const jsonText = fenceMatch?.[1] ?? raw;

  const decoded = decodeJson(jsonText);
  if (!decoded.ok) return decoded;
  const parsed = decoded.value;

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "Response JSON was not an object." };
  }

  const record = parsed as Record<string, unknown>;

  if (typeof record.summary !== "string") {
    return { ok: false, error: "Missing or non-string 'summary'." };
  }
  if (typeof record.explanation !== "string") {
    return { ok: false, error: "Missing or non-string 'explanation'." };
  }
  if (!CONFIDENCE_VALUES.includes(record.confidence as ConfidenceLevel)) {
    return { ok: false, error: `Missing or invalid 'confidence': ${String(record.confidence)}` };
  }

  const steps = parseSteps(record.steps);
  if (!steps.ok) return steps;

  // Left out when the files are all in blocks; anything else present
  // still has to be a well-formed diff.
  const diff = parseDiff(record.diff === undefined && blocks.files.length > 0 ? [] : record.diff);
  if (!diff.ok) return diff;

  return {
    ok: true,
    value: {
      summary: record.summary,
      explanation: record.explanation,
      confidence: record.confidence as ConfidenceLevel,
      steps: steps.value,
      diff: [...diff.value, ...blocks.files],
      repairs: decoded.repairs,
    },
  };
}

const FILE_BLOCK = /<<<FILE[ \t]*([^\r\n]*)\r?\n([\s\S]*?)FILE>>>/g;

/**
 * New files arrive as plain text between markers, not as JSON.
 *
 * Written as one JSON object per line, a whole new project is a
 * several-hundred-element array that a small model has to keep balanced,
 * and it loses a bracket or a comma somewhere. Text between markers has
 * nothing to balance: whatever is in the block is the file, byte for
 * byte. A block that is never closed is refused, not kept, so a reply
 * that was cut off cannot hand over half a file.
 */
function extractFileBlocks(
  raw: string
):
  | { ok: true; files: FileDiff[]; rest: string }
  | { ok: false; error: string } {
  const files: FileDiff[] = [];
  let problem: string | undefined;
  const rest = raw.replace(FILE_BLOCK, (_whole, rawPath: string, body: string) => {
    const filePath = rawPath.trim();
    if (filePath === "") {
      problem ??= "A file block had no path after <<<FILE.";
      return "";
    }
    const lines = body.replace(/\r\n/g, "\n").split("\n");
    files.push({
      filePath,
      hunks: [
        {
          header: `@@ -0,0 +1,${lines.length} @@`,
          lines: lines.map((content) => ({ type: "add", content })),
        },
      ],
    });
    return "";
  });
  if (problem) return { ok: false, error: problem };
  const open = /<<<FILE[ \t]*([^\r\n]*)/.exec(rest);
  if (open) {
    return {
      ok: false,
      error: `The file block for ${open[1]?.trim() || "a file"} was never closed with FILE>>>, so the file is incomplete and was not used.`,
    };
  }
  return { ok: true, files, rest };
}

const MAX_REPAIRS = 50;

/**
 * Parses the model's JSON, mending the two slips small models make in a
 * long response: a comma dropped between two elements, and a raw line
 * break inside a string.
 *
 * Only those two, and only by adding one character at the position the
 * parser names. Anything else fails as before. In particular a response
 * that was cut off is never completed: V8 reports it with the same
 * "Expected ',' or ']'" wording as a dropped comma, at the end of the
 * text, and closing it would present a half-written file as finished.
 * The result still goes through the contract checks below.
 */
function decodeJson(
  original: string
): { ok: true; value: unknown; repairs: number } | { ok: false; error: string } {
  let text = original;
  for (let repairs = 0; ; repairs++) {
    try {
      return { ok: true, value: JSON.parse(text), repairs };
    } catch (error) {
      const message = (error as Error).message;
      const failure = `Response was not valid JSON: ${message}${excerpt(text, message)}`;
      if (repairs >= MAX_REPAIRS) return { ok: false, error: failure };
      const mended = mend(text, message);
      if (mended === undefined) return { ok: false, error: failure };
      text = mended;
    }
  }
}

function errorPosition(message: string): number | undefined {
  const match = /position (\d+)/.exec(message);
  return match ? Number(match[1]) : undefined;
}

function mend(text: string, message: string): string | undefined {
  const position = errorPosition(message);
  if (position === undefined) return undefined;
  // At the end of the text there is no character, so a cut-off response
  // matches neither branch below.
  const char = text[position] ?? "";

  if (message.startsWith("Bad control character")) {
    const escapes: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };
    const escaped = escapes[char];
    return escaped === undefined
      ? undefined
      : text.slice(0, position) + escaped + text.slice(position + 1);
  }

  const missingComma =
    message.startsWith("Expected ',' or ']' after array element") ||
    message.startsWith("Expected ',' or '}' after property value");
  if (missingComma && (char === "{" || char === "[" || char === '"')) {
    return text.slice(0, position) + "," + text.slice(position);
  }
  return undefined;
}

/** The text around the failure, so a reader can see what the parser saw. */
function excerpt(text: string, message: string): string {
  const position = errorPosition(message);
  if (position === undefined) return "";
  const start = Math.max(0, position - 40);
  const near = text.slice(start, position + 20).replace(/\s+/g, " ");
  return ` (near: ${near})`;
}

function parseSteps(
  value: unknown
): { ok: true; value: AgentPlanStep[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "'steps' was not an array." };
  }
  const steps: AgentPlanStep[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, error: `steps[${index}] was not an object.` };
    }
    const step = entry as Record<string, unknown>;
    if (typeof step.id !== "string" || typeof step.description !== "string") {
      return { ok: false, error: `steps[${index}] is missing 'id' or 'description'.` };
    }
    steps.push({
      id: step.id,
      description: step.description,
      targetFiles: Array.isArray(step.targetFiles)
        ? step.targetFiles.filter((f): f is string => typeof f === "string")
        : undefined,
    });
  }
  return { ok: true, value: steps };
}

function parseDiff(
  value: unknown
): { ok: true; value: FileDiff[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "'diff' was not an array." };
  }
  const fileDiffs: FileDiff[] = [];
  for (const [fileIndex, entry] of value.entries()) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, error: `diff[${fileIndex}] was not an object.` };
    }
    const fileDiff = entry as Record<string, unknown>;
    if (typeof fileDiff.filePath !== "string" || !Array.isArray(fileDiff.hunks)) {
      return { ok: false, error: `diff[${fileIndex}] is missing 'filePath' or 'hunks'.` };
    }
    const hunks: DiffHunk[] = [];
    for (const [hunkIndex, hunkEntry] of fileDiff.hunks.entries()) {
      if (typeof hunkEntry !== "object" || hunkEntry === null) {
        return { ok: false, error: `diff[${fileIndex}].hunks[${hunkIndex}] was not an object.` };
      }
      const hunk = hunkEntry as Record<string, unknown>;
      if (typeof hunk.header !== "string" || !Array.isArray(hunk.lines)) {
        return {
          ok: false,
          error: `diff[${fileIndex}].hunks[${hunkIndex}] is missing 'header' or 'lines'.`,
        };
      }
      const lines: DiffLine[] = [];
      for (const [lineIndex, lineEntry] of hunk.lines.entries()) {
        if (typeof lineEntry !== "object" || lineEntry === null) {
          return {
            ok: false,
            error: `diff[${fileIndex}].hunks[${hunkIndex}].lines[${lineIndex}] was not an object.`,
          };
        }
        const line = lineEntry as Record<string, unknown>;
        if (
          !DIFF_LINE_TYPES.includes(line.type as DiffLineType) ||
          typeof line.content !== "string"
        ) {
          return {
            ok: false,
            error: `diff[${fileIndex}].hunks[${hunkIndex}].lines[${lineIndex}] has an invalid 'type' or 'content'.`,
          };
        }
        lines.push({ type: line.type as DiffLineType, content: line.content });
      }
      hunks.push({ header: hunk.header, lines });
    }
    fileDiffs.push({ filePath: fileDiff.filePath, hunks });
  }
  return { ok: true, value: fileDiffs };
}
