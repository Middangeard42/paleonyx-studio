import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Files } from "lucide-react";
import {
  ActivityBar,
  AgentPanel,
  Button,
  FileTree,
  ModelCatalogView,
  OnboardingFlow,
  Panel,
  StatusBar,
  TabPanel,
  Tabs,
  ThemeProvider,
  Timeline,
  TooltipProvider,
  useLocalPreference,
} from "@paleonyx/ui";
import {
  applyAgentChange,
  applyFileDiff,
  loadHistory,
  revertAgentChange,
} from "@paleonyx/vcs";
import { CodeEditor } from "@paleonyx/editor";
import { listProjectFiles } from "@paleonyx/indexing";
import { DEFAULT_BUDGET_LIMITS, runAgentTask } from "@paleonyx/agent-core";
import {
  MockAdapter,
  OllamaAdapter,
  demoRespond,
  loadModelCatalog,
  pingOllama,
} from "@paleonyx/runtime";
import type { ChatModelProvider } from "@paleonyx/runtime";
import {
  DEFAULT_PERMISSION_MODE,
  DEFAULT_SKILL_LEVEL,
} from "@paleonyx/shared-types";
import type {
  AgentChangeRecord,
  AgentTaskResult,
  AgentTaskType,
  BudgetUsage,
  HistoryEntry,
  ModelCatalog,
  ProjectFile,
  SkillLevel,
  SystemProfile,
} from "@paleonyx/shared-types";
import { TauriFileSystem, openProject } from "./tauri-filesystem.js";
import { TauriSystemProfileReader } from "./tauri-system-profile.js";
import {
  TauriChangeStore,
  getGitStatus,
  initGitRepository,
  saveUserEdits,
} from "./tauri-change-store.js";

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
  const [onboarded, setOnboarded] = useLocalPreference(
    "paleonyx.onboarding.completed",
    false
  );

  useEffect(() => {
    loadModelCatalog().then(setCatalog);
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
          />
        ) : projectRoot ? (
          <Workspace projectRoot={projectRoot} models={models} />
        ) : (
          <OpenProjectScreen onOpen={setProjectRoot} />
        )}
      </TooltipProvider>
    </ThemeProvider>
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
}

