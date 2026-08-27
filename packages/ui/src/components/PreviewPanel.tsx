import { useEffect, useRef, useState } from "react";
import { Monitor, MousePointerClick, RotateCw, Smartphone, Tablet } from "lucide-react";
import type { DesignSelection } from "@paleonyx/shared-types";
import { IconButton } from "../primitives/IconButton.js";
import { Button } from "../primitives/Button.js";

/**
 * Widths the preview can be pinned to.
 *
 * Present because the wizard now asks whether a project is for Android
 * or iOS, and answering "phone" produces a page meant for a phone
 * screen. Being told the layout is phone-shaped and only ever seeing it
 * at desktop width would make that claim unverifiable — this is how the
 * user checks it is true.
 */
const VIEWPORTS = [
  { id: "phone", label: "Phone", width: 390, icon: Smartphone },
  { id: "tablet", label: "Tablet", width: 820, icon: Tablet },
  { id: "full", label: "Fill the panel", width: null, icon: Monitor },
] as const;

export type PreviewViewportId = (typeof VIEWPORTS)[number]["id"];

/** The shape the injected selection script posts back. */
interface SelectionMessage {
  source: "paleonyx-preview";
  kind: "select" | "ready";
  tag: string;
  id: string | null;
  classes: string[];
  text: string;
  path: string[];
  rect: { x: number; y: number; width: number; height: number };
}

export interface PreviewPanelProps {
  /** Where the local preview server is serving, or null when it is not running. */
  url: string | null;
  /** Project-relative path of the page being shown, for the selection. */
  entryPath: string | null;
  /** Why there is nothing to show, when there is nothing to show. */
  unavailableReason?: string | null;
  /** Failure starting the server, which is different from having no page. */
  error?: string | null;
  /**
   * Bumped by the host whenever the project's files change on disk, so
   * the frame reloads. A counter rather than a boolean: two changes in a
   * row must produce two reloads.
   */
  reloadToken?: number;
  initialViewport?: PreviewViewportId;
  designMode?: boolean;
  /**
   * Turning design mode on is the host's job, not the panel's: the
   * server has to start injecting the selection script and the frame has
   * to be reloaded to receive it.
   */
  onDesignModeChange?: (enabled: boolean) => void;
  /** Runs the design-change task for what was selected. */
  onDesignChange?: (selection: DesignSelection, instruction: string) => void;
  /** True while a design change is running, so it cannot be asked twice. */
  busy?: boolean;
}

/**
 * Shows the opened project running (PRD.md §3 journey 14).
 *
 * The frame is sandboxed. The project being previewed is code a model
 * proposed and the user may not have read closely, so it runs with
 * scripts allowed but without same-origin access to the app around it —
 * a page served here cannot reach Paleonyx's own storage or DOM. That
 * same boundary is why design mode works by message rather than by
 * reading the frame: we cannot see into it either.
 */
