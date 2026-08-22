import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import type { PermissionMode } from "@paleonyx/shared-types";
import { PERMISSION_MODE_DESCRIPTORS } from "@paleonyx/shared-types";
import { StatusBadge } from "../primitives/StatusBadge.js";
import type { StatusTone } from "../primitives/StatusBadge.js";
import { Tooltip } from "../primitives/Tooltip.js";
import { PermissionModePicker } from "./PermissionModePicker.js";

const TONE_BY_MODE: Record<PermissionMode, StatusTone> = {
  "read-only": "neutral",
  "suggest-only": "info",
  "auto-apply": "warning",
  "can-run-commands": "danger",
};

export interface PermissionIndicatorProps {
  mode: PermissionMode;
  /**
   * Omitted where the mode cannot be changed, which renders it as plain
   * text rather than a button that does nothing.
   */
  onChange?: (mode: PermissionMode) => void;
}

/**
 * Always-visible, status-bar-resident indicator, and the control for
 * changing the mode — one click away, as DESIGN.md §6.2 requires. This
 * is where "what is the AI allowed to do right now" lives permanently,
 * so it is also the obvious place to change it.
 */
export function PermissionIndicator({ mode, onChange }: PermissionIndicatorProps) {
  const [open, setOpen] = useState(false);
  const descriptor = PERMISSION_MODE_DESCRIPTORS.find((d) => d.mode === mode);
  const badge = (
    <StatusBadge tone={TONE_BY_MODE[mode]}>{descriptor?.label ?? mode}</StatusBadge>
  );

  if (!onChange) {
    return (
      <Tooltip label={descriptor?.description ?? mode}>
        <span>{badge}</span>
      </Tooltip>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Permission mode: ${descriptor?.label}. Change it.`}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {badge}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={6}
          className="z-overlay rounded-md border border-border-default bg-surface-3 shadow-lg"
        >
          <PermissionModePicker
            mode={mode}
            onChange={onChange}
            onDismiss={() => setOpen(false)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
