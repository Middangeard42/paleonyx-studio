import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import type { ProjectBrief, ProjectPlatform } from "@paleonyx/shared-types";
import {
  EMPTY_PROJECT_BRIEF,
  EXCLUSIVE_PLATFORM,
  PROJECT_PLATFORM_LABELS,
} from "@paleonyx/shared-types";
import { Button } from "../primitives/Button.js";

const PLATFORM_ORDER: ProjectPlatform[] = [
  "web",
  "desktop",
  "android",
  "ios",
  "command-line",
  "undecided",
];

/**
 * Picking a target toggles it, except "Not sure yet", which cannot
 * coexist with a specific answer in either direction.
 */
function togglePlatform(
  current: readonly ProjectPlatform[],
  platform: ProjectPlatform
): ProjectPlatform[] {
  if (current.includes(platform)) return current.filter((p) => p !== platform);
  if (platform === EXCLUSIVE_PLATFORM) return [platform];
  return [...current.filter((p) => p !== EXCLUSIVE_PLATFORM), platform];
}

export interface ProjectWizardProps {
  /** The folder the project will be created in, shown so it's not a surprise. */
  projectRoot: string;
  onSubmit: (brief: ProjectBrief) => void;
  onCancel: () => void;
  /** True once a run is in flight, so the form can't be submitted twice. */
  busy?: boolean;
}

/**
 * The way into Paleonyx for someone with an idea and no code (PRD.md §3
 * journey 13).
 *
 * Every question is asked in words a person who has never written code
 * would use, and only the first is required — a form that demands an
 * "audience" and a "platform" from someone who has neither in mind is a
 * form they abandon. What they leave blank is left out of the brief
 * rather than guessed at (see composeProjectBrief).
 */
export function ProjectWizard({
  projectRoot,
  onSubmit,
  onCancel,
  busy = false,
}: ProjectWizardProps) {
  const [brief, setBrief] = useState<ProjectBrief>(EMPTY_PROJECT_BRIEF);
  const [features, setFeatures] = useState<string[]>([""]);

  const describable = brief.description.trim().length > 0;

  function update<K extends keyof ProjectBrief>(key: K, value: ProjectBrief[K]) {
    setBrief((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit() {
    if (!describable || busy) return;
    onSubmit({ ...brief, features });
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-y-auto bg-surface-0 font-ui text-text-primary">
      <div className="my-10 flex w-[34rem] flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-medium">Describe what you want to build</h1>
          <p className="text-sm text-text-secondary">
            Answer what you can — only the first question is needed. Paleonyx
            will propose the first files, and you'll see exactly what they are
            before anything is written.
          </p>
          <p className="mt-1 font-mono text-xs text-text-tertiary">{projectRoot}</p>
        </header>

        <Field
          label="What do you want to make?"
          hint="Plain language is fine. “A page that tracks how much water I drink each day.”"
        >
          <textarea
            autoFocus
            value={brief.description}
            onChange={(event) => update("description", event.target.value)}
            rows={3}
            placeholder="I want to build…"
            className={FIELD_CLASS}
          />
        </Field>

        <Field label="Who is it for?" hint="Optional — leave blank if it's just for you.">
          <input
            value={brief.audience}
            onChange={(event) => update("audience", event.target.value)}
            placeholder="Me, my family, my team…"
            className={FIELD_CLASS}
          />
        </Field>

        <FieldGroup
          label="Where should people use it?"
          hint="Pick as many as apply. Choosing more than one asks for a single thing that covers them all."
        >
          <div className="flex flex-wrap gap-1.5">
            {PLATFORM_ORDER.map((platform) => {
              const active = brief.platforms.includes(platform);
              return (
                <button
                  key={platform}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  onClick={() =>
                    update("platforms", togglePlatform(brief.platforms, platform))
                  }
                  className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    active
                      ? "border-accent bg-accent-muted text-text-primary"
                      : "border-border-subtle bg-surface-1 text-text-secondary hover:bg-surface-2"
                  }`}
                >
                  {PROJECT_PLATFORM_LABELS[platform]}
                </button>
              );
            })}
          </div>
        </FieldGroup>

        <FieldGroup
          label="What must it be able to do?"
          hint="Optional — a few things it needs to do, one per line."
        >
          <FeatureList items={features} onChange={setFeatures} />
        </FieldGroup>

        <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-4">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Back
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!describable || busy}>
            {busy ? "Working on it…" : "Build the first version"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const FIELD_CLASS =
  "w-full resize-y rounded-md border border-border-subtle bg-surface-2 p-2 text-sm text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** A question answered by exactly one control. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-text-primary">{label}</span>
      {hint && <span className="text-xs text-text-tertiary">{hint}</span>}
      {children}
    </label>
  );
}

/**
 * A question answered by several controls.
 *
 * These cannot share the `Field` above: a `<label>` binds to its first
 * labelable descendant, so wrapping the six platform chips in one made
 * the question itself a control — clicking the words "Where should
 * people use it?" silently selected "Web browser". Labelling by
 * reference instead also gets a screen reader to announce the set as a
 * group rather than reading the whole question into every chip's name.
 */
function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1.5">
      <span id={id} className="text-sm text-text-primary">
        {label}
      </span>
      {hint && <span className="text-xs text-text-tertiary">{hint}</span>}
      {children}
    </div>
  );
}

/**
 * A growing list of one-line answers.
 *
 * A single textarea split on newlines would be less code, but "one per
 * line" is a convention the user has to know and cannot see. Discrete
 * rows show the shape of the answer being asked for.
 */
function FeatureList({
  items,
  onChange,
}: {
  items: string[];
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <input
            value={item}
            onChange={(event) =>
              onChange(items.map((v, i) => (i === index ? event.target.value : v)))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onChange([...items, ""]);
              }
            }}
            placeholder="It should…"
            className={FIELD_CLASS}
          />
          {items.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              aria-label={`Remove item ${index + 1}`}
              className="rounded-md p-1.5 text-text-tertiary transition-colors duration-micro hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className="flex items-center gap-1 self-start rounded-md px-1.5 py-1 text-xs text-text-secondary transition-colors duration-micro hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Plus size={12} />
        Add another
      </button>
    </div>
  );
}
