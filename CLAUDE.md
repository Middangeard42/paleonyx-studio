# CLAUDE.md — Engineering Conventions for Paleonyx Studio

Status: draft, awaiting approval

This file governs how code is written in this repository — by humans and by
AI agents (including Claude Code sessions) working in it. It is binding for
any agent-driven change. Where this file and ad hoc judgment conflict,
follow this file and flag the conflict rather than silently deviating.

Companion documents: [`DESIGN.md`](DESIGN.md) (visual/interaction rules),
[`PRD.md`](PRD.md) (product scope and journeys). Architecture decisions here
assume the stack proposed in DESIGN.md §4 pending final approval; if that
changes, this file is updated in the same pass.

---

## 1. Project Overview

Paleonyx Studio is a local-first AI IDE. Four concerns must stay strictly
separated because they have different trust boundaries, release cadences,
and failure modes:

- **UI** — renders state, captures intent, never decides policy.
- **Agent** — plans and executes tool calls under explicit permission and
  budget rules; never touches the filesystem or a process directly.
- **Runtime** — model/provider abstraction; knows nothing about UI or
  agent policy, only "given messages + tools, produce a response."
- **Indexing** — builds and serves the project's file/AST/semantic index;
  read-only with respect to source files, never triggers writes.

If you're about to import across these boundaries in a direction not listed
in §3, stop and reconsider the change instead.

---

## 2. Proposed Repository Structure

```
paleonyx-studio/
├── apps/
│   ├── desktop/          # Tauri shell + desktop-only glue (window mgmt,
│   │                     # native menus, OS integration, local server boot)
│   └── web/               # Companion web UI, connects to local backend
│                           # over the same API the desktop app uses
├── packages/
│   ├── ui/                 # Design system: tokens, primitives, IDE-specific
│   │                        # components (file tree, diff viewer, task
│   │                        # plan card, permission indicator, timeline)
│   ├── editor/              # Monaco integration layer (LSP wiring, theming
│   │                         # bridge to design tokens, keybinding map)
│   ├── agent-core/          # Planning, tool-execution loop, permission
│   │                         # gating, budget enforcement, metacognition
│   │                         # (pause/escalate) logic — UI-agnostic
│   ├── runtime/              # Model/provider abstraction (OpenAI-compatible
│   │                          # interface), adapters per provider
│   │   └── adapters/
│   │       ├── ornith/        # Primary recommended local model
│   │       ├── ollama/
│   │       ├── lmstudio/
│   │       ├── llamacpp/
│   │       ├── gpt4all/
│   │       ├── openrouter/    # BYOK aggregator adapter (§4)
│   │       └── groq/          # BYOK aggregator adapter (§4)
│   ├── indexing/              # File watching, AST parsing (per language),
│   │                          # embeddings, semantic search
│   ├── system-profile/        # Desktop-only hardware detection (RAM, CPU
│   │                          # cores, GPU/VRAM, OS) backing the model
│   │                          # catalog's hardware-fit annotations (§4) —
│   │                          # read-only, native-backed, no fallback
│   │                          # fabrication on web (§9)
│   ├── vcs/                   # Git-backed shadow history for agent
│   │                          # changes: commit-per-change, diff/undo API
│   ├── mcp-client/             # MCP tool integration layer
│   ├── skills/                # Reusable task-template/workflow definitions
│   └── shared-types/           # Cross-package TS types / schemas (source
│                                # of truth for wire formats)
├── DESIGN.md
├── CLAUDE.md
└── PRD.md
```

Rules for this structure:
- `packages/agent-core` and `packages/runtime` must never import from
  `packages/ui`, `apps/desktop`, or `apps/web`. Dependency direction is
  apps → packages, never the reverse.
- `packages/indexing` must never write to project files. It reads,
  watches, and serves an index; mutation is exclusively the agent's
  job, through `vcs`.
- Any filesystem write or shell command reachable by the agent must route
  through a single, auditable tool-execution surface in `agent-core`
  (see §6) — no package outside it calls `fs.write`/`child_process`
  on behalf of the agent, ever.
- Mobile remote-control (future) is a thin client of the same local
  backend `apps/desktop` exposes — not a fork of app logic.

---

## 3. Naming & Coding Conventions

