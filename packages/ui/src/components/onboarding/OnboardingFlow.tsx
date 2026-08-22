import { useEffect, useRef, useState } from "react";
import type {
  ModelCatalog,
  ModelCatalogEntry,
  SkillLevel,
  SystemProfile,
} from "@paleonyx/shared-types";
import { SKILL_LEVEL_DESCRIPTORS } from "@paleonyx/shared-types";
import { Button } from "../../primitives/Button.js";
import { ByokSection } from "../ByokSection.js";
import { ModelCatalogView } from "../ModelCatalogView.js";
import { SkillLevelCards } from "./SkillLevelCards.js";

const STEPS = ["welcome", "skill", "models", "ready"] as const;
type Step = (typeof STEPS)[number];

const STEP_TITLE: Record<Step, string> = {
  welcome: "Welcome to Paleonyx Studio",
  skill: "How much coding experience do you have?",
  models: "Choose a model",
  ready: "You're set up",
};

export interface OnboardingFlowProps {
  skillLevel: SkillLevel;
  onSkillLevelChange: (level: SkillLevel) => void;
  catalog: ModelCatalog | null;
  profile: SystemProfile | undefined;
  showTooLarge: boolean;
  onShowTooLargeChange: (show: boolean) => void;
  selectedModelId: string | null;
  onSelectModel: (entry: ModelCatalogEntry) => void;
  onComplete: () => void;
  /** Omitted where credential storage doesn't exist (see ByokSection). */
  byok?: {
    keyedProviderIds: readonly string[];
    onAddKey: (providerId: string, key: string) => Promise<void>;
    onRemoveKey: (providerId: string) => Promise<void>;
  };
}

/**
 * First-run only, app-level (PRD.md §3 journey 1). Runs once; everything
 * chosen here stays changeable in Settings afterward, and the model step
 * renders the very same `ModelCatalogView` Settings uses rather than a
 * parallel onboarding-only copy (DESIGN.md §6.3).
 *
 * Every step is skippable. Skipping leaves each preference at its safe
 * default rather than blocking the user from reaching the app.
 */
export function OnboardingFlow(props: OnboardingFlowProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex] ?? "welcome";
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Multi-step flows are a classic screen-reader trap: the heading
  // changes but focus stays on the button that was just pressed, so the
  // new step is never announced. Moving focus to the heading fixes that.
  useEffect(() => {
    headingRef.current?.focus();
  }, [stepIndex]);

  const isLast = stepIndex === STEPS.length - 1;

  return (
    <div className="flex h-screen w-screen flex-col bg-surface-0 font-ui text-text-primary">
      <div className="flex min-h-0 flex-1 justify-center overflow-auto px-6 py-10">
        <div className="flex w-full max-w-2xl flex-col">
          <p className="text-xs uppercase tracking-wide text-text-tertiary">
            Step {stepIndex + 1} of {STEPS.length}
          </p>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-1 text-xl font-medium focus-visible:outline-none"
          >
            {STEP_TITLE[step]}
          </h1>

          <div className="mt-5 flex-1">
            {step === "welcome" && <WelcomeStep />}
            {step === "skill" && (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-text-secondary">
                  This changes how much the assistant explains — not what it can
                  do. Every feature works the same at every level, and you can
                  change this any time in Settings.
                </p>
                <SkillLevelCards
                  value={props.skillLevel}
                  onChange={props.onSkillLevelChange}
                />
              </div>
            )}
            {step === "models" && (
              <>
                <ModelStep
                  catalog={props.catalog}
                  profile={props.profile}
                  showTooLarge={props.showTooLarge}
                  onShowTooLargeChange={props.onShowTooLargeChange}
                  selectedModelId={props.selectedModelId}
                  onSelectModel={props.onSelectModel}
                />
                <ByokSection
                  keyedProviderIds={props.byok?.keyedProviderIds ?? []}
                  onAddKey={props.byok?.onAddKey ?? (async () => {})}
                  onRemoveKey={props.byok?.onRemoveKey ?? (async () => {})}
                  available={props.byok !== undefined}
                />
              </>
            )}
            {step === "ready" && (
              <ReadyStep
                skillLevel={props.skillLevel}
                selectedModelId={props.selectedModelId}
                catalog={props.catalog}
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-border-subtle px-6 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onComplete}
          className={isLast ? "invisible" : undefined}
        >
          Skip setup
        </Button>
        <div className="flex items-center gap-2">
          {stepIndex > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setStepIndex(stepIndex - 1)}>
              Back
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => (isLast ? props.onComplete() : setStepIndex(stepIndex + 1))}
          >
            {isLast ? "Start working" : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function WelcomeStep() {
  return (
    <div className="flex flex-col gap-3 text-sm text-text-secondary">
      <p>
        Paleonyx Studio is an IDE with an AI assistant that runs on your own
        machine. Your code and your prompts stay here.
      </p>
      <p>
        Nothing is sent anywhere unless you explicitly connect a remote provider,
        and the status bar always shows which model is active.
      </p>
      <p>
        The assistant proposes changes; it never writes to your files without
        your review. That default is visible in the status bar too, and changing
        it takes a deliberate action.
      </p>
      <p className="text-text-tertiary">
        Setting up takes about a minute. You can skip it and come back later.
      </p>
    </div>
  );
}

function ModelStep({
  catalog,
  profile,
  showTooLarge,
  onShowTooLargeChange,
  selectedModelId,
  onSelectModel,
}: {
  catalog: ModelCatalog | null;
  profile: SystemProfile | undefined;
  showTooLarge: boolean;
  onShowTooLargeChange: (show: boolean) => void;
  selectedModelId: string | null;
  onSelectModel: (entry: ModelCatalogEntry) => void;
}) {
  if (!catalog) {
    return <p className="text-sm text-text-tertiary">Loading model catalog…</p>;
  }
  return (
    <ModelCatalogView
      catalog={catalog}
      profile={profile}
      showTooLarge={showTooLarge}
      onShowTooLargeChange={onShowTooLargeChange}
      activeModelId={selectedModelId ?? undefined}
      onSelect={onSelectModel}
    />
  );
}

function ReadyStep({
  skillLevel,
  selectedModelId,
  catalog,
}: {
  skillLevel: SkillLevel;
  selectedModelId: string | null;
  catalog: ModelCatalog | null;
}) {
  const descriptor = SKILL_LEVEL_DESCRIPTORS.find((d) => d.level === skillLevel);
  const model = catalog?.entries.find((entry) => entry.id === selectedModelId);
  const installed = selectedModelId
    ? catalog?.installedIds.includes(selectedModelId)
    : false;

  return (
    <dl className="flex flex-col gap-3 text-sm">
      <div>
        <dt className="text-xs uppercase tracking-wide text-text-tertiary">
          Explanation depth
        </dt>
        <dd className="mt-0.5 text-text-primary">{descriptor?.label ?? skillLevel}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-text-tertiary">Model</dt>
        <dd className="mt-0.5 text-text-primary">
          {model ? model.label : "None chosen — you can pick one in Settings."}
        </dd>
        {model && !installed && (
          <dd className="mt-1 text-xs text-text-secondary">
            Not downloaded yet. Run{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 font-mono">
              ollama pull {model.id}
            </code>{" "}
            to fetch it.
          </dd>
        )}
      </div>
      <p className="mt-1 text-xs text-text-tertiary">
        Both are changeable at any time from Settings.
      </p>
    </dl>
  );
}
