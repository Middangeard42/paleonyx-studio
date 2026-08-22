import type { PermissionMode } from "@paleonyx/shared-types";
import { PERMISSION_MODE_DESCRIPTORS } from "@paleonyx/shared-types";
import { StatusBadge } from "../primitives/StatusBadge.js";
import type { StatusTone } from "../primitives/StatusBadge.js";
import { Tooltip } from "../primitives/Tooltip.js";

const TONE_BY_MODE: Record<PermissionMode, StatusTone> = {
  "read-only": "neutral",
  "suggest-only": "info",
  "auto-apply": "warning",
  "can-run-commands": "danger",
};

export interface PermissionIndicatorProps {
  mode: PermissionMode;
}

/**
 * Always-visible, status-bar-resident indicator (DESIGN.md §6). v0 is
 * display-only — mode switching UI (with the required plain-language
 * consequence confirmation) is a v1 concern, since suggest-only is the
 * only mode a v0 session actually runs in.
 */
export function PermissionIndicator({ mode }: PermissionIndicatorProps) {
  const descriptor = PERMISSION_MODE_DESCRIPTORS.find((d) => d.mode === mode);
  return (
    <Tooltip label={descriptor?.description ?? mode}>
      <span>
        <StatusBadge tone={TONE_BY_MODE[mode]}>{descriptor?.label ?? mode}</StatusBadge>
      </span>
    </Tooltip>
  );
}