**General**
- TypeScript everywhere on the app/UI/orchestration side; Rust for the
  Tauri shell and any performance-sensitive local operations (file
  watching, AST parsing where a native parser is warranted).
- TypeScript: `strict: true`, no `any` without an inline justification
  comment, no unchecked type assertions across package boundaries —
  validate at the boundary (parse, don't just cast).
- Functional React components only; no class components. Hooks are named
  `useX`; components are `PascalCase`; files match their default export's
  name.
- Rust: standard `rustfmt` + `clippy` clean (no `#[allow]` without a
  one-line reason comment).

**Naming**
- Files: `kebab-case.ts` / `kebab-case.tsx`, except component files which
  match the component name (`DiffViewer.tsx`).
- Types/interfaces describing wire formats live in `shared-types` and are
  named for the concept, not the transport (`AgentPlan`, not
  `AgentPlanResponseDTO`).
- Tool definitions (agent-callable actions) are named as verbs:
  `readFile`, `applyDiff`, `runCommand`, `searchIndex`.

**General engineering discipline (applies to humans and agents alike)**
- No speculative abstraction — build the thing that's needed, not the
  thing that might be needed. Three similar call sites beat a premature
  shared helper.
- No backwards-compatibility shims, feature flags, or "removed" comments
  for code that can simply be deleted pre-v1. This is a new codebase;
  there is no legacy to preserve yet.
- No silent catch blocks. An error is either handled meaningfully (with a
  visible state change per DESIGN.md §5.3) or allowed to propagate.
- Validate only at real boundaries: user input, tool-call arguments,
  provider responses, on-disk file reads. Do not defensively re-validate
  data that internal, typed code already guarantees.

---

## 4. Model / Runtime Layer Rules

- The runtime package exposes a single OpenAI-compatible interface
  (`chat.completions`-shaped, streaming-capable, tool-calling-capable)
  regardless of backend.
- Every provider (Ornith-1 default, Ollama, LM Studio, llama.cpp,
  GPT4All, and any future remote provider) is an adapter implementing that
  interface — adding a provider must never require changes to
  `agent-core` or `ui`.
- Provider capability differences (context length, tool-calling support,
  vision, streaming) are declared as adapter metadata and surfaced to the
  UI/agent as capability flags, not discovered by trial and error at
  runtime.
- Local-first default: no network call leaves the machine unless the
  active provider is explicitly configured as remote by the user. The
  runtime layer is the single choke point responsible for this guarantee
  — it's the place a network-boundary audit checks first.

### 4.1 Model Catalog & System Profile

- The **model catalog** (what's browsable/installable, distinct from
  `ModelInfo`/`ModelCapabilities` which describe a single *configured*
  provider) is sourced hybrid per PRD.md §9 decision 5: a bundled,
  release-versioned list is the offline-safe baseline; a background live
  refresh is attempted when reachable. Whichever source produced what the
  user is looking at must be visibly labeled — this is one of exactly two
  sanctioned exceptions to the no-unintended-egress bar (PRD.md §6), and
  the UI-legibility requirement is what keeps it sanctioned rather than
  silent.
- **Status: the live half is not built.** Ollama publishes no public API
  for its model *library*, only for what is already installed locally, so
  a real live refresh needs a Paleonyx-hosted index that doesn't exist
  yet. What ships today is the bundled baseline merged with the local
  Ollama install list — all on localhost, nothing leaving the machine, so
  the labeling rule above isn't yet in play. `loadModelCatalog` never
  returns `source: "live"`. Building that index is what turns this
  decision from partially- to fully-implemented; until then the UI
  correctly labels every view as bundled.
- The catalog is never trimmed to a curated shortlist *in code* — the
  full set the source (bundled or live) returns is always fetched and
  held in state. The one UI-level exception is DESIGN.md §6.3's default
  collapse of "too large" entries behind a visible, one-click "Show N
  too-large models" toggle — that's a render-time default in `ui`/the
  app, not a filter applied before data reaches the app, and the toggled
  state must be a real count of real entries, never a vague "more
  available" placeholder.
- **System Profile** (`packages/system-profile`) is a read-only,
  desktop-only capability: RAM, CPU core count, GPU/VRAM where
  detectable, OS. It has exactly one consumer relationship worth naming —
  the model catalog UI uses it to annotate entries ("fits comfortably" /
  "will be slow" / "likely too large") and to drive the too-large
  default-collapse above — and no write capability at all. `apps/web` has
  no equivalent; it shows the catalog unannotated (and never collapses
  anything, since it has no fit signal to collapse by) rather than
  fabricating a profile, per DESIGN.md's real-states-only discipline (§5).

### 4.2 Bring-Your-Own-Key (BYOK) Remote Providers

- v1 ships exactly two BYOK providers — OpenRouter and Groq (PRD.md §9
  decision 6) — implementing the same `ChatModelProvider` interface as
  every local adapter. Nothing about agent-core or ui needs to know a
  given provider is remote versus local; that distinction is entirely a
  `ModelCapabilities.isLocal` flag plus the always-visible status-bar
  legibility DESIGN.md requires.
- They share **one** adapter, `OpenAiCompatibleAdapter`, because both
  speak the OpenAI chat-completions shape — as does most of the field.
  For anything OpenAI-compatible, adding a provider is now a
  configuration entry, not a new file: it touches neither agent-core, nor
  ui, nor runtime.
- **API keys are never stored in plaintext**, in a config file or
  anywhere else the app's own on-disk state touches. Desktop uses
  OS-native secure storage via the `keyring` crate (Windows Credential
  Manager / macOS Keychain / Linux Secret Service), not a hand-rolled
  encryption scheme. `apps/web` has no durable local storage story for
  this yet — key entry on web either proxies to a running desktop session
  or is out of scope until that's designed; never falls back to
  `localStorage` for a credential. Today web renders an explanation in
  place of the key form rather than offering one it cannot honour.
- The credential commands take a **provider allowlist**, not a free-form
  service name. They are reachable from the webview, and without it a bug
  there could read or overwrite unrelated entries in the user's
  credential store — including ones belonging to other applications.
- **Keys are read per request and never cached.** `getApiKey` is a
  callback on the remote adapter rather than a value, so a key is
  fetched at the moment it is used and no copy is parked in application
  state. Known limit, recorded rather than left implicit: the key does
  cross into the webview for the duration of a request. Keeping it out
  of JS entirely means proxying model requests through Rust, which puts
  an HTTP client and a streaming bridge in the shell — worth doing as
  hardening, not done yet.
- **Provider errors must not echo the response body on 401/403.** Some
  providers include part of the submitted key in a rejection, and error
  strings end up in logs.
- Adding a key is the explicit, visible opt-in CLAUDE.md §4's local-first
  default requires for that one provider — it never implicitly enables
  any other remote provider, and removing a key is symmetric (immediate,
  no confirmation dance beyond a normal destructive-ish action).
- BYOK provider entries in Settings link to that provider's own
  key-creation page and a short setup note (content lives in `ui`/app
  copy, not hardcoded into `runtime` — the adapter shouldn't need to
  change if the instructions get clearer).

### 4.3 The Preview Server

- Previewing the user's project needs the shell to *serve* files, which
  is the one inbound network surface in the app. It is not covered by
  the egress rule in §4 — nothing leaves the machine — but it is a
  listening socket, so its properties are fixed rather than incidental:
  bound to `127.0.0.1` and never a routable address; `GET`/`HEAD` only,
  so it can never become a second write path; and every request resolved
  through the same `resolve_within_root` the file commands use, so it
  cannot be walked out of the opened project. Those properties have
  tests in `preview.rs`, and the traversal one is verified by confirming
  a file outside the project leaks when the guard is removed.
- It starts only when the user opens the panel, and is not a general
  static server: no directory listings, no upload, no configuration.
- Two Windows behaviours it has already been bitten by, each with a
  test: an accepted socket inherits the listener's non-blocking mode, so
  connections are switched back to blocking before being read; and
  `TcpStream::try_clone` returns an *inheritable* socket, so a process
  started meanwhile held the connection open. Never clone a socket here.
- *What* to preview is decided in TypeScript (`findPreviewEntry`), not
  in the server, for the same reason the command allowlist lives in
  `agent-core` — the shell is mechanism, and judgement belongs where it
  can be read and tested.
- Previewed pages run in a sandboxed frame without `allow-same-origin`.
  The project being previewed is often code a model proposed and the
  user has not read closely; it must not be able to reach the app's own
  origin.

---

## 5. Skill-Level Adaptation

Per PRD.md §2/§4, adapting to the user's coding skill level is a headline
product requirement, not a UI nicety layered on top — so it is modeled as a
first-class concept in `agent-core`, alongside permission mode and budgets.

- `SkillLevel` is a typed value in `shared-types` (`new-to-coding |
  experienced | professional` — renamed from `comfortable` per PRD.md §9
  decision 4), set per user (not per project — a developer's skill
  doesn't reset when they switch repos) and stored alongside other local
  user preferences. Chosen explicitly during first-run onboarding
  (PRD.md §3 journey 1); the default value in code exists only as the
  pre-onboarding fallback, never as an unasked default a real session
  runs under.
- `agent-core` reads the current `SkillLevel` when constructing prompts and
  when formatting plans/diffs/explanations — it changes verbosity and
  teaching depth, never capability. The same tools, the same task types,
  and the same underlying model are available at every level.
- This lives in `agent-core`, not `runtime`: it's a prompt-construction and
  response-shaping concern, applied uniformly regardless of which model
  provider is active, so switching providers never changes how the app
  teaches.
- Implementation must not special-case skill level deep inside individual
  tool implementations — it's applied at the plan/response formatting
  layer so it stays consistent and auditable in one place (mirrors the
  dependency-direction discipline in §2).

## 6. Agent Actions: Review, Diff & Undo Requirements

This is the most important section in this file. Get it wrong and the
product's core trust promise breaks.

- **Default mode is suggest-only.** The agent proposes; it does not write.
  Auto-apply is opt-in per project, requires explicit enablement with a
  visible warning (per DESIGN.md permission indicator), and remains
  visible in the status bar for the entire session it's active.
- **Every proposed change is a structured plan before it's an edit**: target
  files, the tool calls it intends to make, and a plain-language summary.
  This plan is what the UI's Task Plan Card renders — it is not
  reconstructed from prose after the fact.
- **Every applied write is a git commit in a shadow/agent history layer**,
  scoped so it can be reviewed and reverted independently of the user's
  own commits. One logical agent change = one revertible unit, even if it
  touches multiple files.
- **Undo is never destructive to unrelated work.** Reverting an agent
  change must not be implemented as a blunt `git reset`; it must
  selectively undo that change's diff, preserving anything else that
  happened since (including further edits to the same file, when
  possible — flag a conflict rather than silently clobbering).
- **Command execution is allowlisted, not unrestricted.** The agent may
  only run commands the current permission mode and project config permit;
  arbitrary shell execution is never implicitly available just because a
  model requests it. Three properties make that real rather than nominal:
  - **No shell, ever.** Program and arguments stay separate from the tool
    schema down to the process spawn. With `sh -c`/`cmd /c`, one
    allowlisted-looking string could carry `;`, `&&`, or backticks and
    run anything.
  - **Allowlist entries match an argument *prefix*, not a program name.**
    Permitting bare `node` or `python` permits `node -e`/`python -c`,
    which is arbitrary execution wearing a familiar name; permitting bare
    `npm` permits `npm run` of any script. `cargo test` permits running
    the tests, and `cargo test --lib x` because that only narrows the
    same operation.
  - **A refused command ends the gathering phase.** Left running, a
    model could try variations until one happened to match, so no
    further command runs for that task. It does not abandon the task:
    the refusal is recorded, and the agent answers from what it already
    gathered. Aborting outright threw away work for nothing — a model
    that had read everything it needed lost the run to one wrong guess
    at a script name.
  This reduces what a model can reach for; it is not a sandbox. A user
  who adds a broad entry gets broad behaviour, and the UI says so rather
  than implying the list makes command execution safe.
- Deciding *whether* a command may run is policy and lives in
  `agent-core`. The shell's `run_command` is mechanism only and does not
  consult the allowlist — one auditable place for the decision.
- **Skills describe a task and nothing more** (`packages/skills`). A skill
  file may set `name`, `title`, `description`, and `task`, and the parser
  rejects any other field by name. Project skills come from the
  repository, which is often someone else's, so a skill must never be a
  way to change the permission mode, the command allowlist, a budget, or
  which files are targeted. Three further rules hold that line:
  - Choosing a skill fills the task form; it never runs. The words about
    to reach the model are in front of the user, editable, with Run
    between them and the model — and a project skill is labelled as one.
  - A project skill never replaces a built-in of the same name. Both are
    listed, by source; a repository quietly redefining "Look for bugs" is
    not something a user would think to check.
  - A skill file that fails to parse is reported, never skipped silently.
- **Connected tools (MCP) are commands by another name**
  (`packages/mcp-client`). A server is a program the app starts, and its
  tools do whatever that program does — outside the diff, outside the
  undo history. They clear the same bar as commands, and a few more:
  - **Listing a server never starts it.** Servers come from the
    project's `.paleonyx/mcp.json` (the `mcpServers` format other clients
    use). The user approves the exact command, arguments and environment;
    any change to them voids the approval. The file cannot approve
    anything itself — `autoApprove`, `alwaysAllow` and `trust` are
    refused by name, like a skill's `permission:`.
  - **Approved is not enough.** A server runs only while the project is
    in *Can run commands*, and `investigate` offers connected tools only
    in that mode. Leaving the mode stops the server.
  - **Tools are chosen one by one.** The first list a server reports
    after approval is switched on; a tool that appears later starts off.
  - **A connected tool never takes a built-in's name.** `investigate`
    drops one that does, and `offeredTools` drops, and reports, any two
    whose model-facing names collide.
  - **What a server says is untrusted text.** Descriptions are labelled
    with their server and capped; results are capped; the prompt says
    neither is an instruction; every call is recorded with its
    arguments, shown to the user as "Sent".
  - **Local servers only.** A server reached over the network is new
    egress under §4 and needs its own visible opt-in before it is built.
  - Known limits, recorded rather than implied away: a tool's
    description is not pinned, so a server update can change what an
    enabled tool says about itself; there is no confirmation before each
    call — the mode and the per-tool switch are the gate.
- **Every process the app starts goes through `src-tauri/src/process.rs`.**
  A bare program name is looked up on `PATH` only, never in the project
  folder — a repository must not be able to plant its own `npm.cmd` —
  and `.cmd` shims are found, which `Command::new` alone does not do.
  Each process tree goes into a Windows job object, so ending it ends
  everything it started, and the app's exit ends it too. Elsewhere the
  child leads a process group of its own and the group is signalled: that
  ends what the child started, but not a descendant that leaves the group
  with `setsid`, and not the tree if the app itself dies. Commands that
  wait on a process are `#[tauri::command(async)]`: a plain command runs
  on the main thread.
- **Budgets are enforced in `agent-core`, not just displayed in the UI.**
  Max file writes, max commands, max tokens per session are hard stops —
  when hit, the agent pauses and escalates (see §7), it does not
  soft-continue.

---

## 7. Metacognition / Escalation

- The agent must be able to explicitly pause and hand control back to the
  user in at least these cases: budget exhausted, ambiguous/contradictory
  instructions, a tool call fails repeatedly, or its own confidence in a
  proposed change is low.
- Escalation is a first-class agent-core state (not an ad hoc chat
  message) so the UI can render it consistently via the confidence/
  uncertainty signal defined in DESIGN.md §6.2.
- Strategy changes (e.g., falling back from an automated fix to asking a
  clarifying question) are logged in the same timeline as file changes,
  so the user can see *why* the agent did what it did, not just *what*.
- The multi-step loop (`agent-core/investigate.ts`) records every file
  read and command run, with full output, and returns those steps even
  when it stops early — a conclusion drawn from a failing test reads
  very differently once the test output is visible beside it.
- The loop engages only for providers whose adapter *declares*
  tool-calling support; everything else takes the single-pass path.
  Discovering the capability by watching a request fail is exactly what
  §4 rules out.

---

## 8. Testing Strategy

- **`packages/agent-core`**: unit tests for planning/permission/budget
  logic; integration tests that run the full tool-execution loop against
  fixture repositories (no real model calls — a scripted/mock provider
  standing in for the runtime interface).
- **`packages/runtime`**: contract tests every adapter must pass (same
  test suite run against each provider adapter) to guarantee interface
  parity.
- **`packages/indexing`**: correctness tests per supported language's AST
  parsing, plus incremental-update tests (edit a file, confirm the index
  updates without a full re-index).
- **`packages/vcs`**: this is safety-critical — diff/undo logic gets the
  highest test bar in the repo, including adversarial cases (concurrent
  user edits during an agent change, partial-apply failure mid-write).
- **`packages/ui`**: component tests for all defined states (empty,
  loading, error, long-content per DESIGN.md §5); visual regression
  coverage for the design system once it stabilizes.
- **End-to-end**: critical user journeys (per PRD.md) covered by e2e tests
  against the real desktop shell — propose diffs, apply, undo; switch
  permission modes; switch models — before any release is considered
  shippable.
  - Lives in `apps/desktop/e2e`, run with `pnpm --filter @paleonyx/desktop
    e2e`. Windows-only: it drives WebView2 over the Chrome DevTools
    protocol, opened by the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
    environment variable for the test process alone. No WebDriver, no
    driver binary to match to the installed runtime, and `Input.*` gives
    real trusted clicks that reach the sandboxed preview frame.
  - Everything that would touch the user's setup is redirected: a
    throwaway WebView2 profile, a temporary git repository, and a scripted
    Ollama reached through `VITE_PALEONYX_OLLAMA_URL`, which only a
    development build honours.
  - The journeys share one running app and run in order. When a run fails,
    read the **first** failure — later ones are often the app being left
    in a state the next journey did not expect.
  - A new e2e test is not done until it has been seen to fail against the
    bug it guards. Several here were verified by putting the bug back.
- **`packages/agent-core` integration**: `pipeline.integration.test.ts`
  drives the real `OllamaAdapter` against a scripted fake over Ollama's
  wire format, then applies and undoes through `vcs`. Use it rather than
  `MockAdapter` for anything that crosses the adapter boundary —
  `MockAdapter` never serializes a request, which is where the worst bugs
  so far lived.
- **`packages/mcp-client`**: `testing/scripted-server.ts` plays an MCP
  server of either protocol generation, including the awkward habits of
  real ones — answering the discovery probe with an error, or not at
  all. The agent-core pipeline test drives the real client against it.
  The e2e journeys run a real server (`e2e/fixtures/notes-server.mjs`)
  through the shell.
- **Rust process tests** use `detached` Node grandchildren. On Windows
  Node already ends its ordinary children when it exits, so only a
  detached one shows whether the app ends the whole tree. A test that
  waits on a process gets a deadline of its own: the failure it looks
  for is a hang, and a hung test stops the whole run instead of failing.
  Folders a Rust test needs come from `test_support::ScratchDir`, which
  removes them; a day of runs without it left thousands in `%TEMP%`.
- **`packages/runtime` contract**: `adapters/contract.ts` is the suite
  every adapter runs. A new adapter is added there, not given its own
  copy of the tests.
- Any non-trivial agent-driven code change in this repo runs lint + the
  relevant package's test suite before being considered complete; this is
  a hard requirement, not a suggestion, for agent-authored commits
  specifically.

---

## 9. What Not To Do

- Don't let `agent-core` or `runtime` import anything from `ui` or
  `apps/*` — verified by a dependency-direction lint rule once tooling is
  scaffolded.
- Don't implement "auto-apply" as simply skipping the plan/diff step —
  the plan and diff must still be generated and recorded, only the
  approval gate is skipped, and only when explicitly enabled.
- Don't add a new model provider by special-casing it in `agent-core`;
  it must be an adapter.
- Don't reach for Electron/Node filesystem APIs directly from UI code —
  all filesystem access goes through the appropriate package's typed
  interface.
- Don't add telemetry, analytics, or network calls anywhere without
  threading them through the same local-first choke point described in
  §4, and never without it being an explicit, visible opt-in.
- Don't store a BYOK API key anywhere but OS-native secure storage — not
  `localStorage`, not a plaintext file, not a Zustand/Redux persisted
  store, not a "just for dev" shortcut left behind (§4.2).
- Don't let the model catalog's live-refresh path (§4.1) become a second,
  undocumented way to reach the network — it goes through the same
  runtime choke point and the same visible-labeling requirement as every
  other remote call.
- Don't add a dependency whose licence cannot be combined with
  LGPL-3.0-or-later: GPL-2.0-only, proprietary or "source-available"
  terms, or none declared. MIT, Apache-2.0, BSD, ISC, Zlib, Unicode,
  MPL-2.0, and LGPL are fine. Read the licence when weighing a
  dependency, the same way you weigh its size (§10 decision 8).

---

## 10. Decisions

1. ~~Tauri vs. Electron~~ — **Decided: Tauri + Rust shell.** Rationale:
   footprint and idle memory matter more here than usual since local model
   inference already competes for RAM/CPU on the same machine; Tauri's
   allowlisted IPC model maps directly onto the permission-gated tool
   surface required by §6, rather than us having to build that discipline
   from scratch as we would on Electron. All provider adapters (§4) talk
   over local HTTP, so Electron's main advantage — native Node bindings —
   isn't load-bearing for us.
2. ~~Monorepo tooling~~ — **Decided: pnpm workspaces + Turborepo** for
   TS/JS packages, **Cargo workspace** for Rust (`apps/desktop` and any
   native indexing/vcs internals that end up in Rust).
3. ~~Shadow history location~~ — **Decided: the user's own `.git`**, in a
   separate ref/branch namespace (e.g. an orphan branch or dedicated refs
   under `refs/paleonyx/`), rather than a fully separate local repo.
   Consequence to design for explicitly in `packages/vcs`: the app must
   handle the case where the opened project is *not yet* a git repo —
   proposal is to initialize one transparently on first agent-write
   attempt, with a clear one-time notice to the user before doing so
   (this is a repo-mutating action and should not happen silently).
4. ~~Model catalog sourcing~~ — **Decided: hybrid** (§4.1) — bundled
   offline baseline, labeled live refresh when reachable.
5. ~~v1 BYOK provider scope~~ — **Decided: OpenRouter + Groq adapters**
   (§4.2), not direct per-lab adapters, for wide coverage without
   maintenance scaling per provider — revisit if aggregator reliability or
   demand for a direct adapter (e.g. a specific lab's exclusive feature)
   makes that trade-off stop paying off.
6. ~~Skill-level naming~~ — **Decided: "New to coding / Experienced /
   Professional"** — the `comfortable` value across `shared-types` and
   `agent-core` is renamed to `experienced` (§5).
7. ~~Too-large model default visibility~~ — **Decided: hidden by default,
   UI-level toggle to reveal** (§4.1, DESIGN.md §6.3) — not a catalog-data
   exclusion.
8. ~~Licence~~ — **Decided: LGPL-3.0-or-later** (owner's choice; PRD.md
   §10). Text in `COPYING.LESSER`, with the GPL it builds on in
   `COPYING`. When it was chosen, every dependency (461 Rust crates, 56
   runtime JavaScript packages) was compatible; §9 keeps it that way.

---

## 11. Working in a Cloud Session

Claude Code can run on this repository in the cloud
([`docs/cloud-sessions.md`](docs/cloud-sessions.md)). What that means for
the work:

- `CLAUDE_CODE_REMOTE=true` marks a cloud session. The SessionStart hook
  in `.claude/settings.json` installs the JavaScript dependencies from it.
- Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`. Do not try the
  desktop end-to-end suite, the app, or a live model: they need Windows, a
  display, or Ollama, and none of those exist there.
- With the system libraries from `docs/cloud-sessions.md` installed, the
  Rust shell builds on Linux: `cargo check --tests`, `cargo test` (63
  tests; the Windows-only ones compile out), `cargo fmt --check` and
  `cargo clippy --all-targets -- -D warnings` all pass there. That checks
  what compiles and runs on Linux only. A change to Windows-only code
  (`#[cfg(windows)]`, job objects, `.cmd` resolution) is still reasoned
  about, not verified, and should be reported that way. The mutation rule
  in §8 still applies to whatever can be run.
- Commit with `git commit -s`. The `dco` check fails a pull request with an
  unsigned commit (`CONTRIBUTING.md`); `scripts/check-dco.test.sh` tests it.
- `docs/manual-test-checklist.md` is for the owner, on Windows. A cloud
  session adds to it; it does not do it.
