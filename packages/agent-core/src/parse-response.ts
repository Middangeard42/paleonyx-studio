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
export function parseAgentResponse(raw: string): ParseResult {
  const fenceMatch = raw.match(JSON_FENCE);
  const jsonText = fenceMatch?.[1] ?? raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return { ok: false, error: `Response was not valid JSON: ${(error as Error).message}` };
  }

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

  const diff = parseDiff(record.diff);
  if (!diff.ok) return diff;

  return {
    ok: true,
    value: {
      summary: record.summary,
      explanation: record.explanation,
      confidence: record.confidence as ConfidenceLevel,
      steps: steps.value,
      diff: diff.value,
    },
  };
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
