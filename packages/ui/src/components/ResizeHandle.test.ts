import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResizeHandle, clampSize, keyboardResize, resizedSize } from "./ResizeHandle.js";

/**
 * Bounds move when the window does. A width stored while the window was
 * wide must not leave a panel larger than the space it now sits in,
 * because the handle would be off-screen and the panel unrecoverable.
 */
describe("clampSize", () => {
  it("keeps a width that already fits", () => {
    expect(clampSize(300, 180, 600)).toBe(300);
  });

  it("pulls an oversized width back to the maximum", () => {
    expect(clampSize(900, 180, 600)).toBe(600);
  });

  it("pushes an undersized width up to the minimum", () => {
    expect(clampSize(20, 180, 600)).toBe(180);
  });

  it("accepts the bounds themselves", () => {
    expect(clampSize(180, 180, 600)).toBe(180);
    expect(clampSize(600, 180, 600)).toBe(600);
  });

  // A corrupt stored preference should not produce a NaN-wide panel,
  // which renders as zero and cannot be grabbed.
  it("falls back to the minimum for a value that is not a number", () => {
    expect(clampSize(Number.NaN, 180, 600)).toBe(180);
    expect(clampSize(Number.POSITIVE_INFINITY, 180, 600)).toBe(180);
  });

  // A window narrower than the minimum inverts the bounds; the result
  // still has to be finite and non-negative rather than nonsense.
  it("survives a maximum below the minimum", () => {
    expect(clampSize(300, 180, 100)).toBe(100);
  });
});

describe("resizedSize", () => {
  const bounds = { min: 100, max: 500 };

  it("grows when dragged toward larger, and shrinks the other way", () => {
    expect(resizedSize({ startSize: 200, delta: 50, invert: false, ...bounds })).toBe(250);
    expect(resizedSize({ startSize: 200, delta: -50, invert: false, ...bounds })).toBe(150);
  });

  // A handle on a panel's leading edge (the top of a bottom panel, the left
  // of a right-hand one) works the other way round: dragging it toward the
  // panel makes the panel smaller.
  it("reverses for a handle on the leading edge", () => {
    expect(resizedSize({ startSize: 200, delta: 50, invert: true, ...bounds })).toBe(150);
    expect(resizedSize({ startSize: 200, delta: -50, invert: true, ...bounds })).toBe(250);
  });

  it("stays inside the bounds however far it is dragged", () => {
    expect(resizedSize({ startSize: 200, delta: 9999, invert: false, ...bounds })).toBe(500);
    expect(resizedSize({ startSize: 200, delta: -9999, invert: false, ...bounds })).toBe(100);
  });
});

describe("keyboardResize", () => {
  const base = { size: 200, step: 16, invert: false, min: 100, max: 500 };

  it("moves a vertical divider with the left and right arrows only", () => {
    expect(keyboardResize({ ...base, key: "ArrowRight", orientation: "vertical" })).toBe(216);
    expect(keyboardResize({ ...base, key: "ArrowLeft", orientation: "vertical" })).toBe(184);
    expect(keyboardResize({ ...base, key: "ArrowUp", orientation: "vertical" })).toBeNull();
  });

  // The new case: a divider that resizes height answers to up and down.
  it("moves a horizontal divider with the up and down arrows only", () => {
    expect(keyboardResize({ ...base, key: "ArrowDown", orientation: "horizontal" })).toBe(216);
    expect(keyboardResize({ ...base, key: "ArrowUp", orientation: "horizontal" })).toBe(184);
    expect(keyboardResize({ ...base, key: "ArrowLeft", orientation: "horizontal" })).toBeNull();
  });

  // The arrow moves the divider. On the top edge of a bottom panel, moving
  // it up makes that panel taller.
  it("makes a leading-edge panel bigger when the divider moves toward its far side", () => {
    expect(
      keyboardResize({ ...base, invert: true, key: "ArrowUp", orientation: "horizontal" })
    ).toBe(216);
    expect(
      keyboardResize({ ...base, invert: true, key: "ArrowDown", orientation: "horizontal" })
    ).toBe(184);
  });

  it("goes to the extremes with Home and End, and ignores other keys", () => {
    expect(keyboardResize({ ...base, key: "Home", orientation: "horizontal" })).toBe(100);
    expect(keyboardResize({ ...base, key: "End", orientation: "horizontal" })).toBe(500);
    expect(keyboardResize({ ...base, key: "a", orientation: "horizontal" })).toBeNull();
  });

  it("does not step past the bounds", () => {
    expect(
      keyboardResize({ ...base, size: 498, key: "ArrowDown", orientation: "horizontal" })
    ).toBe(500);
  });
});

describe("ResizeHandle", () => {
  const props = { label: "Resize the history panel", size: 220, onSizeChange: () => {}, min: 96, max: 600 };

  it("is a vertical divider by default, for panels side by side", () => {
    const html = renderToStaticMarkup(createElement(ResizeHandle, props));
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain("cursor-col-resize");
  });

  it("is a horizontal divider for panels stacked, with its own cursor", () => {
    const html = renderToStaticMarkup(
      createElement(ResizeHandle, { ...props, orientation: "horizontal" })
    );
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).toContain("cursor-row-resize");
    expect(html).not.toContain("cursor-col-resize");
    expect(html).toContain('aria-valuenow="220"');
    expect(html).toContain('aria-label="Resize the history panel"');
  });
});
