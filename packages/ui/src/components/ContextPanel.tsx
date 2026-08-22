import { FileText, X } from "lucide-react";
import { Button } from "../primitives/Button.js";
import { IconButton } from "../primitives/IconButton.js";

export interface ContextPanelProps {
  files: string[];
  onRemove: (path: string) => void;
  onAdd: () => void;
}

/**
 * Explicit, inspectable list of what the agent can currently see
 * (DESIGN.md §6) — v0 scopes this to files only (docs/rules context
 * sources are a v1 addition); nothing is ever added here implicitly.
 */
export function ContextPanel({ files, onRemove, onAdd }: ContextPanelProps) {
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
    </div>
  );
}
