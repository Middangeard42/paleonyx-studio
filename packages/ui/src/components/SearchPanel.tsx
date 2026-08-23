import { useState } from "react";
import { CaseSensitive, WholeWord } from "lucide-react";
import clsx from "clsx";
import type { SearchOptions, SearchResults } from "@paleonyx/shared-types";
import { Tooltip } from "../primitives/Tooltip.js";

export interface SearchPanelProps {
  onSearch: (options: SearchOptions) => void;
  results: SearchResults | null;
  searching: boolean;
  /** Jump to a match. Line is 1-based. */
  onOpenMatch: (path: string, line: number) => void;
  /** Adds the file to the agent's context, the usual reason for searching. */
  onAddToContext: (path: string) => void;
  contextFiles: readonly string[];
}

export function SearchPanel({
  onSearch,
  results,
  searching,
  onOpenMatch,
  onAddToContext,
  contextFiles,
}: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length === 0) return;
    onSearch({ query, caseSensitive, wholeWord });
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <form onSubmit={submit} className="flex flex-col gap-1.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search in project"
          className="rounded-md border border-border-subtle bg-surface-2 p-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <div className="flex items-center gap-1">
          <Toggle
            label="Match case"
            active={caseSensitive}
            onClick={() => setCaseSensitive((v) => !v)}
            icon={<CaseSensitive size={13} />}
          />
          <Toggle
            label="Whole word"
            active={wholeWord}
            onClick={() => setWholeWord((v) => !v)}
            icon={<WholeWord size={13} />}
          />
        </div>
      </form>

      <SearchResultsList
        results={results}
        searching={searching}
        query={query}
        onOpenMatch={onOpenMatch}
        onAddToContext={onAddToContext}
        contextFiles={contextFiles}
      />
    </div>
  );
}

function Toggle({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={clsx(
          "rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          active ? "bg-accent-muted text-accent" : "text-text-tertiary hover:text-text-primary"
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

function SearchResultsList({
  results,
  searching,
  query,
  onOpenMatch,
  onAddToContext,
  contextFiles,
}: {
  results: SearchResults | null;
  searching: boolean;
  query: string;
  onOpenMatch: (path: string, line: number) => void;
  onAddToContext: (path: string) => void;
  contextFiles: readonly string[];
}) {
  if (searching) {
    return <p className="text-xs text-text-tertiary">Searching…</p>;
  }
  if (!results) {
    return (
      <p className="text-xs text-text-tertiary">
        Search the project&apos;s files. Results respect this project&apos;s
        .gitignore, so build output and dependencies stay out of the way.
      </p>
    );
  }
  if (results.files.length === 0) {
    return (
      <p className="text-xs text-text-tertiary">
        No matches for &ldquo;{query}&rdquo;.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
      <p className="text-xs text-text-tertiary">
        {results.totalMatches} match{results.totalMatches === 1 ? "" : "es"} in{" "}
        {results.files.length} file{results.files.length === 1 ? "" : "s"}
        {results.truncated && " — showing the first of many"}
      </p>

      {results.files.map((file) => (
        <div key={file.path}>
          <div className="flex items-center justify-between gap-1">
            <span className="truncate font-mono text-xs text-text-secondary" title={file.path}>
              {file.path}
            </span>
            <button
              type="button"
              onClick={() => onAddToContext(file.path)}
              disabled={contextFiles.includes(file.path)}
              className="shrink-0 rounded px-1 text-xs text-text-tertiary hover:text-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              {contextFiles.includes(file.path) ? "In context" : "+ Context"}
            </button>
          </div>
          <ul>
            {file.matches.map((match, index) => (
              <li key={`${match.line}-${index}`}>
                <button
                  type="button"
                  onClick={() => onOpenMatch(file.path, match.line)}
                  className="flex w-full gap-2 rounded px-1 py-0.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  <span className="shrink-0 font-mono text-xs tabular-nums text-text-tertiary">
                    {match.line}
                  </span>
                  <span className="truncate font-mono text-xs text-text-secondary">
                    {match.text.slice(0, match.start)}
                    <mark className="bg-accent-muted text-accent">
                      {match.text.slice(match.start, match.end)}
                    </mark>
                    {match.text.slice(match.end)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
