import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Files, FolderOpen, MonitorPlay, Search, Sparkles } from "lucide-react";
import {
  ActivityBar,
  AgentPanel,
  Button,
  FileTree,
  IconButton,
  BYOK_PROVIDERS,
  ByokSection,
  ModelCatalogView,
  OnboardingFlow,
  Panel,
  PreviewPanel,
  ProjectWizard,
  SearchPanel,
  StatusBar,
  TabPanel,
  Tabs,
  ThemeProvider,
  Timeline,
  TooltipProvider,
  useLocalPreference,
} from "@paleonyx/ui";
import { applyAgentChange, loadHistory, revertAgentChange } from "@paleonyx/vcs";
import {
  EMPTY_WORKSPACE,
  checkWritable,
  closeBuffer,
  editBuffer,
  isProposalStale,
  markSaved,
  openBuffer,
  refreshAfterWrite,
} from "./workspace-files.js";
import { CodeEditor } from "@paleonyx/editor";
import {
  describeMissingEntry,
  findContextDocuments,
  findPreviewEntry,
  listProjectFiles,
} from "@paleonyx/indexing";
import type { ContextDocument } from "@paleonyx/indexing";
import {
  DEFAULT_BUDGET_LIMITS,
  composeDesignRequest,
  composeProjectBrief,
  isSelectionLocatable,
  runAgentTask,
} from "@paleonyx/agent-core";
import {
  MockAdapter,
  OllamaAdapter,
  OpenAiCompatibleAdapter,
  demoRespond,
  installerFor,
  loadModelCatalog,
  pingOllama,
} from "@paleonyx/runtime";
import type { ChatModelProvider } from "@paleonyx/runtime";
import type { ModelManagement } from "@paleonyx/ui";
import {
  DEFAULT_PERMISSION_MODE,
  DEFAULT_SKILL_LEVEL,
  canApplyWithoutApproval,
  canProposeEdits,
  canRunCommands,
} from "@paleonyx/shared-types";
import type {
  AgentChangeRecord,
  AgentTaskInput,
  AgentTaskResult,
  AgentTaskType,
  BudgetUsage,
  HistoryEntry,
  ModelCatalog,
  ModelCatalogEntry,
  ModelPullProgress,
  DesignSelection,
  PermissionMode,
  ProjectBrief,
  ProjectFile,
  SearchOptions,
  SearchResults,
  SkillLevel,
  SystemProfile,
} from "@paleonyx/shared-types";
import { TauriFileSystem, openProject } from "./tauri-filesystem.js";
import { openFolderDialog } from "./tauri-dialog.js";
import { searchProject } from "./tauri-search.js";
import { runProjectCommand } from "./tauri-exec.js";
import {
  previewUrl,
  setDesignMode,
  startPreview,
  stopPreview,
} from "./tauri-preview.js";
import { TauriSystemProfileReader } from "./tauri-system-profile.js";
import {
  TauriChangeStore,
  getGitStatus,
  initGitRepository,
  saveUserEdits,
} from "./tauri-change-store.js";
import {
  deleteProviderKey,
  getProviderKey,
  loadKeyedProviderIds,
  setProviderKey,
} from "./tauri-secrets.js";

const ZERO_BUDGET_USAGE: BudgetUsage = { toolCalls: 0, tokens: 0 };

/**
 * The catalog, hardware profile, and model/skill preferences live here
 * rather than in `Workspace` because they're app-level, not per-project:
 * onboarding runs before any project is open, and the same values feed
 * the Settings-side Models panel afterward.
 */
