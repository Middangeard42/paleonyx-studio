import { useEffect, useRef, useState } from "react";
import { Monitor, RotateCw, Smartphone, Tablet } from "lucide-react";
import { IconButton } from "../primitives/IconButton.js";

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

export interface PreviewPanelProps {
  /** Where the local preview server is serving, or null when it is not running. */
  url: string | null;
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
}

/**
 * Shows the opened project running (PRD.md §3 journey 14's prerequisite).
 *
 * The frame is sandboxed. The project being previewed is code a model
 * proposed and the user may not have read closely, so it runs with
 * scripts allowed but without same-origin access to the app around it —
 * a page served here cannot reach Paleonyx's own storage or DOM.
 */
export function PreviewPanel({
  url,
  unavailableReason = null,
  error = null,
  reloadToken = 0,
  initialViewport = "full",
}: PreviewPanelProps) {
  const [viewport, setViewport] = useState<PreviewViewportId>(initialViewport);
  const frame = useRef<HTMLIFrameElement>(null);
  const [nonce, setNonce] = useState(0);

  // Reloading by changing `src` rather than touching the frame's own
  // document: the sandbox denies same-origin access, so reaching into
  // contentWindow to call reload() would throw.
  useEffect(() => {
    setNonce((current) => current + 1);
  }, [reloadToken, url]);

  const active = VIEWPORTS.find((entry) => entry.id === viewport) ?? VIEWPORTS[2];

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <div className="flex items-center gap-1 border-b border-border-subtle px-2 py-1.5">
        <span className="mr-auto text-xs uppercase tracking-wide text-text-tertiary">
          Preview
        </span>
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
    </div>
  );
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
