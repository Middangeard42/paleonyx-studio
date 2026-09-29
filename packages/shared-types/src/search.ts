/**
 * Project search (DESIGN.md §3.1 — the Search mode of the activity bar).
 *
 * Deliberately plain text rather than regex for now: this is the search
 * a person reaches for while reading code, and an accidental regex
 * metacharacter silently changing what matched would be worse than not
 * offering the feature.
 */
export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  /** Match whole words only, so `set` does not hit `offset`. */
  wholeWord: boolean;
}

export interface SearchMatch {
  /** 1-based, matching what the editor's gutter shows. */
  line: number;
  /** The full line, trimmed of trailing whitespace. */
  text: string;
  /** Character offsets of the match within `text`, for highlighting. */
  start: number;
  end: number;
}

export interface FileSearchResult {
  path: string;
  matches: SearchMatch[];
}

export interface SearchResults {
  files: FileSearchResult[];
  /**
   * True when the search stopped early at a result cap. Surfaced rather
   * than hidden: a truncated result set that looks complete would let
   * someone conclude something is absent when it is not.
   */
  truncated: boolean;
  /** Total matches found, which may exceed what `files` carries. */
  totalMatches: number;
  /**
   * Files that matched but cannot be listed, because their names are not
   * valid text. Not in `files` or in `totalMatches`; reported so that a
   * search which came up short of them does not read as complete.
   */
  skippedNames: number;
}
