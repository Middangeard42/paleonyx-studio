/**
 * A named thing in a source file — a function, a class, a type.
 *
 * The unit of AST-aware indexing (PRD.md §3 journey 2). Deliberately
 * shallow: what the product needs is "what is in this file and where",
 * enough to navigate and to send the agent the relevant function rather
 * than a whole file. A full reference graph is a different, larger
 * feature and is not this.
 */
export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  /** 1-based, inclusive, matching what an editor shows. */
  startLine: number;
  endLine: number;
  /** Enclosing class or namespace, when there is one. */
  container?: string;
}

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "enum";

/** What a file's symbols cost to look at, before deciding to send it. */
export interface FileOutline {
  path: string;
  symbols: CodeSymbol[];
}
