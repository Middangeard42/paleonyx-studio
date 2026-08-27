/**
 * What the user pointed at in the live preview (PRD.md §3 journey 14).
 *
 * The app cannot read the preview frame's DOM — it is sandboxed without
 * `allow-same-origin` precisely so previewed code cannot reach back into
 * Paleonyx — so this arrives by message from a small script the preview
 * server injects while design mode is on. Everything here is therefore a
 * report about the running page, not something we looked up.
 *
 * The optional fields are the extension points. Locating source from
 * element facts is what ships first; a screenshot (for a vision-capable
 * model) and an exact source location (from build-time tagging) are
 * additional ways to answer the same question, and each adds a field
 * rather than replacing this shape.
 */
export interface DesignSelection {
  /** Project-relative path of the page being previewed. */
  page: string;
  /** Uppercase tag name, as the DOM reports it. */
  tag: string;
  id: string | null;
  classes: string[];
  /** Visible text, trimmed and capped by the injected script. */
  text: string;
  /**
   * Ancestor chain, outermost first, ending with the element itself —
   * enough to tell two same-looking buttons apart.
   */
  path: string[];
  rect: SelectionRect;
  /**
   * Set only when the active model can actually read an image
   * (`ModelCapabilities.supportsVision`). Absent is the normal case and
   * means the element facts above are all there is to go on.
   */
  screenshot?: string;
  /**
   * Set only when the project was built with source tagging, which does
   * not exist yet. When present it is exact and outranks searching.
   */
  source?: SourceLocation;
}

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceLocation {
  path: string;
  line: number;
}
