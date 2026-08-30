import { invoke } from "@tauri-apps/api/core";
import type { CodeSymbol } from "@paleonyx/shared-types";

/**
 * Parses one file's symbols in the shell, where tree-sitter lives.
 *
 * Returns an empty list for a language with no grammar, which is an
 * ordinary answer rather than an error — most files in a project are
 * not Tier 1 source.
 */
export async function fileSymbols(path: string): Promise<CodeSymbol[]> {
  return invoke<CodeSymbol[]>("file_symbols", { path });
}
