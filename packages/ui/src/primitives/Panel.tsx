import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  actions?: ReactNode;
  padded?: boolean;
}

/**
 * The generic elevated container used throughout the shell (file tree,
 * agent panel, diff panel). Elevation is a surface-step + hairline
 * border, not a shadow (DESIGN.md §2.4).
 */
export function Panel({ title, actions, padded = true, className, children, ...props }: PanelProps) {
  return (
    <div
      className={clsx(
        "flex h-full flex-col bg-surface-1 border border-border-subtle rounded-md overflow-hidden",
        className
      )}
      {...props}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-border-subtle px-3 h-8 shrink-0">
          {title && (
            <h2 className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
              {title}
            </h2>
          )}
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </div>
      )}
      <div className={clsx("flex-1 min-h-0 overflow-auto", padded && "p-3")}>{children}</div>
    </div>
  );
}
