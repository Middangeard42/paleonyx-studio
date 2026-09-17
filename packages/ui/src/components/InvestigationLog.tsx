import { useState } from "react";
import { FileText, Plug, Terminal, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import type { AgentInvestigationStep } from "@paleonyx/shared-types";

export interface InvestigationLogProps {
  steps: readonly AgentInvestigationStep[];
}

/**
 * What the agent did before answering — files it read, commands it ran,
 * what they returned.
 *
 * CLAUDE.md §7 asks that the user be able to see *why* the agent did
 * what it did, not only what it did. A conclusion drawn from a failing
 * test reads very differently once you can see the test output it was
 * drawn from.
 *
 * Collapsed by default: this is evidence to consult, not the answer.
 */
export function InvestigationLog({ steps }: InvestigationLogProps) {
  if (steps.length === 0) return null;

  return (
    <section>
      <h3 className="mb-1.5 text-xs font-medium text-text-tertiary">
        What the agent checked
      </h3>
      <ol className="flex flex-col gap-1">
        {steps.map((step, index) => (
          <StepRow key={index} step={step} />
        ))}
      </ol>
    </section>
  );
}

function StepRow({ step }: { step: AgentInvestigationStep }) {
  const [expanded, setExpanded] = useState(false);
  const isCommand = step.tool === "runCommand";
  const isConnected = step.tool.startsWith("mcp__");

  return (
    <li className="rounded border border-border-subtle bg-surface-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        {!step.ok ? (
          <TriangleAlert size={12} className="shrink-0 text-status-warning" />
        ) : isCommand ? (
          <Terminal size={12} className="shrink-0 text-text-tertiary" />
        ) : isConnected ? (
          <Plug size={12} className="shrink-0 text-text-tertiary" />
        ) : (
          <FileText size={12} className="shrink-0 text-text-tertiary" />
        )}
        <span
          className={clsx(
            "truncate text-xs",
            step.ok ? "text-text-secondary" : "text-text-primary"
          )}
        >
          {step.summary}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border-subtle">
          {step.input !== undefined && (
            <>
              <p className="px-2 pt-1.5 text-xs text-text-tertiary">Sent</p>
              <pre className="max-h-40 overflow-auto px-2 py-1 font-mono text-xs text-text-secondary whitespace-pre-wrap">
                {step.input}
              </pre>
              <p className="px-2 pt-1 text-xs text-text-tertiary">Returned</p>
            </>
          )}
          <pre className="max-h-64 overflow-auto px-2 py-1.5 font-mono text-xs text-text-secondary whitespace-pre-wrap">
            {step.detail}
          </pre>
        </div>
      )}
    </li>
  );
}
