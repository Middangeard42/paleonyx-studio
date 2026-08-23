import { useMemo } from "react";
import { Check, ChevronDown } from "lucide-react";
import clsx from "clsx";
import type {
  HardwareFit,
  ModelCatalog,
  ModelCatalogEntry,
  SystemProfile,
} from "@paleonyx/shared-types";
import { assessFit } from "@paleonyx/system-profile";
import { StatusBadge } from "../primitives/StatusBadge.js";
import type { StatusTone } from "../primitives/StatusBadge.js";
import { SystemProfileSummary } from "./SystemProfileSummary.js";

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
        <span className="text-xs text-text-tertiary">
          {catalog.source === "bundled"
            ? `Bundled list · ${catalog.retrievedAt}`
            : `Updated ${catalog.retrievedAt}`}
        </span>
      </div>

      {activeNeedsDownload && (
        <p className="rounded-md border border-status-info/30 bg-status-info/10 p-2.5 text-xs text-text-secondary">
          {activeEntry.label} isn&apos;t downloaded yet. Run{" "}
          <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-text-primary">
            ollama pull {activeEntry.id}
          </code>{" "}
          to fetch it — Paleonyx can&apos;t start a download for you yet.
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {visible.map(({ entry, assessment }) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onSelect(entry)}
              className={clsx(
                "flex w-full flex-col gap-1 rounded-md border p-2.5 text-left transition-colors duration-micro",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                entry.id === activeModelId
                  ? "border-accent bg-accent-muted"
                  : "border-border-subtle bg-surface-2 hover:bg-surface-3"
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
