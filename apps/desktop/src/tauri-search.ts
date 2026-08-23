import { invoke } from "@tauri-apps/api/core";
import type { SearchOptions, SearchResults } from "@paleonyx/shared-types";

/**
 * Runs in Rust rather than the webview: walking a repository and reading
 * every file through the IPC boundary one at a time would be far slower
 * than doing the whole search where the files already are.
 */
export async function searchProject(options: SearchOptions): Promise<SearchResults> {
  return invoke<SearchResults>("search_project", {
    query: options.query,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
  });
}
