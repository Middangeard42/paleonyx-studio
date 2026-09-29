import { useRef } from "react";

/**
 * The divider between two panels, draggable to resize them.
 *
 * Two orientations. A `vertical` divider is a vertical line between panels
 * side by side, and changes a width. A `horizontal` one is a horizontal
 * line between panels stacked, and changes a height. The value it works
 * with is called `size` in both cases.
 *
 * Pointer capture rather than window listeners: the pointer keeps
 * reporting to this element even when it leaves it, which is what makes
 * a fast drag not lose the handle. Without it, dragging quickly past
 * the editor drops the grab and the panel stops following the mouse.
 *
 * Keyboard-operable too. A resize is a real setting, and a mouse-only
 * control would put the layout out of reach for anyone not using one —
 * arrow keys nudge, Home and End go to the extremes.
 */
export interface ResizeHandleProps {
  /** Describes what is being resized, for screen readers. */
  label: string;
  /** The panel's current width (vertical divider) or height (horizontal). */
  size: number;
  onSizeChange: (size: number) => void;
  min: number;
  max: number;
  /**
   * `vertical` (the default) divides panels side by side and resizes a
   * width; `horizontal` divides panels stacked and resizes a height.
   */
  orientation?: Orientation;
  /**
   * True when the handle sits on the panel's leading edge (its left, or
   * its top), so dragging toward the panel makes it smaller rather than
   * larger.
   */
  invert?: boolean;
  /** How far one arrow-key press moves it. */
  step?: number;
}

export type Orientation = "vertical" | "horizontal";

export function ResizeHandle({
  label,
  size,
  onSizeChange,
  min,
  max,
  orientation = "vertical",
  invert = false,
  step = 16,
}: ResizeHandleProps) {
  const drag = useRef<{ start: number; startSize: number } | null>(null);
  const horizontal = orientation === "horizontal";
  const position = (event: { clientX: number; clientY: number }) =>
    horizontal ? event.clientY : event.clientX;

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(size)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(event) => {
        // Only a primary-button drag; a right-click here should not
        // start resizing.
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { start: position(event), startSize: size };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onSizeChange(
          resizedSize({
            startSize: drag.current.startSize,
            delta: position(event) - drag.current.start,
            invert,
            min,
            max,
          })
        );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const next = keyboardResize({
          key: event.key,
          orientation,
          size,
          step,
          invert,
          min,
          max,
        });
        if (next === null) return;
        event.preventDefault();
        onSizeChange(next);
      }}
      // Two pixels of divider, eight of grab area: a hairline is correct
      // visually and miserable to hit.
      className={
        horizontal
          ? "group relative h-0.5 w-full shrink-0 cursor-row-resize bg-border-subtle transition-colors duration-micro hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          : "group relative w-0.5 shrink-0 cursor-col-resize bg-border-subtle transition-colors duration-micro hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      }
    >
      <span
        className={horizontal ? "absolute inset-x-0 -bottom-1 -top-1" : "absolute inset-y-0 -left-1 -right-1"}
        aria-hidden
      />
    </div>
  );
}

/**
 * Keeps a size inside its bounds.
 *
 * Exported because the bounds move: a window small enough that the stored
 * size no longer fits would otherwise leave a panel larger than the space
 * it sits in, with no way to drag it back.
 */
export function clampSize(size: number, min: number, max: number): number {
  if (!Number.isFinite(size)) return min;
  return Math.min(max, Math.max(min, size));
}

/**
 * The size a drag has produced: where it started, moved by how far the
 * pointer has travelled, kept inside the bounds.
 */
export function resizedSize({
  startSize,
  delta,
  invert,
  min,
  max,
}: {
  startSize: number;
  delta: number;
  invert: boolean;
  min: number;
  max: number;
}): number {
  return clampSize(startSize + (invert ? -delta : delta), min, max);
}

/**
 * The size a key press asks for, or `null` when the key means nothing to
 * this divider. The arrow moves the divider itself, so on the top edge of a
 * bottom panel (`invert`) the up arrow makes that panel taller.
 */
export function keyboardResize({
  key,
  orientation,
  size,
  step,
  invert,
  min,
  max,
}: {
  key: string;
  orientation: Orientation;
  size: number;
  step: number;
  invert: boolean;
  min: number;
  max: number;
}): number | null {
  const [back, forward] =
    orientation === "horizontal" ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
  const direction = key === back ? -1 : key === forward ? 1 : 0;
  if (direction !== 0) return clampSize(size + direction * step * (invert ? -1 : 1), min, max);
  if (key === "Home") return min;
  if (key === "End") return max;
  return null;
}
