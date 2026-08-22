/**
 * Extension → Monaco language id. v0 only needs enough to drive the file
 * tree's icons and the editor's language selection for the Tier 1
 * languages (PRD.md §4): Python, JavaScript, TypeScript. AST-aware
 * parsing for any tier is a later-phase concern (packages/indexing
 * eventually grows tree-sitter integration here).
 */
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  yml: "yaml",
  yaml: "yaml",
  rs: "rust",
  go: "go",
};

export function inferLanguage(path: string): string | undefined {
  const extension = path.split(".").pop()?.toLowerCase();
  if (!extension) return undefined;
  return EXTENSION_LANGUAGE_MAP[extension];
}
