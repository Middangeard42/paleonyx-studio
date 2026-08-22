import type { ReactNode } from "react";
import clsx from "clsx";

export type StatusTone = "info" | "success" | "warning" | "danger" | "neutral";

export interface StatusBadgeProps {
  tone: StatusTone;
  icon?: ReactNode;
  children: ReactNode;
}

const TONE_CLASSES: Record<StatusTone, string> = {
  info: "text-status-info bg-status-info/10 border-status-info/30",
  success: "text-status-success bg-status-success/10 border-status-success/30",
  warning: "text-status-warning bg-status-warning/10 border-status-warning/30",
  danger: "text-status-danger bg-status-danger/10 border-status-danger/30",
  neutral: "text-text-secondary bg-surface-2 border-border-default",
};

/**
 * Status color is always paired with an icon and/or text (DESIGN.md §7)
 * — color is never the sole signal, so callers are expected to pass a
 * label, not rely on tone alone.
 */
export function StatusBadge({ tone, icon, children }: StatusBadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone]
      )}
    >
      {icon}
      {children}
    </span>
  );
}