export function PreviewPanel({
  url,
  entryPath,
  unavailableReason = null,
  error = null,
  reloadToken = 0,
  initialViewport = "full",
  designMode = false,
  onDesignModeChange,
  onDesignChange,
  busy = false,
}: PreviewPanelProps) {
  const [viewport, setViewport] = useState<PreviewViewportId>(initialViewport);
  const frame = useRef<HTMLIFrameElement>(null);
  const [nonce, setNonce] = useState(0);
  const [selection, setSelection] = useState<DesignSelection | null>(null);
  const [instruction, setInstruction] = useState("");

  // Reloading by changing `src` rather than touching the frame's own
  // document: the sandbox denies same-origin access, so reaching into
  // contentWindow to call reload() would throw.
  useEffect(() => {
    setNonce((current) => current + 1);
  }, [reloadToken, url]);

  // A selection belongs to the page it was made on. Leaving it visible
  // after a reload would let the user ask for a change to an element
  // that may no longer be there.
  useEffect(() => {
    setSelection(null);
    setInstruction("");
  }, [nonce, designMode]);

  useEffect(() => {
    if (!designMode) return;

    function onMessage(event: MessageEvent) {
      // The frame has an opaque origin, so `event.origin` is "null" and
      // proves nothing. Identity comes from the window itself: only the
      // frame we rendered is allowed to set a selection.
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data as SelectionMessage | undefined;
      if (!data || data.source !== "paleonyx-preview" || data.kind !== "select") {
        return;
      }
      setSelection({
        page: entryPath ?? "",
        tag: data.tag,
        id: data.id,
        classes: data.classes ?? [],
        text: data.text ?? "",
        path: data.path ?? [],
        rect: data.rect,
      });
      setInstruction("");
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [designMode, entryPath]);

  const active = VIEWPORTS.find((entry) => entry.id === viewport) ?? VIEWPORTS[2];
  const canAsk = Boolean(selection && instruction.trim() && !busy);

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <div className="flex items-center gap-1 border-b border-border-subtle px-2 py-1.5">
        <span className="mr-auto text-xs uppercase tracking-wide text-text-tertiary">
          Preview
        </span>
        {onDesignModeChange && (
          <IconButton
            icon={<MousePointerClick size={14} />}
            label={designMode ? "Stop selecting" : "Select something to change"}
            active={designMode}
            onClick={() => onDesignModeChange(!designMode)}
          />
        )}
        {VIEWPORTS.map((entry) => (
          <IconButton
            key={entry.id}
            icon={<entry.icon size={14} />}
            label={entry.label}
            active={entry.id === viewport}
            onClick={() => setViewport(entry.id)}
          />
        ))}
        <IconButton
          icon={<RotateCw size={14} />}
          label="Reload"
          onClick={() => setNonce((current) => current + 1)}
        />
      </div>

      <div className="flex flex-1 items-start justify-center overflow-auto bg-surface-1 p-3">
        {error ? (
          <Message tone="danger" title="The preview could not start">
            {error}
          </Message>
        ) : unavailableReason ? (
          <Message tone="muted" title="Nothing to preview yet">
            {unavailableReason}
          </Message>
        ) : url ? (
          <iframe
            ref={frame}
            key={nonce}
            src={url}
            title="Project preview"
            // Scripts yes, same-origin no: the previewed project is
            // code the user has not necessarily read.
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            className="h-full rounded-md border border-border-subtle bg-white"
            style={{
              width: active.width ?? "100%",
              maxWidth: "100%",
              minHeight: "100%",
            }}
          />
        ) : (
          <Message tone="muted" title="Starting the preview…">
            Serving this project on your machine. Nothing is published or sent
            anywhere.
          </Message>
        )}
      </div>

      {designMode && url && (
        <div className="border-t border-border-subtle p-2.5">
          {selection ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-text-secondary">
                Selected{" "}
                <span className="font-mono text-text-primary">
                  {describeSelection(selection)}
                </span>
              </p>
              <textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                rows={2}
                placeholder="What should change about it?"
                className="w-full resize-y rounded-md border border-border-subtle bg-surface-2 p-2 text-sm text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <Button
                variant="primary"
                size="sm"
                disabled={!canAsk}
                onClick={() =>
                  selection && onDesignChange?.(selection, instruction)
                }
              >
                {busy ? "Working on it…" : "Ask for this change"}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-text-secondary">
              Click anything in the page above to choose it. Clicks pick things
              instead of pressing them while this is on.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** A short, readable name for what was clicked. */
export function describeSelection(selection: DesignSelection): string {
  const tag = selection.tag.toLowerCase();
  if (selection.id) return `#${selection.id}`;
  if (selection.classes.length > 0) return `${tag}.${selection.classes[0]}`;
  const text = selection.text.trim();
  if (text) return `${tag} “${text.slice(0, 24)}${text.length > 24 ? "…" : ""}”`;
  return tag;
}

function Message({
  tone,
  title,
  children,
}: {
  tone: "muted" | "danger";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-8 flex max-w-sm flex-col gap-1.5 text-center">
      <p
        className={
          tone === "danger"
            ? "text-sm text-status-danger"
            : "text-sm text-text-primary"
        }
      >
        {title}
      </p>
      <p className="text-xs text-text-secondary">{children}</p>
    </div>
  );
}
