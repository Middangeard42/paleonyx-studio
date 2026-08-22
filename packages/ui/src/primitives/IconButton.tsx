import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";
import { Tooltip } from "./Tooltip.js";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  /** Required, not optional — DESIGN.md §7: icon-only controls always get an accessible name. */
  label: string;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, active, className, ...props }, ref) => {
    return (
      <Tooltip label={label}>
        <button
          ref={ref}
          aria-label={label}
          className={clsx(
            "inline-flex h-7 w-7 items-center justify-center rounded-md",
            "text-text-secondary hover:text-text-primary hover:bg-surface-2",
            "transition-colors duration-micro ease-paleonyx-out",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            active && "bg-surface-2 text-accent",
            className
          )}
          {...props}
        >
          {icon}
        </button>
      </Tooltip>
    );
  }
);
IconButton.displayName = "IconButton";
