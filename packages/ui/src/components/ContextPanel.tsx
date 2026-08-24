import { FileText, X } from "lucide-react";
import { Button } from "../primitives/Button.js";
import { IconButton } from "../primitives/IconButton.js";

export interface ProjectDocSummary {
  path: string;
  truncated: boolean;
}

export interface ContextPanelProps {
  files: string[];
  onRemove: (path: string) => void;
  onAdd: () => void;
  /**
   * The project's own convention files, found automatically.
   *
   * Shown separately from the files the user chose, because they got
   * here by a different route: nothing the agent can see should be
   * invisible on this panel just because the app added it rather than
   * the user (DESIGN.md §6).
   */
  projectDocs?: readonly ProjectDocSummary[];
  docsEnabled?: boolean;
  onDocsEnabledChange?: (enabled: boolean) => void;
}

/**
 * Explicit, inspectable list of what the agent can currently see
 * (DESIGN.md §6) — v0 scopes this to files only (docs/rules context
 * sources are a v1 addition); nothing is ever added here implicitly.
 */
export function ContextPanel({
  files,
  onRemove,
  onAdd,
  projectDocs = [],
  docsEnabled = true,
  onDocsEnabledChange,
}: ContextPanelProps) {
  return (
    <div className="flex flex-col gap-2">
      {files.length === 0 && (
        <p className="text-xs text-text-tertiary">
          No files in context yet — add one so the agent has something to read.
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {files.map((path) => (
          <li
            key={path}
            className="flex items-center justify-between gap-2 rounded bg-surface-2 px-2 py-1 text-xs"
          >
            <span className="flex items-center gap-1.5 font-mono text-text-primary truncate">
              <FileText size={12} className="shrink-0 text-text-tertiary" />
              {path}
            </span>
            <IconButton
              icon={<X size={12} />}
              label={`Remove ${path} from context`}
              onClick={() => onRemove(path)}
            />
          </li>
        ))}
      </ul>
      <Button size="sm" variant="secondary" onClick={onAdd} className="self-start">
        + Add file
      </Button>

      {projectDocs.length > 0 && (
        <div className="mt-1 border-t border-border-subtle pt-2">
          <label className="flex items-start gap-1.5 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={docsEnabled}
              onChange={(event) => onDocsEnabledChange?.(event.target.checked)}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              Follow this project&apos;s conventions
              <span className="mt-0.5 block text-text-tertiary">
                {projectDocs.map((doc) => doc.path).join(", ")}
                {projectDocs.some((doc) => doc.truncated) && " (shortened to fit)"}
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
