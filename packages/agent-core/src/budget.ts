import type { BudgetLimits, BudgetUsage } from "@paleonyx/shared-types";

export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  maxToolCalls: 8,
  maxTokens: 20000,
};

/**
 * Budgets are a hard stop enforced here, not just displayed in the UI
 * (CLAUDE.md §6). run-task.ts checks isExhausted() before every tool call
 * and after every model response, and escalates rather than continuing
 * once it trips.
 */
export class BudgetTracker {
  private usage: BudgetUsage = { toolCalls: 0, tokens: 0 };

  constructor(private readonly limits: BudgetLimits) {}

  get current(): BudgetUsage {
    return { ...this.usage };
  }

  recordToolCall(): void {
    this.usage.toolCalls += 1;
  }

  recordTokens(count: number): void {
    this.usage.tokens += count;
  }

  isExhausted(): boolean {
    return (
      this.usage.toolCalls >= this.limits.maxToolCalls ||
      this.usage.tokens >= this.limits.maxTokens
    );
  }
}
