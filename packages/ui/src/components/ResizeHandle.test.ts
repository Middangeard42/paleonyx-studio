import { describe, expect, it } from "vitest";
import { clampWidth } from "./ResizeHandle.js";

/**
 * Bounds move when the window does. A width stored while the window was
 * wide must not leave a panel larger than the space it now sits in,
 * because the handle would be off-screen and the panel unrecoverable.
 */
describe("clampWidth", () => {
  it("keeps a width that already fits", () => {
    expect(clampWidth(300, 180, 600)).toBe(300);
  });

  it("pulls an oversized width back to the maximum", () => {
    expect(clampWidth(900, 180, 600)).toBe(600);
  });

  it("pushes an undersized width up to the minimum", () => {
    expect(clampWidth(20, 180, 600)).toBe(180);
  });

  it("accepts the bounds themselves", () => {
    expect(clampWidth(180, 180, 600)).toBe(180);
    expect(clampWidth(600, 180, 600)).toBe(600);
  });

  // A corrupt stored preference should not produce a NaN-wide panel,
  // which renders as zero and cannot be grabbed.
  it("falls back to the minimum for a value that is not a number", () => {
    expect(clampWidth(Number.NaN, 180, 600)).toBe(180);
    expect(clampWidth(Number.POSITIVE_INFINITY, 180, 600)).toBe(180);
  });

  // A window narrower than the minimum inverts the bounds; the result
  // still has to be finite and non-negative rather than nonsense.
  it("survives a maximum below the minimum", () => {
    expect(clampWidth(300, 180, 100)).toBe(100);
  });
});
