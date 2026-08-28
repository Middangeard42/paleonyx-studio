import { useMemo, useState } from "react";
import { Check, ChevronDown, Download, RefreshCw, Trash2, X } from "lucide-react";
import clsx from "clsx";
import type {
  HardwareFit,
  ModelCatalog,
  ModelCatalogEntry,
  ModelPullProgress,
  SystemProfile,
} from "@paleonyx/shared-types";
import { formatBytes } from "@paleonyx/shared-types";
import { assessFit } from "@paleonyx/system-profile";
import { StatusBadge } from "../primitives/StatusBadge.js";
import type { StatusTone } from "../primitives/StatusBadge.js";
import { SystemProfileSummary } from "./SystemProfileSummary.js";
import { Button } from "../primitives/Button.js";

const FIT_TONE: Record<HardwareFit, StatusTone> = {
  "fits-comfortably": "success",
  "will-be-slow": "warning",
  "too-large": "neutral",
};

const FIT_LABEL: Record<HardwareFit, string> = {
  "fits-comfortably": "Fits comfortably",
  "will-be-slow": "Will be slow",
  "too-large": "Likely too large",
};

/** Sort order within the visible list. */
const FIT_RANK: Record<HardwareFit, number> = {
  "fits-comfortably": 0,
  "will-be-slow": 1,
  "too-large": 2,
};

export interface ModelCatalogViewProps {
  catalog: ModelCatalog;
  profile: SystemProfile | undefined;
  /**
   * Controlled by the app so the choice persists across sessions
   * (DESIGN.md §6.3) rather than resetting each time this screen opens.
   */
  showTooLarge: boolean;
  onShowTooLargeChange: (show: boolean) => void;
  activeModelId?: string;
  onSelect: (entry: ModelCatalogEntry) => void;
  /**
   * Re-reads what the local runtime has installed. Omitted where there
   * is no local runtime to ask.
   */
  onRefresh?: () => void | Promise<void>;
  /**
   * Omitted when the active provider cannot manage models — a remote
   * provider has nothing to install, and not every local one exposes an
   * API for it. Absent means the buttons are not rendered at all, rather
   * than rendered and failing when pressed (CLAUDE.md §4).
   */
  management?: ModelManagement;
}

export interface ModelManagement {
  /** The model being downloaded right now, if any. */
  installingId: string | null;
  progress: ModelPullProgress | null;
  /** The model being removed right now, if any. */
  removingId: string | null;
  error: string | null;
  onInstall: (entry: ModelCatalogEntry) => void;
  onCancelInstall: () => void;
  onUninstall: (entry: ModelCatalogEntry) => void;
}

/**
 * The full local model catalog. Shared verbatim between onboarding and
 * Settings (DESIGN.md §6.3) — there is no onboarding-only variant.
 *
 * Every catalog entry reaches this component; the only narrowing is the
 * default collapse of "likely too large" entries behind a toggle that
 * names their real count. Nothing is filtered out of the data.
 */
