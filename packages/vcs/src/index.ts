export { applyFileDiff, revertFileDiff, applyChange, isCreation } from "./apply.js";
export type { Conflict, ConflictReason, PatchResult, MultiFileResult } from "./apply.js";
export { detectLineEnding, splitLines, joinLines } from "./line-endings.js";
export type { LineEnding } from "./line-endings.js";
export { linesBeforeApply, linesAfterApply, parseHunkStartLine, locate } from "./hunk.js";
export type { LocateResult } from "./hunk.js";
export { parseChangeRecord, buildHistory } from "./history.js";
export { applyAgentChange, revertAgentChange, loadHistory } from "./change-store.js";
export type { ChangeStore, ChangeOutcome } from "./change-store.js";
