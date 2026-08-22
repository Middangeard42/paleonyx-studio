import { useState } from "react";
import type { FileDiff } from "@paleonyx/shared-types";
import clsx from "clsx";

export interface DiffViewProps {
  diffs: FileDiff[];
}

/**
 * Per-file expand/collapse, +/- summary up front — a large diff never
 * dumps as an unreadable wall of text (DESIGN.md §5.4). v0 is read-only
 * (no approve/reject-per-hunk yet — that lands with the vcs write path).
 */
export function DiffView({ diffs }: DiffViewProps) {
  if (diffs.length === 0) {
    return <p className="text-sm text-text-tertiary">No changes proposed.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {diffs.map((diff) => (
        <FileDiffBlock key={diff.filePath} diff={diff} />
      ))}
    </div>
  );
}

function FileDiffBlock({ diff }: { diff: FileDiff }) {
  const [expanded, setExpanded] = useState(true);
  const added = diff.hunks.flatMap((h) => h.lines).filter((l) => l.type === "add").length;
  const removed = diff.hunks.flatMap((h) => h.lines).filter((l) => l.type === "remove").length;

  return (
    <div className="rounded-md border border-border-subtle overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between bg-surface-2 px-3 py-1.5 text-left"
        aria-expanded={expanded}
      >
        <span className="font-mono text-xs text-text-primary">{diff.filePath}</span>
        <span className="flex items-center gap-2 text-xs tabular-nums">
          <span className="text-diff-add">+{added}</span>
          <span className="text-diff-remove">-{removed}</span>
        </span>
      </button>
      {expanded && (
        <div className="font-mono text-xs">
          {diff.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex}>
              <div className="bg-surface-1 px-3 py-0.5 text-text-tertiary">{hunk.header}</div>
              {hunk.lines.map((line, lineIndex) => (
                <div
                  key={lineIndex}
                  className={clsx(
                    "whitespace-pre px-3 py-0.5",
                    line.type === "add" && "bg-diff-add-bg text-diff-add",
                    line.type === "remove" && "bg-diff-remove-bg text-diff-remove",
                    line.type === "context" && "text-text-secondary"
                  )}
                >
                  {line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}
                  {line.content}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