export function ModelCatalogView({
  catalog,
  profile,
  showTooLarge,
  onShowTooLargeChange,
  activeModelId,
  onSelect,
  onRefresh,
  management,
}: ModelCatalogViewProps) {
  const assessed = useMemo(() => {
    return catalog.entries
      .map((entry) => ({ entry, assessment: assessFit(entry, profile) }))
      .sort((a, b) => {
        const rankA = a.assessment ? FIT_RANK[a.assessment.fit] : 0;
        const rankB = b.assessment ? FIT_RANK[b.assessment.fit] : 0;
        if (rankA !== rankB) return rankA - rankB;
        if (a.entry.codeSpecialized !== b.entry.codeSpecialized) {
          return a.entry.codeSpecialized ? -1 : 1;
        }
        return a.entry.parametersBillions - b.entry.parametersBillions;
      });
  }, [catalog.entries, profile]);

  const tooLarge = assessed.filter((item) => item.assessment?.fit === "too-large");
  const visible = showTooLarge
    ? assessed
    : assessed.filter((item) => item.assessment?.fit !== "too-large");

  const installed = new Set(catalog.installedIds);
  const activeEntry = catalog.entries.find((entry) => entry.id === activeModelId);
  const activeNeedsDownload = activeEntry && !installed.has(activeEntry.id);

  return (
    <div className="flex flex-col gap-3">
      <SystemProfileSummary profile={profile} />

      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
          Local models
        </h3>
        <span className="flex items-center gap-2 text-xs text-text-tertiary">
          {catalog.source === "bundled"
            ? `Bundled list · ${catalog.retrievedAt}`
            : `Updated ${catalog.retrievedAt}`}
          {onRefresh && (
            <button
              type="button"
              onClick={() => void onRefresh()}
              className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <RefreshCw size={11} />
              Rescan
            </button>
          )}
        </span>
      </div>

      {activeNeedsDownload && !management && (
        <p className="rounded-md border border-status-info/30 bg-status-info/10 p-2.5 text-xs text-text-secondary">
          {activeEntry.label} isn&apos;t downloaded yet. Run{" "}
          <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-text-primary">
            ollama pull {activeEntry.id}
          </code>{" "}
          to fetch it — this provider can&apos;t be managed from here.
        </p>
      )}

      {management?.error && (
        <p className="rounded-md border border-status-danger/40 bg-status-danger/10 p-2.5 text-xs text-status-danger">
          {management.error}
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {visible.map(({ entry, assessment }) => (
          <li
            key={entry.id}
            className={clsx(
              "overflow-hidden rounded-md border transition-colors duration-micro",
              entry.id === activeModelId
                ? "border-accent bg-accent-muted"
                : "border-border-subtle bg-surface-2"
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(entry)}
              className={clsx(
                "flex w-full flex-col gap-1 p-2.5 text-left",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                entry.id !== activeModelId && "hover:bg-surface-3"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm text-text-primary">
                  {entry.label}
                  {installed.has(entry.id) && (
                    <span
                      className="flex items-center gap-0.5 text-xs text-status-success"
                      title="Already installed"
                    >
                      <Check size={11} />
                      Installed
                    </span>
                  )}
                </span>
                {assessment && (
                  <StatusBadge tone={FIT_TONE[assessment.fit]}>
                    {FIT_LABEL[assessment.fit]}
                  </StatusBadge>
                )}
              </div>
              <p className="text-xs text-text-secondary">{entry.description}</p>
              <p className="text-xs text-text-tertiary">
                {entry.parametersBillions}B · {formatContext(entry.contextWindow)} context
                {entry.codeSpecialized && " · code-specialized"}
                {/* Only meaningful once installed: until then this is the
                    model's claim, not this build's behaviour. Phrased as
                    what each does rather than what one lacks — a model
                    without tool calling can still be the stronger choice
                    for explaining and fixing code. */}
                {installed.has(entry.id) &&
                  (entry.supportsToolCalling
                    ? " · can run commands"
                    : " · explains and edits only")}
                {assessment && ` · ${assessment.rationale}`}
              </p>
            </button>
            {management && (
              <ModelActions
                entry={entry}
                installed={installed.has(entry.id)}
                inUse={entry.id === activeModelId}
                management={management}
              />
            )}
          </li>
        ))}
      </ul>

      {tooLarge.length > 0 && (
        <button
          type="button"
          onClick={() => onShowTooLargeChange(!showTooLarge)}
          aria-expanded={showTooLarge}
          className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChevronDown
            size={13}
            className={clsx("transition-transform", showTooLarge && "rotate-180")}
          />
          {showTooLarge
            ? `Hide ${tooLarge.length} too-large model${tooLarge.length === 1 ? "" : "s"}`
            : `Show ${tooLarge.length} too-large model${tooLarge.length === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}

function formatContext(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : `${tokens}`;
}

/**
 * Install / remove controls for one catalog row.
 *
 * A sibling of the row's selection button rather than a child of it:
 * nesting a button inside a button is invalid HTML, and React warns
 * about it — a mistake this project has already made once.
 */
function ModelActions({
  entry,
  installed,
  inUse,
  management,
}: {
  entry: ModelCatalogEntry;
  installed: boolean;
  inUse: boolean;
  management: ModelManagement;
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const installing = management.installingId === entry.id;
  const removing = management.removingId === entry.id;
  // One download at a time: two multi-gigabyte pulls at once help nobody
  // and make the progress line ambiguous.
  const otherBusy =
    (management.installingId !== null && !installing) ||
    (management.removingId !== null && !removing);

  if (installing) {
    return (
      <div className="flex items-center gap-2 border-t border-border-subtle px-2.5 py-1.5">
        <ProgressBar progress={management.progress} />
        <button
          type="button"
          onClick={management.onCancelInstall}
          aria-label={`Cancel downloading ${entry.label}`}
          className="rounded p-1 text-text-tertiary hover:bg-surface-3 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border-t border-border-subtle px-2.5 py-1.5">
      {!installed ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={otherBusy}
          onClick={() => management.onInstall(entry)}
        >
          <Download size={12} />
          Download
        </Button>
      ) : confirmingRemove ? (
        <>
          <span className="mr-auto text-xs text-text-secondary">
            {inUse
              ? "This is the model in use. Remove it anyway?"
              : `Remove ${entry.label}?`}
          </span>
          <Button
            variant="danger"
            size="sm"
            disabled={removing}
            onClick={() => {
              setConfirmingRemove(false);
              management.onUninstall(entry);
            }}
          >
            Remove
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmingRemove(false)}
          >
            Keep
          </Button>
        </>
      ) : (
        <button
          type="button"
          disabled={otherBusy || removing}
          onClick={() => setConfirmingRemove(true)}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-text-tertiary hover:bg-surface-3 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        >
          <Trash2 size={12} />
          {removing ? "Removing…" : "Remove"}
        </button>
      )}
    </div>
  );
}

/**
 * Real progress where the runtime gives us bytes, and honest
 * indeterminacy where it does not — a bar pretending to move during
 * "pulling manifest" would be inventing information.
 */
function ProgressBar({ progress }: { progress: ModelPullProgress | null }) {
  const fraction = progress?.fraction ?? null;
  return (
    <div className="flex flex-1 items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div
          className={clsx(
            "h-full bg-accent transition-[width] duration-200",
            fraction === null && "animate-pulse"
          )}
          style={{ width: fraction === null ? "100%" : `${Math.round(fraction * 100)}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-xs text-text-tertiary">
        {describeProgress(progress)}
      </span>
    </div>
  );
}

export function describeProgress(progress: ModelPullProgress | null): string {
  if (!progress) return "Starting…";
  if (progress.fraction === null) return progress.status || "Working…";
  const percent = Math.round(progress.fraction * 100);
  if (progress.totalBytes === null) return `${percent}%`;
  return `${percent}% of ${formatBytes(progress.totalBytes)}`;
}
