import type { CodeSymbol } from "@paleonyx/shared-types";

/**
 * Using a file's symbols instead of its whole text.
 *
 * This is where AST-awareness pays for itself. A 2,000-line file sent
 * whole spends the context window on code nobody asked about and pushes
 * out the code they did; sent as an outline it costs a few dozen lines
 * and still tells the agent what is in there and where to look. Poor
 * context handling is one of the gaps this product exists to close
 * (PRD.md §1), and a file listing alone was never going to close it.
 */

/**
 * The symbol a line falls inside, innermost first.
 *
 * Ranges nest — a method sits inside a class — so the last match
 * wins: it is the most specific thing containing that line, and the one
 * a person pointing at the line means.
 */
export function symbolAtLine(
  symbols: readonly CodeSymbol[],
  line: number
): CodeSymbol | null {
  let best: CodeSymbol | null = null;
  for (const symbol of symbols) {
    if (line < symbol.startLine || line > symbol.endLine) continue;
    if (!best || span(symbol) <= span(best)) best = symbol;
  }
  return best;
}

/**
 * A compact map of a file, for a prompt.
 *
 * Line numbers are included because they are what makes the outline
 * actionable rather than decorative: an agent that can see `sum` is at
 * lines 40-58 can ask to read that range instead of the file.
 */
export function formatOutline(path: string, symbols: readonly CodeSymbol[]): string {
  if (symbols.length === 0) return `${path}: no functions or classes found.`;

  const lines = symbols.map((symbol) => {
    const name = symbol.container
      ? `${symbol.container}.${symbol.name}`
      : symbol.name;
    return `  ${symbol.kind} ${name} (lines ${symbol.startLine}-${symbol.endLine})`;
  });
  return [`${path}:`, ...lines].join("\n");
}

/**
 * Pulls one symbol's source out of a file.
 *
 * Returns null rather than a clamped guess when the range does not fit
 * the text — that means the file changed since it was parsed, and a
 * confidently wrong excerpt is worse than none.
 */
export function extractSymbolSource(
  content: string,
  symbol: CodeSymbol
): string | null {
  const lines = content.split(/\r?\n/);
  if (symbol.startLine < 1 || symbol.endLine > lines.length) return null;
  if (symbol.endLine < symbol.startLine) return null;
  return lines.slice(symbol.startLine - 1, symbol.endLine).join("\n");
}

/**
 * Whether a file is worth summarizing rather than sending whole.
 *
 * The threshold is in lines rather than tokens on purpose: it has to be
 * decidable without a tokenizer, and be a number a person can reason
 * about when they see the outline appear instead of the file.
 */
export const OUTLINE_THRESHOLD_LINES = 400;

export function shouldOutline(
  content: string,
  symbols: readonly CodeSymbol[],
  thresholdLines = OUTLINE_THRESHOLD_LINES
): boolean {
  // Nothing to outline with is not a reason to send nothing — a long
  // file we cannot parse still goes in whole.
  if (symbols.length === 0) return false;
  return countLines(content) > thresholdLines;
}

function countLines(content: string): number {
  if (content === "") return 0;
  return content.split(/\r?\n/).length;
}

function span(symbol: CodeSymbol): number {
  return symbol.endLine - symbol.startLine;
}
