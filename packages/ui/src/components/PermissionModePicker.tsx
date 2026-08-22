import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import clsx from "clsx";
import type { PermissionMode } from "@paleonyx/shared-types";
import {
  PERMISSION_MODE_DESCRIPTORS,
  PERMISSION_MODE_ORDER,
  SELECTABLE_PERMISSION_MODES,
  isMorePermissive,
} from "@paleonyx/shared-types";
import { Button } from "../primitives/Button.js";

export interface PermissionModePickerProps {
  mode: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  onDismiss: () => void;
}

/**
 * Consequences of raising the mode, in plain language.
 *
 * Written as what will now happen without asking, not as a feature
 * description — someone turning this on should be able to picture the
 * change in behaviour before they confirm it (DESIGN.md §6.2).
 */
const RAISE_CONSEQUENCE: Partial<Record<PermissionMode, string>> = {
  "suggest-only":
    "The agent will be able to propose edits to your files. Nothing is written until you approve each change.",
  "auto-apply":
    "The agent will write changes to your files without asking first. Every change is still recorded and can be undone from History, but you will be reviewing them after the fact rather than before.",
  "can-run-commands":
    "The agent will additionally be able to run allowlisted commands, such as tests and linters.",
};

export function PermissionModePicker({
  mode,
  onChange,
  onDismiss,
}: PermissionModePickerProps) {
  const [pendingRaise, setPendingRaise] = useState<PermissionMode | null>(null);

  function select(next: PermissionMode) {
    if (next === mode) return onDismiss();
    // Narrowing takes effect immediately: restricting the agent further
    // is never something to talk the user out of. Only widening asks.
    if (isMorePermissive(mode, next)) {
      setPendingRaise(next);
      return;
    }
    onChange(next);
    onDismiss();
  }

  if (pendingRaise) {
    const descriptor = PERMISSION_MODE_DESCRIPTORS.find((d) => d.mode === pendingRaise);
    return (
      <div className="w-80 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-status-warning" />
          <div>
            <p className="text-sm font-medium text-text-primary">
              Switch to {descriptor?.label}?
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              {RAISE_CONSEQUENCE[pendingRaise]}
            </p>
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setPendingRaise(null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              onChange(pendingRaise);
              setPendingRaise(null);
              onDismiss();
            }}
          >
            Switch
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 p-1.5" role="radiogroup" aria-label="Permission mode">
      {PERMISSION_MODE_ORDER.map((candidate) => {
        const descriptor = PERMISSION_MODE_DESCRIPTORS.find((d) => d.mode === candidate);
        const selectable = SELECTABLE_PERMISSION_MODES.includes(candidate);
        const active = candidate === mode;
        return (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={!selectable}
            onClick={() => select(candidate)}
            className={clsx(
              "flex w-full items-start gap-2 rounded-md p-2 text-left",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              selectable ? "hover:bg-surface-2" : "cursor-not-allowed opacity-50"
            )}
          >
            <span className="mt-0.5 w-3.5 shrink-0">
              {active && <Check size={13} className="text-accent" />}
            </span>
            <span>
              <span className="block text-sm text-text-primary">{descriptor?.label}</span>
              <span className="mt-0.5 block text-xs text-text-secondary">
                {selectable
                  ? descriptor?.description
                  : "Not available yet — the agent has no command-running tool."}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
