import type { BudgetLimits, BudgetUsage, PermissionMode } from "@paleonyx/shared-types";
import { Cpu, FolderTree } from "lucide-react";
import { PermissionIndicator } from "./PermissionIndicator.js";

export interface StatusBarProps {
  modelLabel: string;
  permissionMode: PermissionMode;
  budgetUsage: BudgetUsage;
  budgetLimits: BudgetLimits;
  indexedFileCount: number;
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
}: StatusBarProps) {
  const budgetExhausted =
    budgetUsage.toolCalls >= budgetLimits.maxToolCalls || budgetUsage.tokens >= budgetLimits.maxTokens;

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
      </div>
      <div className="flex items-center gap-3">
        <span className={budgetExhausted ? "text-status-danger" : undefined}>
          Budget: {budgetUsage.toolCalls}/{budgetLimits.maxToolCalls} tool calls ·{" "}
          {budgetUsage.tokens}/{budgetLimits.maxTokens} tokens
        </span>
        <PermissionIndicator mode={permissionMode} />
      </div>
    </footer>
  );
}
