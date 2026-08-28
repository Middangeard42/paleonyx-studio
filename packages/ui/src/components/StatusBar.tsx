import type { BudgetLimits, BudgetUsage, PermissionMode } from "@paleonyx/shared-types";
import { Cpu, FolderTree } from "lucide-react";
import { PermissionIndicator } from "./PermissionIndicator.js";
import { BudgetControl } from "./BudgetControl.js";

export interface StatusBarProps {
  modelLabel: string;
  permissionMode: PermissionMode;
  budgetUsage: BudgetUsage;
  budgetLimits: BudgetLimits;
  indexedFileCount: number;
  /**
   * Unsaved files. The tab dot is the conventional signal, but it means
   * nothing to someone who has never used an editor with one — naming
   * the shortcut here is the cheapest way to make saving discoverable
   * without a tutorial (DESIGN.md §1.4).
   */
  unsavedCount?: number;
  /** Omitted where the mode is fixed, e.g. the web harness. */
  onPermissionModeChange?: (mode: PermissionMode) => void;
  /** Omitted where the limits are fixed, which renders them as text. */
  onBudgetLimitsChange?: (limits: BudgetLimits) => void;
  defaultBudgetLimits?: BudgetLimits;
}

/**
 * Always-visible system state (DESIGN.md §3.1) — this is where "what is
 * the AI allowed to do right now" lives permanently, not buried in
 * Settings.
 */
export function StatusBar({
  modelLabel,
  permissionMode,
  budgetUsage,
  budgetLimits,
  indexedFileCount,
  unsavedCount = 0,
  onPermissionModeChange,
  onBudgetLimitsChange,
  defaultBudgetLimits,
}: StatusBarProps) {
  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border-subtle bg-surface-1 px-3 text-xs text-text-secondary">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Cpu size={12} className="text-text-tertiary" />
          {modelLabel}
        </span>
        <span className="flex items-center gap-1">
          <FolderTree size={12} className="text-text-tertiary" />
          {indexedFileCount} files indexed
        </span>
        {unsavedCount > 0 && (
          <span className="flex items-center gap-1 text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            {unsavedCount} unsaved · Ctrl+S to save
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <BudgetControl
          usage={budgetUsage}
          limits={budgetLimits}
          onChange={onBudgetLimitsChange}
          defaults={defaultBudgetLimits}
        />
        <PermissionIndicator mode={permissionMode} onChange={onPermissionModeChange} />
      </div>
    </footer>
  );
}