export function App() {
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [systemProfile, setSystemProfile] = useState<SystemProfile | undefined>();
  const [profileError, setProfileError] = useState<string | null>(null);

  const [skillLevel, setSkillLevel] = useLocalPreference<SkillLevel>(
    "paleonyx.skillLevel",
    DEFAULT_SKILL_LEVEL
  );
  const [showTooLarge, setShowTooLarge] = useLocalPreference(
    "paleonyx.models.showTooLarge",
    false
  );
  const [selectedModelId, setSelectedModelId] = useLocalPreference<string | null>(
    "paleonyx.selectedModelId",
    null
  );
  /**
   * The folder chosen for a brand-new project, held while the wizard
   * collects the brief. Distinct from `projectRoot`: the workspace must
   * not mount until there is something for it to do.
   */
  const [wizardRoot, setWizardRoot] = useState<string | null>(null);
  const [pendingBrief, setPendingBrief] = useState<ProjectBrief | null>(null);

  const [onboarded, setOnboarded] = useLocalPreference(
    "paleonyx.onboarding.completed",
    false
  );
  const [keyedProviderIds, setKeyedProviderIds] = useState<string[]>([]);

  const refreshKeyedProviders = useCallback(async () => {
    setKeyedProviderIds(await loadKeyedProviderIds());
  }, []);

  useEffect(() => {
    void refreshKeyedProviders();
  }, [refreshKeyedProviders]);

  async function handleAddKey(providerId: string, key: string) {
    await setProviderKey(providerId, key);
    await refreshKeyedProviders();
  }

  async function handleRemoveKey(providerId: string) {
    await deleteProviderKey(providerId);
    // Removing the key for the provider currently in use must also stop
    // using it — otherwise the next request fails with an auth error
    // rather than falling back to something that works.
    if (selectedModelId?.startsWith(`${providerId}:`)) {
      setSelectedModelId(null);
    }
    await refreshKeyedProviders();
  }

  /**
   * Re-reads what Ollama has installed.
   *
   * Called on more than mount because a stale catalog is not merely a
   * display problem: model capabilities come from these entries, so a
   * model installed after startup has no entry, falls back to "no tool
   * calling", and silently runs single-pass however capable it actually
   * is.
   */
  const refreshCatalog = useCallback(async () => {
    setCatalog(await loadModelCatalog());
  }, []);

  /**
   * Downloading and removing models, held here rather than in the panel.
   *
   * A pull is multi-gigabyte and takes minutes; if this state lived in
   * the catalog component it would be torn down the moment the user
   * switched panels, and the progress callbacks would be writing to an
   * unmounted tree. Onboarding shows the same screen, so this also makes
   * the download available at the moment a beginner first picks a model
   * — which is exactly where "run this in a terminal" was worst.
   */
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<ModelPullProgress | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [ollamaReachable, setOllamaReachable] = useState(false);
  const installAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    void pingOllama().then(setOllamaReachable);
  }, [catalog]);

  const handleInstallModel = useCallback(
    async (entry: ModelCatalogEntry) => {
      const installer = installerFor("ollama");
      if (!installer) return;
      const abort = new AbortController();
      installAbort.current = abort;
      setManageError(null);
      setInstallProgress(null);
      setInstallingId(entry.id);
      try {
        await installer.install(entry.id, {
          signal: abort.signal,
          onProgress: setInstallProgress,
        });
        await refreshCatalog();
      } catch (err) {
        // Cancelling is something the user did, not a failure to report
        // back to them as one.
        if (!abort.signal.aborted) {
          setManageError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        installAbort.current = null;
        setInstallingId(null);
        setInstallProgress(null);
      }
    },
    [refreshCatalog]
  );

  const handleUninstallModel = useCallback(
    async (entry: ModelCatalogEntry) => {
      const installer = installerFor("ollama");
      if (!installer) return;
      setManageError(null);
      setRemovingId(entry.id);
      try {
        await installer.uninstall(entry.id);
        // Selecting a model that is no longer installed would leave the
        // app pointing at nothing, so the choice is cleared with it.
        if (selectedModelId === entry.id) setSelectedModelId(null);
        await refreshCatalog();
      } catch (err) {
        setManageError(err instanceof Error ? err.message : String(err));
      } finally {
        setRemovingId(null);
      }
    },
    [refreshCatalog, selectedModelId, setSelectedModelId]
  );

  // Whenever the choice changes — which is exactly when someone has just
  // installed something and picked it.
  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog, selectedModelId]);

  useEffect(() => {
    new TauriSystemProfileReader()
      .read()
      .then(setSystemProfile)
      // Detection failing is a real, visible state — the catalog still
      // renders, just unannotated (DESIGN.md §5.3: no silent failures).
      .catch((error: unknown) =>
        setProfileError(error instanceof Error ? error.message : String(error))
      );
  }, []);

  const models = {
    catalog,
    systemProfile,
    profileError,
    skillLevel,
    setSkillLevel,
    showTooLarge,
    setShowTooLarge,
    selectedModelId,
    setSelectedModelId,
    keyedProviderIds,
    onAddKey: handleAddKey,
    onRemoveKey: handleRemoveKey,
    refreshCatalog,
    // Absent when Ollama is not running: there is nothing to install
    // into, so the buttons are not rendered rather than rendered and
    // failing when pressed.
    management: ollamaReachable
      ? {
          installingId,
          progress: installProgress,
          removingId,
          error: manageError,
          onInstall: (entry: ModelCatalogEntry) => void handleInstallModel(entry),
          onCancelInstall: () => installAbort.current?.abort(),
          onUninstall: (entry: ModelCatalogEntry) => void handleUninstallModel(entry),
        }
      : undefined,
  };

  return (
    <ThemeProvider theme="dark">
      <TooltipProvider>
        {!onboarded ? (
          <OnboardingFlow
            skillLevel={skillLevel}
            onSkillLevelChange={setSkillLevel}
            catalog={catalog}
            profile={systemProfile}
            showTooLarge={showTooLarge}
            onShowTooLargeChange={setShowTooLarge}
            selectedModelId={selectedModelId}
            onSelectModel={(entry) => setSelectedModelId(entry.id)}
            onComplete={() => setOnboarded(true)}
            management={models.management}
            byok={{
              keyedProviderIds,
              onAddKey: handleAddKey,
              onRemoveKey: handleRemoveKey,
            }}
          />
        ) : projectRoot ? (
          <Workspace
            projectRoot={projectRoot}
            models={models}
            initialBrief={pendingBrief}
          />
        ) : wizardRoot ? (
          <ProjectWizard
            projectRoot={wizardRoot}
            onSubmit={(brief) => {
              // Both at once: the workspace reads the brief on mount, so
              // it has to be set before the root that mounts it.
              setPendingBrief(brief);
              setProjectRoot(wizardRoot);
            }}
            onCancel={() => setWizardRoot(null)}
          />
        ) : (
          <OpenProjectScreen onOpen={setProjectRoot} onStartNew={setWizardRoot} />
        )}
      </TooltipProvider>
    </ThemeProvider>
  );
}

