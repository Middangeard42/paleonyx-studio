import { useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import type { ByokProviderDescriptor } from "@paleonyx/shared-types";
import { Button } from "../primitives/Button.js";
import { BYOK_PROVIDERS } from "./byok-providers.js";

export interface ByokSectionProps {
  /** Which providers currently have a key stored. Never the keys. */
  keyedProviderIds: readonly string[];
  onAddKey: (providerId: string, key: string) => Promise<void>;
  onRemoveKey: (providerId: string) => Promise<void>;
  /**
   * Absent where credential storage does not exist — `apps/web` has no
   * durable place to keep a key and must never fall back to
   * localStorage (CLAUDE.md §9), so it renders the explanation instead
   * of a form that cannot honour what it implies.
   */
  available?: boolean;
  /**
   * Why the credential store could not be checked, when it could not. Shown
   * above the list: without it, an unusable store looks like "no keys yet"
   * until someone tries to add one and it fails.
   */
  storeProblem?: string | null;
}

/**
 * Connect a remote provider with your own API key.
 *
 * Deliberately quiet: no accent-coloured primary buttons, no top
 * billing, placed below the local catalog (DESIGN.md §6.3). Cloud
 * options must never out-compete local ones visually, or the product
 * undercuts its own local-first positioning on the very screen where a
 * user decides what to run.
 */
export function ByokSection({
  keyedProviderIds,
  onAddKey,
  onRemoveKey,
  available = true,
  storeProblem = null,
}: ByokSectionProps) {
  return (
    <section className="mt-6 border-t border-border-subtle pt-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
        Or connect a cloud provider
      </h3>
      <p className="mt-1 text-xs text-text-tertiary">
        Optional. Uses your own account with that provider, and only sends
        anything when you pick one of its models. Keys are stored by your
        operating system&apos;s credential manager, never in a file.
      </p>

      {!available ? (
        <p className="mt-3 rounded-md border border-border-subtle bg-surface-2 p-2.5 text-xs text-text-secondary">
          Adding a key needs the desktop app — a browser has nowhere safe to
          keep one.
        </p>
      ) : (
        <>
          {storeProblem && (
            <p
              role="alert"
              className="mt-3 rounded-md border border-status-warning/40 bg-status-warning/10 p-2.5 text-xs text-text-secondary"
            >
              Saved keys can&apos;t be checked right now, so none are shown. {storeProblem}
            </p>
          )}
          <ul className="mt-3 flex flex-col gap-2">
            {BYOK_PROVIDERS.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                hasKey={keyedProviderIds.includes(provider.id)}
                onAddKey={onAddKey}
                onRemoveKey={onRemoveKey}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ProviderRow({
  provider,
  hasKey,
  onAddKey,
  onRemoveKey,
}: {
  provider: ByokProviderDescriptor;
  hasKey: boolean;
  onAddKey: (providerId: string, key: string) => Promise<void>;
  onRemoveKey: (providerId: string) => Promise<void>;
}) {
  const [entering, setEntering] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onAddKey(provider.id, draftKey);
      // Clear immediately on success: there is no reason for the key to
      // outlive the request that stored it, in this field or anywhere.
      setDraftKey("");
      setEntering(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await onRemoveKey(provider.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProviderRowView
      provider={provider}
      hasKey={hasKey}
      entering={entering}
      draftKey={draftKey}
      busy={busy}
      error={error}
      onDraftKeyChange={setDraftKey}
      onStartEntering={() => setEntering(true)}
      onCancel={() => {
        setDraftKey("");
        setEntering(false);
        setError(null);
      }}
      onSubmit={() => void submit()}
      onRemove={() => void remove()}
    />
  );
}

export interface ProviderRowViewProps {
  provider: ByokProviderDescriptor;
  hasKey: boolean;
  entering: boolean;
  draftKey: string;
  busy: boolean;
  error: string | null;
  onDraftKeyChange: (value: string) => void;
  onStartEntering: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  onRemove: () => void;
}

/**
 * How one provider row looks, given its state. Separate from the state so
 * each case can be rendered on its own: a failed removal, for one, has to
 * be visible when a key exists and the add form is not.
 */
export function ProviderRowView({
  provider,
  hasKey,
  entering,
  draftKey,
  busy,
  error,
  onDraftKeyChange,
  onStartEntering,
  onCancel,
  onSubmit,
  onRemove,
}: ProviderRowViewProps) {
  return (
    <li className="rounded-md border border-border-subtle bg-surface-1 p-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm text-text-primary">
            {provider.label}
            {hasKey && (
              <span className="flex items-center gap-0.5 text-xs text-status-success">
                <Check size={11} />
                Key added
              </span>
            )}
          </span>
          <p className="mt-0.5 text-xs text-text-secondary">{provider.description}</p>
          {provider.freeTierNote && (
            <p className="mt-0.5 text-xs text-text-tertiary">{provider.freeTierNote}</p>
          )}
        </div>

        {hasKey ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
            {busy ? "Removing…" : "Remove key"}
          </Button>
        ) : (
          !entering && (
            <Button size="sm" variant="secondary" onClick={onStartEntering}>
              Add key
            </Button>
          )
        )}
      </div>

      {entering && !hasKey && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <a
            href={provider.keyUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 text-xs text-accent hover:underline"
          >
            Get a key from {provider.label}
            <ExternalLink size={11} />
          </a>
          <input
            type="password"
            value={draftKey}
            onChange={(event) => onDraftKeyChange(event.target.value)}
            placeholder={`Paste your ${provider.label} API key`}
            autoComplete="off"
            spellCheck={false}
            className="rounded-md border border-border-subtle bg-surface-2 p-2 font-mono text-xs text-text-primary placeholder:font-ui placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={busy || draftKey.trim().length === 0}
            >
              {busy ? "Saving…" : "Save key"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {/* Outside the form: removing a key has no form, and a failure there
          used to leave the row looking as if nothing had been tried. */}
      {error && (
        <p role="alert" className="mt-2 text-xs text-status-danger">
          {error}
        </p>
      )}
    </li>
  );
}
