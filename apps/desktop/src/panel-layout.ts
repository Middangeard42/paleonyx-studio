/**
 * Limits for the right-hand column, where the Agent panel sits above the
 * History panel with a divider between them.
 *
 * History has the size that is stored; Agent takes whatever is left. So the
 * only thing to bound is how tall History may get: never so tall that the
 * Agent panel above it is squeezed out, whatever the window's height.
 */

/** Enough for the panel's title and one entry in it. */
export const HISTORY_MIN_HEIGHT = 120;
/** What the Agent panel is always left with, so it stays usable. */
export const AGENT_MIN_HEIGHT = 240;
export const HISTORY_DEFAULT_HEIGHT = 220;

/** The divider between the two, which is not part of either. */
const DIVIDER_HEIGHT = 2;

/** Used until the column has been measured. */
const UNMEASURED_MAX = 480;

/**
 * The tallest History may be in a column `columnHeight` pixels high. Never
 * below the minimum: a window too short for both minimums keeps History at
 * its minimum and lets the Agent panel scroll.
 */
export function maxHistoryHeight(columnHeight: number): number {
  if (!Number.isFinite(columnHeight) || columnHeight <= 0) return UNMEASURED_MAX;
  return Math.max(HISTORY_MIN_HEIGHT, columnHeight - AGENT_MIN_HEIGHT - DIVIDER_HEIGHT);
}
