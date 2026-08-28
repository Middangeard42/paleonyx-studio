import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import type { BudgetLimits, BudgetUsage } from "@paleonyx/shared-types";
import { Button } from "../primitives/Button.js";

/**
 * Floors rather than arbitrary minimums. One tool call is enough to read
 * a single file and answer, and a task allowed fewer tokens than a
 * reply needs would pause before it ever started — which reads as the
 * app being broken rather than as a limit doing its job.
 */
const MIN_TOOL_CALLS = 1;
const MIN_TOKENS = 1000;

export interface BudgetControlProps {
  usage: BudgetUsage;
  limits: BudgetLimits;
  /**
   * Omitted where the limits cannot be changed, which renders them as
   * plain text rather than a button that does nothing.
   */
  onChange?: (limits: BudgetLimits) => void;
  /** Restores the built-in limits, so a bad edit is one click to undo. */
  defaults?: BudgetLimits;
}

/**
 * The budget, shown permanently and editable in place.
 *
 * Lives in the status bar next to the permission indicator because it
 * answers the neighbouring question: not "what may the agent do" but
 * "how much of it before it stops and asks". Both are limits the user
 * should be able to see without going looking, and change without
 * leaving what they were doing.
 */
export function BudgetControl({
  usage,
  limits,
  onChange,
  defaults,
}: BudgetControlProps) {
  const [open, setOpen] = useState(false);
  const exhausted =
    usage.toolCalls >= limits.maxToolCalls || usage.tokens >= limits.maxTokens;

  const summary = (
    <>
      Budget: {usage.toolCalls}/{limits.maxToolCalls} tool calls ·{" "}
      {usage.tokens}/{limits.maxTokens} tokens
    </>
  );

  if (!onChange) {
    return <span className={exhausted ? "text-status-danger" : undefined}>{summary}</span>;
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Budget limits. Change them."
          className={`rounded px-1 hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            exhausted ? "text-status-danger" : ""
          }`}
        >
          {summary}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          align="end"
          className="z-50 w-80 rounded-md border border-border-subtle bg-surface-1 p-3 shadow-lg"
        >
          <BudgetForm
            limits={limits}
            defaults={defaults}
            onSubmit={(next) => {
              onChange(next);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function BudgetForm({
  limits,
  defaults,
  onSubmit,
}: {
  limits: BudgetLimits;
  defaults?: BudgetLimits;
  onSubmit: (limits: BudgetLimits) => void;
}) {
  const [toolCalls, setToolCalls] = useState(String(limits.maxToolCalls));
  const [tokens, setTokens] = useState(String(limits.maxTokens));

  const parsed = parseLimits(toolCalls, tokens);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed.ok) onSubmit(parsed.limits);
      }}
    >
      <div>
        <p className="text-sm text-text-primary">How much work per task</p>
        <p className="mt-0.5 text-xs text-text-secondary">
          When either limit is reached the agent stops and hands back to you,
          rather than carrying on. Raise them for bigger jobs.
        </p>
      </div>

      <Field
        label="Steps it may take"
        hint="Files read and commands run. Higher means it can investigate further before answering."
        value={toolCalls}
        onChange={setToolCalls}
      />
      <Field
        label="Words it may use"
        hint="Counted in tokens, roughly ¾ of a word each. Higher costs more time, and money on a paid provider."
        value={tokens}
        onChange={setTokens}
      />

      {!parsed.ok && <p className="text-xs text-status-danger">{parsed.error}</p>}

      <div className="flex items-center justify-between gap-2">
        {defaults ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setToolCalls(String(defaults.maxToolCalls));
              setTokens(String(defaults.maxTokens));
            }}
          >
            Reset
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary" size="sm" disabled={!parsed.ok}>
          Save
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-primary">{label}</span>
      <input
        // Kept a text input on purpose: a number input silently accepts
        // "1e5" and reports an empty string for anything it dislikes,
        // which loses the distinction between "blank" and "invalid".
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-border-subtle bg-surface-2 px-2 py-1 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <span className="text-xs text-text-tertiary">{hint}</span>
    </label>
  );
}

export type ParsedLimits =
  | { ok: true; limits: BudgetLimits }
  | { ok: false; error: string };

/**
 * Validates the two fields together so the message names what is wrong.
 * Exported for tests: this is the only logic in the component, and it is
 * the part where a mistake means a task that can never start.
 */
export function parseLimits(toolCalls: string, tokens: string): ParsedLimits {
  const parsedToolCalls = parseCount(toolCalls);
  if (parsedToolCalls === null) {
    return { ok: false, error: "Steps must be a whole number." };
  }
  if (parsedToolCalls < MIN_TOOL_CALLS) {
    return { ok: false, error: `Give it at least ${MIN_TOOL_CALLS} step.` };
  }

  const parsedTokens = parseCount(tokens);
  if (parsedTokens === null) {
    return { ok: false, error: "Words must be a whole number." };
  }
  if (parsedTokens < MIN_TOKENS) {
    return {
      ok: false,
      error: `Below ${MIN_TOKENS} the agent stops before it can answer.`,
    };
  }

  return {
    ok: true,
    limits: { maxToolCalls: parsedToolCalls, maxTokens: parsedTokens },
  };
}

function parseCount(raw: string): number | null {
  const trimmed = raw.trim();
  // Digits only: Number() accepts "1e5", " 12 ", and "0x10", none of
  // which is a number the user meant to type into this field.
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}
