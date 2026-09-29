import { useState } from "react";
import { RotateCcw, Undo2 } from "lucide-react";
import clsx from "clsx";
import type { HistoryEntry } from "@paleonyx/shared-types";
import { Button } from "../primitives/Button.js";
import { StatusBadge } from "../primitives/StatusBadge.js";
import { DiffView } from "./DiffView.js";

export interface TimelineProps {
  entries: HistoryEntry[];
  onUndo: (entry: HistoryEntry) => void;
  /** Set while an undo is in flight, to disable repeat presses. */
  busyId?: string;
  /** Conflict text from a refused undo, keyed by change id. */
  conflictById?: Record<string, string>;
  /**
   * Why the history could not be read. Shown in place of "no changes yet":
   * a history that failed to load must not look like an empty one.
   */
  error?: string | null;
}

/**
 * The durable record of everything the agent has changed (DESIGN.md §6.2).
 * Distinct from the chat panel on purpose: this outlives any single
 * conversation turn, so a change stays reviewable and reversible long
 * after the exchange that produced it has scrolled away.
 */
export function Timeline({ entries, onUndo, busyId, conflictById, error }: TimelineProps) {
  const problem = error ? (
    <p
      role="alert"
      className="rounded border border-status-danger/40 bg-status-danger/10 p-2 text-xs text-text-secondary"
    >
      Couldn&apos;t read the change history. {error}
    </p>
  ) : null;

  if (entries.length === 0) {
    return (
      problem ?? (
        <p className="text-xs text-text-tertiary">
          No agent changes yet. Anything the agent applies shows up here, and can
          be undone from here.
        </p>
      )
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {problem}
      <ol className="flex flex-col gap-2">
        {entries.map((entry) => (
          <TimelineRow
            key={entry.record.id}
            entry={entry}
            onUndo={onUndo}
            busy={busyId === entry.record.id}
            conflict={conflictById?.[entry.record.id]}
          />
        ))}
      </ol>
    </div>
  );
}

function TimelineRow({
  entry,
  onUndo,
  busy,
  conflict,
}: {
  entry: HistoryEntry;
  onUndo: (entry: HistoryEntry) => void;
  busy: boolean;
  conflict?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isUndo = entry.record.revertsId !== undefined;
  const fileCount = new Set(entry.record.diffs.map((diff) => diff.filePath)).size;

  return (
    <li
      className={clsx(
        "rounded-md border p-2.5",
        entry.reverted
          ? "border-border-subtle bg-surface-1 opacity-70"
          : "border-border-subtle bg-surface-2"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {isUndo && <Undo2 size={12} className="shrink-0 text-text-tertiary" />}
            <span className="truncate text-sm text-text-primary">
              {entry.record.summary}
            </span>
            {entry.reverted && <StatusBadge tone="neutral">Undone</StatusBadge>}
          </div>
          <p className="mt-0.5 text-xs text-text-tertiary">
            {formatTimestamp(entry.record.timestamp)} · {fileCount} file
            {fileCount === 1 ? "" : "s"}
          </p>
        </div>

        {!entry.reverted && !isUndo && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onUndo(entry)}
          >
            <RotateCcw size={12} />
            {busy ? "Undoing…" : "Undo"}
          </Button>
        )}
      </div>

      {conflict && (
        <p className="mt-2 rounded border border-status-warning/40 bg-status-warning/10 p-2 text-xs text-text-secondary">
          {conflict}
        </p>
      )}

      {entry.record.diffs.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="mt-1.5 text-xs text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            {expanded ? "Hide changes" : "Show changes"}
          </button>
          {expanded && (
            <div className="mt-2">
              <DiffView diffs={entry.record.diffs} />
            </div>
          )}
        </>
      )}
    </li>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
