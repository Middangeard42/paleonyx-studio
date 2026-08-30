import { useCallback, useRef } from "react";

/**
 * The divider between two panels, draggable to resize them.
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
  width: number;
  onWidthChange: (width: number) => void;
  min: number;
  max: number;
  /**
   * True when the handle sits on the panel's leading edge, so dragging
   * right makes the panel narrower rather than wider.
   */
  invert?: boolean;
  /** How far one arrow-key press moves it. */
  step?: number;
}

export function ResizeHandle({
  label,
  width,
  onWidthChange,
  min,
  max,
  invert = false,
  step = 16,
}: ResizeHandleProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const clamp = useCallback(
    (value: number) => Math.min(max, Math.max(min, value)),
    [min, max]
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(event) => {
        // Only a primary-button drag; a right-click here should not
        // start resizing.
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startX: event.clientX, startWidth: width };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const delta = event.clientX - drag.current.startX;
        onWidthChange(
          clamp(drag.current.startWidth + (invert ? -delta : delta))
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
        const direction =
          event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
        if (direction !== 0) {
          event.preventDefault();
          onWidthChange(clamp(width + direction * step * (invert ? -1 : 1)));
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          onWidthChange(min);
        } else if (event.key === "End") {
          event.preventDefault();
          onWidthChange(max);
        }
      }}
      // Two pixels of divider, eight of grab area: a hairline is correct
      // visually and miserable to hit.
      className="group relative w-0.5 shrink-0 cursor-col-resize bg-border-subtle transition-colors duration-micro hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <span className="absolute inset-y-0 -left-1 -right-1" aria-hidden />
    </div>
  );
}

/**
 * Keeps a width inside its bounds.
 *
 * Exported because the bounds move: a window narrow enough that the
 * stored width no longer fits would otherwise leave a panel wider than
 * the space it sits in, with no way to drag it back.
 */
export function clampWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min;
  return Math.min(max, Math.max(min, width));
}
