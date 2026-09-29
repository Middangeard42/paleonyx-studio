import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ModelReply } from "@paleonyx/shared-types";

export interface RunDetailsProps {
  replies: readonly ModelReply[];
}

/**
 * What the model actually sent back, word for word, with how long it was.
 *
 * Collapsed by default: it is evidence to consult when a result looks
 * wrong or a run failed, not part of the answer. Without it a failure
 * reads as "could not parse", with no way to tell a model that wrote the
 * wrong format from one that was cut off.
 */
export function RunDetails({ replies }: RunDetailsProps) {
  const [expanded, setExpanded] = useState(false);
  if (replies.length === 0) return null;

  const summary = replies.length === 1 ? "1 reply" : `${replies.length} replies`;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <section>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex items-center gap-1 text-xs font-medium text-text-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <Chevron size={12} aria-hidden />
        Details
        <span className="font-normal">({summary} from the model)</span>
      </button>
      {expanded && (
        <ol className="mt-1.5 flex flex-col gap-1.5">
          {replies.map((reply, index) => (
            <li key={index} className="rounded border border-border-subtle bg-surface-2">
              <p className="px-2 pt-1.5 text-xs text-text-tertiary">
                {reply.label}
                {" · "}
                {describeSize(reply)}
                {reply.finishReason === "length" && " · cut off at the length limit"}
              </p>
              <pre className="max-h-64 overflow-auto px-2 py-1.5 font-mono text-xs text-text-secondary whitespace-pre-wrap">
                {reply.content === "" ? "(empty reply)" : reply.content}
              </pre>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function describeSize(reply: ModelReply): string {
  const parts = [`${reply.content.length.toLocaleString("en-US")} characters`];
  if (reply.completionTokens !== undefined) {
    parts.push(`${reply.completionTokens.toLocaleString("en-US")} tokens written`);
  }
  if (reply.promptTokens !== undefined) {
    parts.push(`${reply.promptTokens.toLocaleString("en-US")} tokens read`);
  }
  return parts.join(", ");
}
