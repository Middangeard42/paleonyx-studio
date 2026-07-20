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
│   │       └── gpt4all/
│   ├── indexing/              # File watching, AST parsing (per language),
│   │                          # embeddings, semantic search
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

---

## 5. Skill-Level Adaptation

Per PRD.md §2/§4, adapting to the user's coding skill level is a headline
product requirement, not a UI nicety layered on top — so it is modeled as a
first-class concept in `agent-core`, alongside permission mode and budgets.

- `SkillLevel` is a typed value in `shared-types` (e.g. `new-to-coding |
  comfortable | professional`), set per user (not per project — a
  developer's skill doesn't reset when they switch repos) and stored
  alongside other local user preferences.
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
  model requests it.
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