function OpenProjectScreen({ onOpen }: { onOpen: (path: string) => void }) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleOpen() {
    try {
      await openProject(path);
      onOpen(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-surface-0 font-ui text-text-primary">
      <div className="flex w-96 flex-col gap-3">
        <h1 className="text-lg font-medium">Open a project</h1>
        <p className="text-sm text-text-secondary">
          Paste an absolute path to a folder. (A native folder picker is a
          near-term follow-up — v0 keeps this to the one path this app
          actually needs, per CLAUDE.md's "no speculative abstraction.")
        </p>
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="C:\path\to\project"
          className="rounded-md border border-border-subtle bg-surface-2 p-2 text-sm text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {error && <p className="text-sm text-status-danger">{error}</p>}
        <Button variant="primary" onClick={handleOpen} disabled={path.trim().length === 0}>
          Open
        </Button>
      </div>
    </div>
  );
}

function Workspace({
  projectRoot,
  models,
}: {
  projectRoot: string;
  models: ModelsState;
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
  } = models;

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});

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
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());

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

  async function handleApply() {
    if (!result || result.diff.length === 0) return;
    setApplyError(null);

    // The agent patches what is on disk, not what is in the editor. If a
    // target file has unsaved edits, applying would write over content
    // the user can still see in front of them — and the diff was computed
    // against a version that no longer reflects their intent either.
    const unsaved = unsavedAmong(result.diff.map((d) => d.filePath));
    if (unsaved.length > 0) {
      setApplyError(
        `Save your changes to ${unsaved.join(", ")} first — applying would overwrite them.`
      );
      return;
    }

    // Shadow history lives in the user's own .git (CLAUDE.md §10), so a
    // project without one needs a repo first. Creating it mutates their
    // folder, so it is offered explicitly rather than done quietly.
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
        taskType: result.plan.taskType,
        summary: result.plan.summary,
        diffs: result.diff,
      };
      const outcome = await applyAgentChange(changeStore, record);
      if (outcome.ok) {
        setApplied(true);
        await reloadChangedFiles(result.diff.map((d) => d.filePath));
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

  async function handleUndo(entry: HistoryEntry) {
    const touched = entry.record.diffs.map((d) => d.filePath);

    // Undo rewrites files just as apply does, so it needs the same
    // protection. Without it, undoing a change to a file the user is
    // mid-edit in would write over their unsaved work — the reverse of
    // what an undo is for.
    const unsaved = unsavedAmong(touched);
    if (unsaved.length > 0) {
      setUndoConflicts((prev) => ({
        ...prev,
        [entry.record.id]: `Save your changes to ${unsaved.join(
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
  async function reloadChangedFiles(changedPaths: string[]) {
    const refreshed: Record<string, string> = {};
    for (const path of changedPaths) {
      if (!openPaths.includes(path)) continue;
      refreshed[path] = await fs.readFile(path);
    }
    setFileContents((prev) => ({ ...prev, ...refreshed }));
    setDirtyPaths((prev) => {
      const next = new Set(prev);
      // Only these files now match disk. Anything else the user was
      // editing is still outstanding and stays marked.
      for (const path of changedPaths) next.delete(path);
      return next;
    });
  }

  /** Files with unsaved edits that a change is about to overwrite. */
  function unsavedAmong(paths: string[]): string[] {
    return [...new Set(paths)].filter((path) => dirtyPaths.has(path));
  }

  function handleEditorChange(path: string, next: string) {
    setFileContents((prev) => ({ ...prev, [path]: next }));
    setDirtyPaths((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }

  const saveFile = useCallback(
    async (path: string) => {
      const content = fileContents[path];
      if (content === undefined) return;
      await saveUserEdits(new Map([[path, content]]));
      setDirtyPaths((prev) => {
        if (!prev.has(path)) return prev;
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
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
      setDirtyPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
    closeTab(path);
  }

  // Desktop is where local models are actually expected to run; still
  // never assumed silently — the status bar always names whichever
  // provider ended up active (DESIGN.md §1.8).
  useEffect(() => {
    let cancelled = false;
    pingOllama().then((reachable) => {
      if (!reachable || cancelled) return;
      const modelId = selectedModelId ?? catalog?.installedIds[0];
      if (!modelId) return;
      setProvider(new OllamaAdapter({ modelId, modelLabel: `Ollama: ${modelId}` }));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedModelId, catalog]);

  async function openFile(path: string) {
    setSelectedPath(path);
    setOpenPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
    if (!(path in fileContents)) {
      const content = await fs.readFile(path);
      setFileContents((prev) => ({ ...prev, [path]: content }));
    }
  }

  function closeTab(path: string) {
    setOpenPaths((prev) => {
      const next = prev.filter((p) => p !== path);
      if (selectedPath === path) {
        setSelectedPath(next[next.length - 1]);
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
    setResult(null);
    // A new proposal is not the previous one — without this reset the
    // fresh diff would render as though it had already been applied.
    setApplied(false);
    setApplyError(null);
    try {
      const taskResult = await runAgentTask({
        provider,
        fs,
        input: { taskType, instructions, targetFiles: contextFiles },
        skillLevel,
        onStatus: setStatusMessage,
      });
      setResult(taskResult);
      setBudgetUsage(taskResult.budgetUsage);
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
    if (!result || result.diff.length === 0 || applied) return false;
    return result.diff.some((diff) => {
      const content = fileContents[diff.filePath];
      // Not open in a buffer means nothing to compare against; the apply
      // itself will read from disk and report honestly if it conflicts.
      if (content === undefined) return false;
      return !applyFileDiff(content, diff).ok;
    });
  }, [result, fileContents, applied]);

  return (
    <div className="flex h-screen w-screen flex-col bg-surface-0 font-ui text-text-primary">
      <div className="flex min-h-0 flex-1">
        <ActivityBar
          items={[
            { id: "files", icon: <Files size={16} />, label: "Files" },
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
                <ModelCatalogView
                  catalog={catalog}
                  profile={systemProfile}
                  showTooLarge={showTooLarge}
                  onShowTooLargeChange={setShowTooLarge}
                  activeModelId={selectedModelId ?? undefined}
                  onSelect={(entry) => setSelectedModelId(entry.id)}
                />
              ) : (
                <p className="text-sm text-text-tertiary">Loading model catalog…</p>
              )}
            </div>
          </div>
        ) : (
          <>
        <div className="h-full w-56 shrink-0">
          <Panel title="Explorer">
            <FileTree files={files} selectedPath={selectedPath} onSelect={openFile} />
          </Panel>
        </div>

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
                  />
                </TabPanel>
              ))}
            </Tabs>
          )}
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
            onRerun={handleRunTask}
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
        permissionMode={DEFAULT_PERMISSION_MODE}
        budgetUsage={budgetUsage}
        budgetLimits={DEFAULT_BUDGET_LIMITS}
        indexedFileCount={files.length}
        unsavedCount={dirtyPaths.size}
      />
    </div>
  );
}
