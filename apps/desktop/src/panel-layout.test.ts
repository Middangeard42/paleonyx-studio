import { describe, expect, it } from "vitest";
import {
  AGENT_MIN_HEIGHT,
  HISTORY_MIN_HEIGHT,
  maxHistoryHeight,
} from "./panel-layout.js";

describe("maxHistoryHeight", () => {
  it("leaves the Agent panel its minimum in a tall column", () => {
    const column = 900;
    expect(column - maxHistoryHeight(column)).toBeGreaterThanOrEqual(AGENT_MIN_HEIGHT);
  });

  it("lets History grow as the window does", () => {
    expect(maxHistoryHeight(1200)).toBeGreaterThan(maxHistoryHeight(700));
  });

  // The window has a minimum height, but the column can still be shorter
  // than both minimums together (a tall notice above the Agent panel, say).
  // History keeps its minimum and the Agent panel scrolls.
  it("never goes below History's own minimum", () => {
    expect(maxHistoryHeight(120)).toBe(HISTORY_MIN_HEIGHT);
    expect(maxHistoryHeight(1)).toBe(HISTORY_MIN_HEIGHT);
  });

  // Before the column has been measured its height is 0, which must not
  // mean a maximum so small that the stored size is thrown away.
  it("has a usable maximum before the column is measured", () => {
    expect(maxHistoryHeight(0)).toBeGreaterThan(HISTORY_MIN_HEIGHT);
    expect(maxHistoryHeight(Number.NaN)).toBeGreaterThan(HISTORY_MIN_HEIGHT);
  });
});