/**
 * Lets a connected provider actually be selected.
 *
 * Only rendered once a key exists — offering a model the app cannot
 * currently reach would be a control that looks live and is not.
 */
function ByokModelPicker({
  keyedProviderIds,
  selectedModelId,
  onSelect,
}: {
  keyedProviderIds: readonly string[];
  selectedModelId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {BYOK_PROVIDERS.filter((provider) => keyedProviderIds.includes(provider.id)).map(
        (provider) => {
          const id = `${provider.id}:${provider.defaultModelId}`;
          const active = selectedModelId === id;
          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => onSelect(id)}
              className={`flex items-center justify-between rounded-md border p-2.5 text-left text-xs transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                active
                  ? "border-accent bg-accent-muted text-text-primary"
                  : "border-border-subtle bg-surface-1 text-text-secondary hover:bg-surface-2"
              }`}
            >
              <span className="font-mono">{provider.defaultModelId}</span>
              <span className="text-text-tertiary">
                {active ? "In use" : `Use via ${provider.label}`}
              </span>
            </button>
          );
        }
      )}
    </div>
  );
}

interface ModelsState {
  catalog: ModelCatalog | null;
  systemProfile: SystemProfile | undefined;
  profileError: string | null;
  skillLevel: SkillLevel;
  setSkillLevel: (level: SkillLevel) => void;
  showTooLarge: boolean;
  setShowTooLarge: (show: boolean) => void;
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;
  keyedProviderIds: string[];
  onAddKey: (providerId: string, key: string) => Promise<void>;
  onRemoveKey: (providerId: string) => Promise<void>;
  refreshCatalog: () => Promise<void>;
  management: ModelManagement | undefined;
}

