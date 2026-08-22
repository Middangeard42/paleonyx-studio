import { useEffect, useMemo, useState } from "react";
import { Boxes, Files } from "lucide-react";
import {
  ActivityBar,
  AgentPanel,
  ByokSection,
  FileTree,
  ModelCatalogView,
  OnboardingFlow,
  Panel,
  StatusBar,
  TabPanel,
  Tabs,
  ThemeProvider,
  TooltipProvider,
  useLocalPreference,
} from "@paleonyx/ui";
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
  AgentTaskResult,
  AgentTaskType,
  BudgetUsage,
  ModelCatalog,
  ProjectFile,
  SkillLevel,
} from "@paleonyx/shared-types";
import { InMemoryFileSystem } from "./demo-project.js";


const ZERO_BUDGET_USAGE: BudgetUsage = { toolCalls: 0, tokens: 0 };

export function App() {
  const fs = useMemo(() => new InMemoryFileSystem(), []);

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});

  // Persisted, not per-session: skill level is a per-user preference
  // (CLAUDE.md §5), and DEFAULT_SKILL_LEVEL exists only as the
  // pre-onboarding fallback, never as a value a real session silently
  // runs under.
  const [skillLevel, setSkillLevel] = useLocalPreference<SkillLevel>(
    "paleonyx.skillLevel",
    DEFAULT_SKILL_LEVEL
  );
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [taskType, setTaskType] = useState<AgentTaskType>("explain");
  const [instructions, setInstructions] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [result, setResult] = useState<AgentTaskResult | null>(null);
  const [budgetUsage, setBudgetUsage] = useState<BudgetUsage>(ZERO_BUDGET_USAGE);

  const [provider, setProvider] = useState<ChatModelProvider>(
    () => new MockAdapter({ respond: demoRespond, modelLabel: "Mock (offline demo)" })
  );

  const [activePanel, setActivePanel] = useState("files");
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [showTooLarge, setShowTooLarge] = useLocalPreference(
    "paleonyx.models.showTooLarge",
    false
  );
  const [onboarded, setOnboarded] = useLocalPreference(
    "paleonyx.onboarding.completed",
    false
  );
  const [selectedModelId, setSelectedModelId] = useLocalPreference<string | null>(
    "paleonyx.selectedModelId",
    null
  );

  useEffect(() => {
    listProjectFiles(fs).then(setFiles);
  }, [fs]);

  useEffect(() => {
    loadModelCatalog().then(setCatalog);
  }, []);

  // Local-first is a visible property (DESIGN.md §1.8): if a real Ollama
  // instance is reachable, prefer it; the status bar always shows which
  // provider is actually active either way, never silently.
  useEffect(() => {
    let cancelled = false;
    pingOllama().then((reachable) => {
      if (!reachable || cancelled) return;
      // The user's explicit choice wins; otherwise fall back to whatever
      // is genuinely installed rather than guessing at a model name that
      // may not be present.
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

  if (!onboarded) {
    return (
      <ThemeProvider theme="dark">
        <TooltipProvider>
          <OnboardingFlow
            skillLevel={skillLevel}
            onSkillLevelChange={setSkillLevel}
            catalog={catalog}
            profile={undefined}
            showTooLarge={showTooLarge}
            onShowTooLargeChange={setShowTooLarge}
            selectedModelId={selectedModelId}
            onSelectModel={(entry) => setSelectedModelId(entry.id)}
            onComplete={() => setOnboarded(true)}
          />
        </TooltipProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme="dark">
      <TooltipProvider>
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
                  {catalog ? (
                    <>
                      <ModelCatalogView
                        catalog={catalog}
                        // Browsers have no hardware detection, so entries
                        // render unannotated rather than guessed at.
                        profile={undefined}
                        showTooLarge={showTooLarge}
                        onShowTooLargeChange={setShowTooLarge}
                        activeModelId={selectedModelId ?? undefined}
                        onSelect={(entry) => setSelectedModelId(entry.id)}
                      />
                      {/* No credential storage in a browser, so this
                          explains rather than offering a form it cannot
                          honour (CLAUDE.md §4.2). */}
                      <ByokSection
                        keyedProviderIds={[]}
                        onAddKey={async () => {}}
                        onRemoveKey={async () => {}}
                        available={false}
                      />
                    </>
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
                  items={openPaths.map((path) => ({ value: path, label: path.split("/").pop() ?? path }))}
                  value={activeTab}
                  onValueChange={setSelectedPath}
                  onClose={closeTab}
                >
                  {openPaths.map((path) => (
                    <TabPanel key={path} value={path} className="min-h-0 flex-1 data-[state=inactive]:hidden">
                      <CodeEditor
                        key={path}
                        language={files.find((f) => f.path === path)?.language}
                        value={fileContents[path] ?? ""}
                        // Edits live in the in-memory demo project only —
                        // this harness has no filesystem to save to. The
                        // desktop app is where saving is real.
                        onChange={(next) =>
                          setFileContents((prev) => ({ ...prev, [path]: next }))
                        }
                      />
                    </TabPanel>
                  ))}
                </Tabs>
              )}
            </div>

            <div className="h-full w-96 shrink-0 overflow-auto border-l border-border-subtle p-3">
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
              />
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
          />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}