function OpenProjectScreen({
  onOpen,
  onStartNew,
}: {
  onOpen: (path: string) => void;
  onStartNew: (path: string) => void;
}) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    async (candidate: string) => {
      try {
        await openProject(candidate);
        onOpen(candidate);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [onOpen]
  );

  async function handleBrowse() {
    setError(null);
    try {
      const picked = await openFolderDialog();
      // Cancelling is an ordinary outcome, not an error.
      if (picked === null) return;
      // Fill the field as well as opening, so a rejected path is visible
      // rather than the failure appearing to come from nowhere.
      setPath(picked);
      await open(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Starting from nothing still needs a folder — the wizard has to say
   * where the files will land, and every write path is confined to a
   * project root. The folder picker can create one, so this is the same
   * two clicks as opening an existing project.
   */
  async function handleStartNew() {
    setError(null);
    try {
      const picked = await openFolderDialog();
      if (picked === null) return;
      // Opened here rather than after the wizard so a folder the backend
      // rejects fails now, before the user has filled in a form.
      await openProject(picked);
      onStartNew(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-surface-0 font-ui text-text-primary">
      <div className="flex w-96 flex-col gap-3">
        <h1 className="text-lg font-medium">Paleonyx Studio</h1>
        <p className="text-sm text-text-secondary">
          Open a project you already have, or describe something new and let
          Paleonyx build the first version.
        </p>
        <Button variant="primary" onClick={handleStartNew}>
          <Sparkles size={14} />
          Start something new
        </Button>
        <Button variant="secondary" onClick={handleBrowse}>
          <FolderOpen size={14} />
          Open an existing folder…
        </Button>
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <span className="h-px flex-1 bg-border-subtle" />
          or paste a path
          <span className="h-px flex-1 bg-border-subtle" />
        </div>
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && path.trim().length > 0) void open(path);
          }}
          placeholder="C:\path\to\project"
          className="rounded-md border border-border-subtle bg-surface-2 p-2 text-sm text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {error && <p className="text-sm text-status-danger">{error}</p>}
        <Button
          variant="secondary"
          onClick={() => void open(path)}
          disabled={path.trim().length === 0}
        >
          Open
        </Button>
      </div>
    </div>
  );
}

function Workspace({
  projectRoot,
  models,
  initialBrief = null,
}: {
  projectRoot: string;
  models: ModelsState;
  /**
   * Set when the workspace was reached through the new-project wizard.
   * The scaffold run starts on its own once a provider has settled —
   * the user already pressed a button to get here, and asking them to
   * press another one that says the same thing would be theatre.
   */
  initialBrief?: ProjectBrief | null;
}) {
  const fs = useMemo(() => new TauriFileSystem(), []);
  const {
    catalog,
    systemProfile,
    profileError,
    skillLevel,
    setSkillLevel,
    showTooLarge,
    setShowTooLarge,
    selectedModelId,
    setSelectedModelId,
    keyedProviderIds,
    onAddKey: handleAddKey,
    onRemoveKey: handleRemoveKey,
    refreshCatalog,
    management,
  } = models;

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  /**
   * All buffer state — contents, which files are open, what is unsaved —
   * lives in one tested value rather than several loosely-related pieces
   * of component state (see workspace-files.ts).
   */
  const [workspace, setWorkspace] = useState(EMPTY_WORKSPACE);
  const { openPaths, contents: fileContents, dirty: dirtyPaths } = workspace;

  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [taskType, setTaskType] = useState<AgentTaskType>("explain");
  const [instructions, setInstructions] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [result, setResult] = useState<AgentTaskResult | null>(null);
  const [budgetUsage, setBudgetUsage] = useState<BudgetUsage>(ZERO_BUDGET_USAGE);

  const [provider, setProvider] = useState<ChatModelProvider>(
    () =>
      new MockAdapter({
        respond: demoRespond,
        modelLabel: "Mock (no local model reachable)",
      })
  );

  const [activePanel, setActivePanel] = useState("files");
  const [providerResolved, setProviderResolved] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPort, setPreviewPort] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /**
   * Counter, not a flag: two writes in a row have to produce two
   * reloads, and a boolean would collapse them into one.
   */
  const [previewReloads, setPreviewReloads] = useState(0);
  const [designMode, setDesignModeOn] = useState(false);

  /**
   * Per project, not per user (CLAUDE.md §6): letting the agent write
   * freely in a scratch repo says nothing about wanting that in
   * production code. Keyed by path so each project keeps its own answer.
   */
  const [permissionMode, setPermissionMode] = useLocalPreference<PermissionMode>(
    `paleonyx.permissionMode:${projectRoot}`,
    DEFAULT_PERMISSION_MODE
  );

  /**
   * Whether the proposal already failed to fit when it arrived, meaning
   * the model misread the files rather than the user having changed them.
   */
  const [bornStale, setBornStale] = useState(false);
  /** The project's own convention files, discovered on open. */
  const [contextDocs, setContextDocs] = useState<ContextDocument[]>([]);
  const [docsEnabled, setDocsEnabled] = useLocalPreference(
    `paleonyx.followConventions:${projectRoot}`,
    true
  );
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  /** Object identity, not a number, so re-picking the same line re-jumps. */
  const [pendingReveal, setPendingReveal] = useState<{
    path: string;
    line: number;
  } | null>(null);

  const changeStore = useMemo(() => new TauriChangeStore(), []);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [undoingId, setUndoingId] = useState<string | undefined>();
  const [undoConflicts, setUndoConflicts] = useState<Record<string, string>>({});
  const [needsRepo, setNeedsRepo] = useState(false);

  useEffect(() => {
    listProjectFiles(fs).then(setFiles);
    // Best effort: a project with no conventions file is the common case,
    // not a failure.
    findContextDocuments(fs)
      .then(setContextDocs)
      .catch(() => setContextDocs([]));
  }, [fs, projectRoot]);

  const refreshHistory = useCallback(async () => {
    // A project that isn't a repo yet simply has no history — not an
    // error, and not a reason to prompt before the agent needs to write.
    const status = await getGitStatus();
    if (!status.isRepository) {
      setHistory([]);
      return;
    }
    setHistory(await loadHistory(changeStore));
  }, [changeStore]);

  useEffect(() => {
    refreshHistory().catch(() => setHistory([]));
  }, [refreshHistory, projectRoot]);

  // Opening the Models panel is the natural "show me what I have"
  // moment, and re-reading costs one call to localhost.
  useEffect(() => {
    if (activePanel === "models") void refreshCatalog();
  }, [activePanel, refreshCatalog]);

  // Dropping to read-only while a diff-producing task is selected would
  // leave the form on an option it now disables.
  useEffect(() => {
    if (!canProposeEdits(permissionMode) && taskType === "bug-fix") {
      setTaskType("explain");
    }
  }, [permissionMode, taskType]);

  /**
   * Takes the task result explicitly rather than reading it from state,
   * so auto-apply can run against a result the render has not yet seen.
   */
  async function applyResult(target: AgentTaskResult) {
    if (target.diff.length === 0) return;
    setApplyError(null);

    // The agent patches what is on disk, not what is in the editor. If a
    // target file has unsaved edits, applying would write over content
    // the user can still see in front of them — and the diff was computed
    // against a version that no longer reflects their intent either.
    const writable = checkWritable(workspace, target.diff);
    if (!writable.ok) {
      setApplyError(
        `Save your changes to ${writable.unsaved.join(
          ", "
        )} first — applying would overwrite them.`
      );
      return;
    }

    // Shadow history lives in the user's own .git (CLAUDE.md §10), so a
    // project without one needs a repo first. Creating it mutates their
    // folder, so it is offered explicitly rather than done quietly —
    // including under auto-apply, which skips the approval gate for
    // changes, not for creating a repository.
    const status = await getGitStatus();
    if (!status.isRepository) {
      setNeedsRepo(true);
      return;
    }

    setApplying(true);
    try {
      const record: AgentChangeRecord = {
        id: `${Date.now()}`,
        timestamp: new Date().toISOString(),
        taskType: target.plan.taskType,
        summary: target.plan.summary,
        diffs: target.diff,
      };
      const outcome = await applyAgentChange(changeStore, record);
      if (outcome.ok) {
        setApplied(true);
        await reloadChangedFiles(target.diff.map((d) => d.filePath));
        // A change can now add files, so the tree has to be re-read
        // rather than assumed unchanged.
        setFiles(await listProjectFiles(fs));
        await refreshHistory();
      } else {
        setApplyError(outcome.conflicts.map((c) => c.conflict.message).join(" "));
      }
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    } finally {
      setApplying(false);
    }
  }

  function handleApply() {
    if (result) void applyResult(result);
  }

  async function handleUndo(entry: HistoryEntry) {
    const touched = entry.record.diffs.map((d) => d.filePath);

    // Undo rewrites files just as apply does, so it needs the same
    // protection. Without it, undoing a change to a file the user is
    // mid-edit in would write over their unsaved work — the reverse of
    // what an undo is for.
    const writable = checkWritable(workspace, entry.record.diffs);
    if (!writable.ok) {
      setUndoConflicts((prev) => ({
        ...prev,
        [entry.record.id]: `Save your changes to ${writable.unsaved.join(
          ", "
        )} first — undoing would overwrite them.`,
      }));
      return;
    }

    setUndoingId(entry.record.id);
    setUndoConflicts((prev) => {
      const next = { ...prev };
      delete next[entry.record.id];
      return next;
    });
    try {
      const outcome = await revertAgentChange(changeStore, entry.record);
      if (outcome.ok) {
        await reloadChangedFiles(touched);
        // Undoing a creation removes the file; the tree must lose it too.
        setFiles(await listProjectFiles(fs));
        await refreshHistory();
      } else {
        setUndoConflicts((prev) => ({
          ...prev,
          [entry.record.id]: outcome.conflicts.map((c) => c.conflict.message).join(" "),
        }));
      }
    } catch (error) {
      setUndoConflicts((prev) => ({
        ...prev,
        [entry.record.id]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setUndoingId(undefined);
    }
  }

  /**
   * Refreshes buffers for the files a change actually wrote.
   *
   * Scoped to those paths deliberately. Reloading every open file would
   * pull unsaved edits out from under the user in files the agent never
   * touched — destroying work while running the code that exists to
   * protect it.
   */
  // Starts the local server the first time the panel is opened. Nothing
  // is served until the user asks for it — an idle listener on a
  // project they are only reading would be a surface with no purpose.
  useEffect(() => {
    if (!previewOpen) return;
    let cancelled = false;
    setPreviewError(null);
    startPreview()
      .then((info) => {
        if (!cancelled) setPreviewPort(info.port);
      })
      .catch((err) => {
        if (!cancelled) {
          setPreviewError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [previewOpen]);

  // The server outlives the panel being closed, so it is stopped when
  // the workspace goes away rather than on every toggle.
  useEffect(() => {
    return () => {
      void stopPreview();
    };
  }, []);

  /**
   * Design mode is a server setting, not a panel one: the selection
   * script is added as a page is served, so the frame has to be
   * reloaded for the change to take effect either way.
   */
  async function handleDesignModeChange(enabled: boolean) {
    try {
      await setDesignMode(enabled);
      setDesignModeOn(enabled);
      setPreviewReloads((count) => count + 1);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDesignChange(
    selection: DesignSelection,
    instruction: string
  ) {
    // Nothing to search for means the run would fail after spending a
    // model call, so say so instead of starting it.
    if (!isSelectionLocatable(selection)) {
      setStatusMessage(null);
      setPreviewError(
        "That element has no id, class, or text to find it by. Try clicking the button or heading itself rather than the space around it."
      );
      return;
    }
    setPreviewError(null);
    await runTaskWith({
      taskType: "design-change",
      instructions: composeDesignRequest(selection, instruction),
      // The page is the starting point; the agent reads further itself.
      targetFiles: [selection.page].filter(Boolean),
    });
  }

  const previewEntry = useMemo(
    () => findPreviewEntry(files.map((file) => file.path)),
    [files]
  );

  /**
   * Having no page to show and failing to serve one are different
   * states and read differently (DESIGN.md §5) — one is "this kind of
   * project has nothing to display", the other is "something broke".
   */
  const previewUnavailable = previewEntry
    ? null
    : describeMissingEntry(files.map((file) => file.path));

  async function reloadChangedFiles(changedPaths: string[]) {
    const refreshed: Record<string, string> = {};
    for (const path of changedPaths) {
      if (!openPaths.includes(path)) continue;
      refreshed[path] = await fs.readFile(path);
    }
    setWorkspace((prev) => refreshAfterWrite(prev, refreshed));
    setPreviewReloads((count) => count + 1);
  }

  function handleEditorChange(path: string, next: string) {
    setWorkspace((prev) => editBuffer(prev, path, next));
  }

  async function handleSearch(options: SearchOptions) {
    setSearching(true);
    try {
      setSearchResults(await searchProject(options));
    } catch {
      // An unreadable tree is not worth an error banner in a panel whose
      // empty state already reads as "nothing found".
      setSearchResults({ files: [], truncated: false, totalMatches: 0 });
    } finally {
      setSearching(false);
    }
  }

  async function handleOpenMatch(path: string, line: number) {
    await openFile(path);
    setPendingReveal({ path, line });
  }

  function addPathToContext(path: string) {
    setContextFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }

  const saveFile = useCallback(
    async (path: string) => {
      const content = fileContents[path];
      if (content === undefined) return;
      await saveUserEdits(new Map([[path, content]]));
      setWorkspace((prev) => markSaved(prev, path));
      setPreviewReloads((count) => count + 1);
    },
    [fileContents]
  );

  // Ctrl/Cmd+S saves the active file. Explicit rather than autosaving,
  // because an agent is also writing to these files: a save the user
  // didn't ask for could race a change they haven't reviewed yet.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (selectedPath) void saveFile(selectedPath);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedPath, saveFile]);

  async function handleInitRepo() {
    await initGitRepository();
    setNeedsRepo(false);
    await refreshHistory();
    await handleApply();
  }

  function closeTabGuarded(path: string) {
    // Closing a tab discards whatever is in its buffer. Silently losing
    // unsaved edits is the same failure as overwriting them, so confirm.
    if (dirtyPaths.has(path)) {
      const discard = window.confirm(
        `${path} has unsaved changes. Close it and discard them?`
      );
      if (!discard) return;
    }
    closeTab(path);
  }

  // Desktop is where local models are actually expected to run; still
  // never assumed silently — the status bar always names whichever
  // provider ended up active (DESIGN.md §1.8).
  useEffect(() => {
    let cancelled = false;

    // A BYOK selection is stored as "<providerId>:<modelId>", which is
    // enough to tell a remote choice from a local one without a second
    // preference to keep in sync.
    const remote = BYOK_PROVIDERS.find((p) => selectedModelId?.startsWith(`${p.id}:`));
    if (remote && selectedModelId) {
      const modelId = selectedModelId.slice(remote.id.length + 1);
      setProvider(
        new OpenAiCompatibleAdapter({
          provider: remote.id,
          baseUrl: remote.baseUrl,
          modelId,
          modelLabel: `${remote.label}: ${modelId}`,
          // Fetched per request and never held here, so the key does not
          // live in component state.
          getApiKey: () => getProviderKey(remote.id),
          appName: "Paleonyx Studio",
        })
      );
      setProviderResolved(true);
      return;
    }

    pingOllama().then((reachable) => {
      if (cancelled) return;
      // Settled either way: staying on the mock because nothing is
      // reachable is an answer, and anything waiting on the provider
      // needs to stop waiting rather than hang.
      setProviderResolved(true);
      if (!reachable) return;
      const modelId = selectedModelId ?? catalog?.installedIds[0];
      if (!modelId) return;
      // Capabilities come from Ollama's own report of this build, not
      // from what the model is documented to do (CLAUDE.md §4).
      const entry = catalog?.entries.find((e) => e.id === modelId);
      setProvider(
        new OllamaAdapter({
          modelId,
          modelLabel: `Ollama: ${modelId}`,
          contextWindow: entry?.contextWindow,
          supportsToolCalling: entry?.supportsToolCalling,
        })
      );
    });
    return () => {
      cancelled = true;
    };
  }, [selectedModelId, catalog]);

  async function openFile(path: string) {
    setSelectedPath(path);
    setWorkspace((prev) => openBuffer(prev, path));
    if (!(path in fileContents)) {
      const content = await fs.readFile(path);
      setWorkspace((prev) => openBuffer(prev, path, content));
    }
  }

  function closeTab(path: string) {
    setWorkspace((prev) => {
      const next = closeBuffer(prev, path);
      if (selectedPath === path) {
        setSelectedPath(next.openPaths[next.openPaths.length - 1]);
      }
      return next;
    });
  }

  function addSelectedToContext() {
    if (!selectedPath) return;
    setContextFiles((prev) => (prev.includes(selectedPath) ? prev : [...prev, selectedPath]));
  }

  function removeFromContext(path: string) {
    setContextFiles((prev) => prev.filter((p) => p !== path));
  }

  async function handleRunTask() {
    await runTaskWith({ taskType, instructions, targetFiles: contextFiles });
  }

  /**
   * Held in a ref rather than a dependency.
   *
   * The run reads most of the workspace — provider, permission mode,
   * context docs — so a useCallback over it would change identity on
   * nearly every render, and an effect depending on it would re-fire.
   * The ref keeps the effect's trigger narrow while still calling the
   * current version of the function rather than a stale closure.
   */
  const runTaskRef = useRef(runTaskWith);
  runTaskRef.current = runTaskWith;

  // Starts the scaffold run for a project created through the wizard.
  // Waits for the provider to settle, so the first thing a new user ever
  // sees is not the mock adapter's canned output.
  const scaffoldStarted = useRef(false);
  useEffect(() => {
    if (!initialBrief || !providerResolved || scaffoldStarted.current) return;
    scaffoldStarted.current = true;
    setTaskType("scaffold");
    void runTaskRef.current({
      taskType: "scaffold",
      instructions: composeProjectBrief(initialBrief),
      // Nothing to put in context: the point of this task is that there
      // is not any code yet.
      targetFiles: [],
    });
  }, [initialBrief, providerResolved]);

  async function runTaskWith(input: AgentTaskInput) {
    setResult(null);
    // A new proposal is not the previous one — without this reset the
    // fresh diff would render as though it had already been applied.
    setApplied(false);
    setApplyError(null);
    setBornStale(false);
    try {
      const taskResult = await runAgentTask({
        provider,
        fs,
        input,
        skillLevel,
        permissionMode,
        // Supplied unconditionally; agent-core decides whether the tool
        // is offered at all, based on the mode and the allowlist.
        runCommand: runProjectCommand,
        contextDocs: docsEnabled ? contextDocs : [],
        onStatus: setStatusMessage,
      });
      setResult(taskResult);
      setBudgetUsage(taskResult.budgetUsage);
      // Checked against the files as they are right now, before the user
      // has had any chance to touch them.
      setBornStale(isProposalStale(workspace, taskResult.diff));

      // Auto-apply skips the approval gate, nothing else: the plan and
      // diff above were still produced, and the change is still recorded
      // and undoable (CLAUDE.md §9).
      if (
        canApplyWithoutApproval(permissionMode) &&
        !taskResult.escalation &&
        taskResult.diff.length > 0
      ) {
        setStatusMessage("Applying…");
        await applyResult(taskResult);
      }
    } finally {
      setStatusMessage(null);
    }
  }

  const activeTab = selectedPath && openPaths.includes(selectedPath) ? selectedPath : openPaths[0];

  /**
   * Whether the current proposal still fits the files.
   *
   * Tested by actually running the patch against the current buffer
   * rather than by tracking edits — the same code that would perform the
   * apply decides whether it can, so the preview and the real attempt can
   * never disagree.
   */
  const proposalStale = useMemo(() => {
    if (!result || applied) return false;
    return isProposalStale(workspace, result.diff);
  }, [result, workspace, applied]);

  return (
    <div className="flex h-screen w-screen flex-col bg-surface-0 font-ui text-text-primary">
      <div className="flex min-h-0 flex-1">
        <ActivityBar
          items={[
            { id: "files", icon: <Files size={16} />, label: "Files" },
            { id: "search", icon: <Search size={16} />, label: "Search" },
            { id: "models", icon: <Boxes size={16} />, label: "Models" },
          ]}
          activeId={activePanel}
          onSelect={setActivePanel}
        />

        {activePanel === "models" ? (
          <div className="min-w-0 flex-1 overflow-auto p-4">
            <div className="mx-auto max-w-3xl">
              {profileError && (
                <p className="mb-3 rounded-md border border-status-danger/40 bg-status-danger/10 p-2.5 text-xs text-text-secondary">
                  Couldn&apos;t read this machine&apos;s hardware ({profileError}). Models
                  below are shown without fit estimates.
                </p>
              )}
              {catalog ? (
                <>
                  <ModelCatalogView
                    catalog={catalog}
                    profile={systemProfile}
                    showTooLarge={showTooLarge}
                    onShowTooLargeChange={setShowTooLarge}
                    activeModelId={selectedModelId ?? undefined}
                    onSelect={(entry) => setSelectedModelId(entry.id)}
                    onRefresh={refreshCatalog}
                    management={management}
                  />
                  <ByokSection
                    keyedProviderIds={keyedProviderIds}
                    onAddKey={handleAddKey}
                    onRemoveKey={handleRemoveKey}
                  />
                  {keyedProviderIds.length > 0 && (
                    <ByokModelPicker
                      keyedProviderIds={keyedProviderIds}
                      selectedModelId={selectedModelId}
                      onSelect={setSelectedModelId}
                    />
                  )}
                </>
              ) : (
                <p className="text-sm text-text-tertiary">Loading model catalog…</p>
              )}
            </div>
          </div>
        ) : (
          <>
        <div className="h-full w-64 shrink-0">
          {activePanel === "search" ? (
            <Panel title="Search">
              <SearchPanel
                onSearch={handleSearch}
                results={searchResults}
                searching={searching}
                onOpenMatch={handleOpenMatch}
                onAddToContext={addPathToContext}
                contextFiles={contextFiles}
              />
            </Panel>
          ) : (
            <Panel title="Explorer">
              <FileTree files={files} selectedPath={selectedPath} onSelect={openFile} />
            </Panel>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-end border-b border-border-subtle px-2 py-1">
            <IconButton
              icon={<MonitorPlay size={14} />}
              label={previewOpen ? "Hide preview" : "Show preview"}
              active={previewOpen}
              onClick={() => setPreviewOpen((open) => !open)}
            />
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
          {!activeTab || openPaths.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-sm text-text-tertiary">
              Select a file from the tree to open it.
            </div>
          ) : (
            <Tabs
              items={openPaths.map((path) => ({
                value: path,
                label: path.split("/").pop() ?? path,
                dirty: dirtyPaths.has(path),
              }))}
              value={activeTab}
              onValueChange={setSelectedPath}
              onClose={closeTabGuarded}
            >
              {openPaths.map((path) => (
                <TabPanel key={path} value={path} className="min-h-0 flex-1">
                  <CodeEditor
                    key={path}
                    language={files.find((f) => f.path === path)?.language}
                    value={fileContents[path] ?? ""}
                    onChange={(next) => handleEditorChange(path, next)}
                    reveal={pendingReveal?.path === path ? pendingReveal : null}
                  />
                </TabPanel>
              ))}
            </Tabs>
          )}
            </div>
            {previewOpen && (
              // Beside the editor rather than in a tab: seeing the change
              // and the result at once is the whole point, and a tab
              // would make them alternatives. Given the full width when
              // no file is open, which is the state a freshly scaffolded
              // project starts in.
              <div
                className={`min-w-0 border-l border-border-subtle ${
                  openPaths.length === 0 ? "flex-1" : "w-[30rem] shrink-0"
                }`}
              >
                <PreviewPanel
                  url={
                    previewPort && previewEntry
                      ? previewUrl(previewPort, previewEntry.path)
                      : null
                  }
                  entryPath={previewEntry?.path ?? null}
                  unavailableReason={previewUnavailable}
                  error={previewError}
                  reloadToken={previewReloads}
                  designMode={designMode}
                  onDesignModeChange={(on) => void handleDesignModeChange(on)}
                  onDesignChange={(selection, instruction) =>
                    void handleDesignChange(selection, instruction)
                  }
                  busy={statusMessage !== null}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex h-full w-96 shrink-0 flex-col gap-3 overflow-auto border-l border-border-subtle p-3">
          {needsRepo && (
            <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3">
              <p className="text-sm font-medium text-text-primary">
                This folder isn&apos;t a git repository yet
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                Paleonyx keeps a record of every change it makes so you can undo
                it. That record lives in a git repository, on a separate branch
                that never touches your own commits or working tree. Creating
                one here adds a <code className="font-mono">.git</code> folder.
              </p>
              <div className="mt-2 flex gap-2">
                <Button variant="primary" size="sm" onClick={handleInitRepo}>
                  Create repository and apply
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setNeedsRepo(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <AgentPanel
            skillLevel={skillLevel}
            onSkillLevelChange={setSkillLevel}
            contextFiles={contextFiles}
            onRemoveContextFile={removeFromContext}
            onAddContextFile={addSelectedToContext}
            taskType={taskType}
            onTaskTypeChange={setTaskType}
            instructions={instructions}
            onInstructionsChange={setInstructions}
            onSubmit={handleRunTask}
            statusMessage={statusMessage}
            result={result}
            onApply={handleApply}
            applying={applying}
            applied={applied}
            applyError={applyError}
            stale={proposalStale}
            bornStale={bornStale}
            onRerun={handleRunTask}
            canProposeEdits={canProposeEdits(permissionMode)}
            projectDocs={contextDocs.map((doc) => ({
              path: doc.path,
              truncated: doc.truncated,
            }))}
            docsEnabled={docsEnabled}
            onDocsEnabledChange={setDocsEnabled}
            commandsUnavailableReason={
              canRunCommands(permissionMode) &&
              !provider.model.capabilities.supportsToolCalling
                ? `${provider.model.label} can't call tools, so it won't run commands even though this project allows them. It can still explain and fix code — pick a model marked "can run commands" if you want it running tests.`
                : null
            }
          />

          <Panel title="History">
            <Timeline
              entries={history}
              onUndo={handleUndo}
              busyId={undoingId}
              conflictById={undoConflicts}
            />
          </Panel>
        </div>
          </>
        )}
      </div>

      <StatusBar
        modelLabel={provider.model.label}
        permissionMode={permissionMode}
        onPermissionModeChange={setPermissionMode}
        budgetUsage={budgetUsage}
        budgetLimits={DEFAULT_BUDGET_LIMITS}
        indexedFileCount={files.length}
        unsavedCount={dirtyPaths.size}
      />
    </div>
  );
}
