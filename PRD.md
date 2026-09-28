# Paleonyx Studio — Product Requirements Document

Status: draft, awaiting approval
Product name is tentative and may change before public naming.

Companion documents: [`DESIGN.md`](DESIGN.md) (visual/interaction rules),
[`CLAUDE.md`](CLAUDE.md) (engineering conventions, architecture rules).

---

## 1. Vision

Paleonyx Studio is a local-first AI IDE for professional, multi-language
development. It treats AI-assisted editing as a first-class engineering
workflow — with explicit plans, reviewable diffs, safe undo, and visible
permissions — rather than a chat window bolted onto a text editor. Code and
prompts stay on the user's machine by default; remote capability is
something the user turns on, never something the app assumes.

The bet this product makes: the current generation of "AI IDEs" wins on
model capability but loses on trust and workflow fit — weak project memory,
unclear agent permissions, and diff/undo as an afterthought. Paleonyx wins
by treating those as the primary product surface, not secondary polish.

---

## 2. Target Users

Paleonyx is built to serve the full skill spectrum in the *same* product,
not as separate editions — this is one of the specific gaps in existing AI
IDEs it's meant to close (see §4, Skill-Level Adaptation).

- **Professional developers working across multiple languages/stacks** who
  want AI assistance without surrendering review control over what gets
  written to disk, and who want the tool to get out of their way — terse
  output, no unrequested hand-holding.
- **Developers new to coding, or new to a specific language/stack**, who
  want the agent to explain *why*, not just produce a diff — grounded in
  their actual code, without turning the IDE into a separate learning app
  (see §4 and DESIGN.md §6.1 for the boundary between "adaptive teaching"
  and "coding course product," which we deliberately stay on the near
  side of).
- **Privacy- and IP-conscious developers/teams** (regulated industries,
  proprietary codebases, air-gapped-adjacent environments) who need a
  genuinely local-first option, not a "local cache of a cloud product."
- **Developers already comfortable with agentic coding tools** (e.g.
  Claude Code, Cursor, Copilot Workspace) who want the agentic workflow
  with a real IDE shell and stronger safety/inspection guarantees around
  it.

Out of scope as a primary persona for v1: large enterprise teams needing
centralized governance/admin consoles (may become relevant later, not a v1
driver). Note this is narrower than earlier drafts of this document —
"complete beginners" is explicitly an in-scope persona now, not excluded;
what's excluded is building a full teaching-curriculum product around them.

---

## 3. Core User Journeys

1. **Complete first-run onboarding.** On first launch (app-level, once —
   not per-project, since skill level is a per-user preference per
   CLAUDE.md §5), the user is walked through: a one-screen local-first
   welcome; choosing a skill level (New to coding / Experienced /
   Professional); and model setup — a silent, local-only hardware scan
   surfaces which local models will run well on this machine, the full
   model catalog stays browsable regardless (never trimmed to a
   shortlist), and a clearly separate "bring your own API key" section
   covers cloud options. Every step is skippable and everything chosen
   here is changeable later in Settings — onboarding and Settings share
   the same underlying screens rather than being two things to maintain.

2. **Open a project.** User points Paleonyx at an existing multi-language
   repo. The app indexes it, surfaces indexing progress honestly, and is
   immediately useful for navigation and search even before indexing
   completes.

   Status: file-aware indexing and AST-aware symbol extraction for the
   Tier 1 languages (Python, JavaScript, TypeScript, TSX) are built —
   tree, language tagging, gitignore-aware search, and an outline of the
   functions, classes, types, and methods in a file. Long files now
   reach the agent as that outline rather than as text, which is where
   AST-awareness earns its keep: the context window stops being spent on
   code nobody asked about.

   Still missing: file watching, embeddings, cross-file references, and
   grammars for the Tier 2-3 languages, which stay file-aware. Until
   those exist, "understands your whole project" is a claim the app
   should not make in its own copy.

3. **Ask for a bug fix (suggest-only, default mode).** User describes a bug
   (freeform or via a guided "Bug Fix" task form). Agent investigates
   (reads files, may run tests), produces a task plan, then a diff. Nothing
   is written until the user reviews and approves.

4. **Review and apply a diff.** User inspects the proposed diff per file,
   approves some hunks and rejects others if needed, applies. The change
   lands as an inspectable, timestamped entry in the timeline.

5. **Undo an AI change.** User (immediately or later) reverts a specific
   agent change from the timeline without losing unrelated work done since,
   including their own manual edits.

6. **Use a guided task form.** Instead of freeform prompting, user picks
   Refactor / Explain / Write Tests / Document / Bug Fix, fills structured
   fields (target file/selection, constraints), gets a more predictable,
   narrower agent run.

7. **Inspect and edit agent context.** Before or during a task, user opens
   the context panel to see exactly what files/docs/rules the agent can
   see, and adds or removes items explicitly.

8. **Change permission mode.** User raises a specific project from
   Suggest-only to Auto-apply (or narrows it back), sees a clear
   confirmation of what that changes, and sees the mode reflected
   persistently in the status bar for the rest of the session.

9. **Browse, install, or switch a local model.** From Settings (the same
   screen onboarding used), the user browses the full local model catalog
   — never limited to a curated handful — with each entry annotated
   against their actual hardware ("fits comfortably" / "will be slow" /
   "likely too large"). "Likely too large" entries start collapsed behind
   a "Show N too-large models" toggle (off by default) so the default
   view stays realistic without hiding anything permanently. Installing a
   model, removing one, and switching between them all happen in the app,
   through the same unified runtime interface and without workflow
   changes elsewhere. Installing is a multi-gigabyte download, so it
   reports real progress, can be cancelled, and survives navigating away
   from the panel. Removing one is destructive and is confirmed, and
   never silently removes the model currently in use.

   Not every provider can do this — Ollama exposes an API for it, others
   may not — so it is declared adapter capability, not something
   attempted and discovered to fail (CLAUDE.md §4). Where a provider
   cannot install, the app says so and shows what to run instead, rather
   than offering a button that does nothing.

10. **Bring your own API key for a cloud model.** From the same Models
    settings screen, the user adds an API key for a supported provider —
    v1 ships this through aggregator adapters (OpenRouter, Groq) rather
    than one bespoke adapter per lab, which gets a wide model selection
    (including free-tier options) without multiplying maintenance surface.
    Each provider entry links to that provider's own key-creation page
    with a short "how to get one" note. The key never leaves the machine
    except in direct calls to that provider, is never stored in plaintext
    (CLAUDE.md §4), and adding it is the explicit, visible opt-in that
    CLAUDE.md's local-first default requires — nothing is called
    remotely until this step happens.

11. **Continue a task from mobile.** User starts a task on desktop, steps
    away, and from a phone reviews task status and approves/rejects a
    pending diff via a remote-controlled session against the running
    desktop instance.

12. **Get an explanation pitched at the right level.** A newcomer asks
    "why does this fix work" and gets a grounded, jargon-defined walkthrough
    tied to their actual diff, with the option to go deeper. A professional
    gets a one-line rationale by default and can ask for more only if they
    want it. Both are the same feature at different settings (DESIGN.md
    §6.1), and switching the setting takes effect immediately, not on next
    session.

13. **Start from a prompt, with no code written yet.** A user who has an
    idea but no project answers a short guided form — what they want to
    make, who it's for, where it should run, what it must do — and
    Paleonyx composes that into a brief the agent scaffolds a working
    project from. The generated files arrive as a normal reviewable
    change: a diff to read, approve, and undo, not a black box that
    fills a folder. This is the beginner on-ramp the "New to coding"
    skill level implies, and without it that persona has nowhere to
    start (§2).

14. **Design by pointing at the running app.** A design mode where the
    project renders live, the user selects something on screen, and
    describes the change they want in words rather than editing code.
    Exact interaction model still open — see §10.

15. **Hit a budget or ambiguity wall.** Agent pauses mid-task (budget
    exhausted, low confidence, repeated tool failure), clearly surfaces
    why, and the user resolves it (raise budget, clarify, redirect)
    without having lost the work done so far.

---

## 4. Supported Workflows (v1 scope)

- Multi-language projects, tiered by indexing depth using GitHub Octoverse
  usage ranking as the ordering signal (see §7 for the full tiering
  rationale):
  - **Tier 1 (full AST-aware indexing at launch)**: Python, JavaScript,
    TypeScript.
  - **Tiers 2–3 (provisional ordering)**: Java, Go, C/C++, C#, Rust,
    Kotlin, Swift, PHP, Ruby. Relative ordering within these tiers is a
    placeholder, not verified against a specific current Octoverse report —
    confirm actual current-year ranking before this tiering is locked for
    v1 (see §9). Tier 1 (Python/JS/TS at the top) is high-confidence and
    stable across recent years; the middle of the list moves more and
    shouldn't be treated as settled from memory.
  - All tiers get file-aware indexing and basic navigation at minimum;
    lower tiers may launch file-aware-only with AST-aware support following
    post-v1 if a given language's tree-sitter/parser support proves
    immature.
- File-aware + AST-aware semantic search and navigation.
- Agent-driven multi-step tasks with tool use: file read/write (gated),
  shell commands (allowlisted), running tests/linters, self-correction from
  tool output.
- Git-backed safe undo/restore for every AI-applied change, independent of
  the user's own commit history.
- Guided task forms: Bug Fix, Refactor, Explain, Write Tests, Document (v1
  set; extensible later).
- Context panel with explicit add/remove of files, docs, and rules
  (AGENTS/context-doc style files supported).
- Per-project/session permission levels: Read-only / Suggest-only /
  Auto-apply / Can-run-commands.
- Configurable session budgets: max file writes, max commands, max tokens.
- Local model runtime switching via unified, OpenAI-compatible interface;
  Ornith-1 as the recommended default where compatible with the user's
  local runtime.
- **First-run onboarding** covering skill-level selection and model setup
  (§3 journey 1), backed by the same Settings screens it hands off to —
  not a separate one-time-only UI to maintain.
- **Hardware-aware model catalog**: a System Profile capability (RAM, CPU
  cores, GPU/VRAM where detectable, OS — desktop-only, since a browser has
  no hardware access) annotates the full local model catalog against the
  user's actual machine. The catalog itself is sourced hybrid: a bundled,
  release-versioned list as the offline-safe baseline, with a background
  live refresh attempted when reachable and clearly labeled as such when
  it's in effect. Never trimmed to a curated handful — annotation guides
  the user, it doesn't gate what's visible.
- **Bring-your-own-key (BYOK) cloud providers**: v1 ships aggregator
  adapters (OpenRouter, Groq) rather than one bespoke adapter per lab,
  covering a wide model selection — including free-tier options — without
  a maintenance burden that scales per-provider. Each entry links to that
  provider's key-creation page with a short setup note. Adding a key is
  the explicit, visible action that satisfies CLAUDE.md §4's local-first
  default; keys are never stored in plaintext (CLAUDE.md §4).
- MCP tool integration for extending agent capability.
  Status: built for servers that run on this computer. A project lists
  them in `.paleonyx/mcp.json`, in the `mcpServers` format Claude Desktop
  and Cursor use, so a server's own setup instructions can be pasted in.
  Nothing starts until the user allows the exact command, and a server
  runs only while the project is set to *Can run commands*, since its
  tools act outside the diff and the undo history. The user switches
  tools on and off one by one, and a tool a server adds later starts off.
  The client speaks both the current protocol (2026-07-28) and the older
  handshake one most servers still use. Not built: servers reached over
  the network (new egress, which needs its own visible opt-in first); a
  user-wide server list; resources and prompts, which are MCP features
  beyond tools; and a confirmation before each individual tool call.
- Simple skill system: reusable task templates/workflows.
  Status: templates are built. Six ship with the app, one per task type
  plus a security review; a project adds its own as Markdown files in
  `.paleonyx/skills/`, and any task can be saved as one from the app. A
  skill names a task and supplies its words, and nothing else — it cannot
  change what the agent is allowed to do (CLAUDE.md §6). Not built:
  multi-step workflows that chain tasks, and user-wide skills outside a
  project, which would need a read path beyond the opened folder.
- **Skill-level adaptation**: a user-set level (new to coding / experienced
  / professional) that shapes explanation depth and tone across agent
  responses, task plans, and diffs (never capability — see DESIGN.md §6.1
  and CLAUDE.md §5). Includes optional, dismissible Lesson Callouts tied to
  the user's actual code, on by default at lower levels and available on
  demand at Professional. Adjustable at any time, effective immediately.
- Desktop app as the full-fidelity primary surface; web companion connecting
  to the same local backend; mobile as remote-control (view/approve/reject,
  lightweight chat) against a running desktop session.

---

## 5. Non-Goals (Explicit)

- **No default cloud execution or storage of code/prompts.** Any remote
  capability is opt-in and clearly indicated (per DESIGN.md's
  local-vs-remote legibility principle). BYOK (§4) is the sanctioned
  exception, and only for the specific provider a key was explicitly
  added for — adding one key never implicitly enables others.
- **No proprietary-model lock-in.** The runtime abstraction is a product
  requirement, not just an implementation detail — v1 must demonstrably
  work with at least one fully local model path.
- **Not a general-purpose credential/secrets manager.** BYOK (§4) stores
  exactly the provider API keys the user adds for model access, through
  the one secure-storage mechanism CLAUDE.md §4 defines — it is not a
  vault for unrelated secrets, and shouldn't grow into one.
- **No full native mobile IDE in v1.** Mobile is remote-control only;
  native iOS/Android editing clients are a later-phase goal, not v1.
- **No multiplayer/live collaboration in v1** (shared cursors, concurrent
  multi-user editing sessions).
- **No plugin marketplace / third-party extension ecosystem in v1.** MCP
  tool integration and the internal skill system cover extensibility for
  now; a public marketplace is a later consideration.
- **No enterprise admin/governance console in v1** (centralized policy
  management across many users' installs).
- **No autonomous unattended operation in default configuration.**
  Suggest-only is the default everywhere; auto-apply is always an explicit,
  visible opt-in, never the shipped default for a new project.
- **Not a structured coding-course or curriculum product.** Skill-level
  adaptation (§4) teaches in the moment, grounded in the user's real code —
  it is explicitly not a syllabus, exercise bank, or standalone lesson
  library. If the product starts needing progress-tracking-through-a-
  curriculum UI, that's a sign of scope creep past this boundary.

---

## 6. Success Criteria

Pre-launch/early-stage, so criteria are primarily qualitative and
instrumented locally (consistent with local-first: no forced telemetry to
measure success):

- **Trust behaviors observable in use**: users regularly use diff review
  and selectively approve/reject hunks (not just blanket-approving),
  and use undo as a normal, low-stakes action rather than avoiding
  AI edits out of fear.
- **Time-to-first-successful-edit** for a new project is short and the
  path there (open → index → first agent suggestion → approve) has no
  silent failure points.
- **Zero unintended network egress** in the default local configuration,
  verifiable via a network audit — this is a hard correctness bar, not an
  aspiration. "Unintended" has exactly two carve-outs, both visibly
  labeled when active: the model catalog's background live-refresh (§4),
  and calls to a BYOK provider the user explicitly added a key for (§4).
  Nothing else reaches the network unasked.
- **Crash-free / data-loss-free sessions**: an agent failure (bad tool
  call, model error, crash) never corrupts the user's working tree or
  loses unrelated uncommitted work.
- **Guided task forms reduce ambiguity-driven agent failures** measurably
  versus freeform prompting for the same task types.
- **Model portability**: switching the active local model requires no
  workflow relearning and no code changes to the rest of the app.
- **Serves both ends of the skill spectrum without alienating either**: a
  newcomer using the default settings gets grounded explanations they can
  actually follow; a professional using the default Professional setting
  never feels talked down to or slowed down. Neither persona should need
  to fight the product's tone to get useful output.

---

## 7. Scope: v0 → v1 → Later

**v0 (skeleton, post-approval of this document set)**
Minimal scaffolding only, per CLAUDE.md's "minimal skeleton" instruction:
app shell layout (file tree, editor, agent panel, diff/timeline panel per
DESIGN.md §3), Monaco integration for at least one language, a single local
model provider wired through the runtime abstraction, and a stubbed
agent-core loop capable of producing a plan and a diff for one narrow task
type — no auto-apply, no multi-provider support yet, no mobile.

**v1 (first usable release)**
Full journey list in §3 functional end to end; tiered language support per
§4; at least the Ornith-1 path plus Ollama working through the unified
interface (§9), with room to add coding-specialized models available
through Ollama (e.g. Qwen2.5-Coder, DeepSeek-Coder, StarCoder2 — exact list
confirmed at implementation time against what's current and well-supported,
not locked here) as additional recommended-model options rather than a
single default; first-run onboarding (§3 journey 1) covering skill-level
selection and model setup; the System Profile capability and
hardware-annotated model catalog (§4) on desktop; BYOK via OpenRouter and
Groq adapters (§4); full permission-mode and budget system; skill-level
adaptation (§4) live for at least the core journeys; web companion
functional against the same local backend (hardware detection and BYOK
key entry are desktop-only — the web companion shows the catalog
unannotated and routes key management back to desktop for now); mobile
remote-control for review/approve only.

Also in v1, and specific to the beginner persona §2 commits to: the
new-project path (§3 journey 13) — a guided form that composes a project
brief, and a scaffold task type that turns that brief into a first set of
files through the same plan/diff/apply/undo path every other change uses.
Without it "New to coding" is a skill level with no way in.

**Later (v2+, not committed scope)**
Design mode (§3 journey 14, §10) — the live-preview surface it depends on
is built, so what remains is the hand-off method §10 is still open on;
native mobile editing clients; live multiplayer collaboration; plugin
marketplace; enterprise governance console; expanded skill-sharing/
community templates; broader remote/cloud model options beyond
user-opted-in remote providers.

---

## 8. Risks & Assumptions

- ~~Ornith-1 compatibility is assumed, not yet verified~~ — **resolved.**
  Ornith-1.0 is a family of MIT-licensed models built for agentic coding,
  with native tool calling and a 262,144-token context. The 9B (dense) and
  35B (mixture-of-experts) ship GGUF builds and run under Ollama directly
  from their Hugging Face repos; both are in the bundled catalog. The 397B
  is FP8-only with no GGUF, so no Ollama-backed runtime can load it and it
  is not listed. One open detail: the 35B's *active* parameter count isn't
  published, so its speed is currently judged by the full 35B — a
  pessimistic rating that should be corrected once the figure is known.
- **AST-aware indexing depth varies by language ecosystem maturity** (e.g.
  tree-sitter grammar quality differs across the listed languages) —
  actual tier boundaries in §4 need validation against real parser support
  per language, not just usage ranking.
- **The Tier 2/3 Octoverse-based ordering in §4 is provisional**, not
  pulled from a verified current report — needs a real lookup before it's
  treated as final (see §9).
- **Undo correctness under concurrent user edits** is the highest-risk
  correctness surface in the whole product (per CLAUDE.md §6/§8) and
  should get disproportionate early engineering and testing investment
  relative to its "one feature" footprint.
- **Mobile remote-control's security model** (auth between phone and
  desktop session, especially over untrusted networks) needs explicit
  design before that journey is implemented, not assumed safe by default.
- **System Profile detection accuracy** (GPU/VRAM detection especially) is
  inherently best-effort across the range of hardware Paleonyx might run
  on — the hardware-fit annotations in the model catalog (§4) should read
  as guidance, never as a hard guarantee a model will run well, and the UI
  needs to make that framing explicit rather than implying certainty.
  Currently implemented on Windows only (via DXGI); macOS and Linux report
  no GPU and fall back to a CPU-only assessment, which under-promises
  rather than over-promises but does need building out before those
  platforms are properly supported.
- **The catalog's live-refresh half is unbuilt** (CLAUDE.md §4.1): no
  public API exists for Ollama's model library, so a genuinely current
  catalog requires hosting an index ourselves. Until then the bundled list
  goes stale between releases — acceptable for now because it is labeled
  as bundled with its date, but it is a standing cost, not a solved
  problem.
- **Aggregator dependency for BYOK**: routing v1's cloud model access
  through OpenRouter/Groq (§4) means their uptime and pricing/ToS become
  part of Paleonyx's dependency surface for that feature, not just the
  underlying labs' — worth revisiting if either becomes unreliable or if
  demand for direct single-provider adapters turns out to be real.

---

## 9. Decisions

1. ~~v0 skeleton's narrow task type~~ — **Decided: a scoped Explain or Bug
   Fix flow**, since both stay read/suggest-only and don't require the
   write/undo system to exist yet.
2. ~~Local providers besides Ornith-1~~ — **Decided: Ollama first**, given
   adoption breadth, with coding-specialized models reachable through it
   (§7) added as recommended options rather than the app committing to one
   single non-Ornith default.
3. ~~Language tiering approach~~ — **Decided: Octoverse usage ranking as
   the tiering signal**, Python/JavaScript/TypeScript as Tier 1 (full
   AST-aware at launch — see §4). Tier 2/3 ordering is provisional (§8)
   and should be confirmed against current Octoverse data, cross-checked
   against real tree-sitter/parser maturity per language, before v1 lock —
   ranking alone shouldn't override a language that's popular but poorly
   supported by available parsers, or vice versa.
4. ~~Skill-level naming and default~~ — **Decided: "New to coding /
   Experienced / Professional"** (renamed from "Comfortable" to
   "Experienced"), chosen explicitly during first-run onboarding (§3
   journey 1) — never silently defaulted. The placeholder default in
   shared-types exists only as the pre-onboarding-completion fallback, not
   as a product decision to skip asking.
5. ~~Model catalog sourcing~~ — **Decided: hybrid.** A bundled,
   release-versioned catalog is the offline-safe baseline; a background
   live refresh is attempted when reachable and clearly labeled as such
   when it's the source in effect (DESIGN.md's local-vs-remote legibility
   principle applies here too).
6. ~~v1 BYOK provider scope~~ — **Decided: aggregator adapters first
   (OpenRouter, Groq)**, not one bespoke adapter per lab. This trades a
   small dependency on the aggregators' own uptime/ToS (§8) for wide
   model coverage — including free-tier options — without per-provider
   maintenance scaling linearly with the number of labs supported.

---

## 10. Open Questions

1. **Design-mode hand-off method.** Journey 14 assumes the user can point
   at their running app and describe a change in words. What's undecided
   is the mechanism connecting a selected on-screen element back to the
   source that produced it. Candidates, roughly in order of how much they
   ask of the project being edited:
   - **Source-mapped selection.** A dev-time instrumentation step tags
     rendered elements with their originating file and line, so a click
     resolves to an exact source location. Precise, but framework-specific
     and only works for stacks we've built support for.
   - **Screenshot + description.** The user selects a region; we send the
     image (to a vision-capable model) plus the project's file list and
     let the agent locate the code. Framework-agnostic and works on any
     project, but needs a vision model and is less certain.
   - **DOM-path + search.** Capture the selected element's tag, classes,
     and text, then use the existing project search to find candidate
     source locations and let the agent choose. No vision model and no
     instrumentation, but ambiguous when markup is generated.

   **Decided.** Element facts plus search is the default and the only
   one built: it needs no vision model, no framework support, and works
   on the plain HTML the scaffolder produces. Screenshot-and-region is
   offered as an *additional* option when the active model actually
   reports `supportsVision` — gated on the declared capability rather
   than on a key being present, so a local vision model qualifies and a
   text-only remote one does not. `DesignSelection` carries `screenshot`
   and `source` as optional fields so both remaining routes add data
   rather than replacing the shape.

   **Screenshot option: deferred.** Not built, and not to be built piecemeal.
   The owner has a larger design-mode build planned, and the screenshot
   route (capture from the sandboxed frame, and the labeling a remote
   vision model would need) is designed there, together with the
   source-tagging review below.

   **Revisit at the end of v1: build-time source tagging.** Deferred by
   decision, not dropped — it is the most precise of the three and the
   only one that handles generated markup reliably, but it is
   per-framework work that pays off only once the frameworks people
   actually use here are known. Reassess before v1 ships: if design mode
   is being used and search is missing elements, this is the fix.

2. **Web companion transport — Cloudflare, with a local-first question
   attached.** Cloudflare is the intended way to reach the web companion
   (owner's call, recorded here so it is not rediscovered later). What
   still needs deciding is what actually crosses it. The companion talks
   to the *local* backend, so exposing it remotely means the user's code
   and prompts leave the machine — which is the one thing §6 and
   CLAUDE.md §4 promise they do not, and a tunnel is exactly the kind of
   quiet second egress path CLAUDE.md §9 rules out. Three shapes worth
   weighing before any of it is built:
   - **Same-machine only.** The companion is served over the LAN or
     loopback and Cloudflare hosts nothing but the static assets. No
     project data transits anyone else. Narrowest, and preserves the
     guarantee unchanged.
   - **User-initiated tunnel.** A Cloudflare tunnel the user turns on
     per session, with the same visible, revocable opt-in a BYOK key
     gets, and a status-bar indicator for as long as it is open. Data
     does transit Cloudflare, so this has to be a decision the user
     makes knowingly, never a default.
   - **Relay with end-to-end encryption.** Cloudflare carries ciphertext
     it cannot read. Strongest guarantee, most work, and needs a key
     exchange between desktop and phone that we would have to design.

   Whichever is chosen, it is an explicit opt-in and it is labeled while
   active — the same bar the model catalog's live refresh clears (§9
   decision 5).

   **Decided for now: same-machine only.** Nothing is built for the other
   two. A user-initiated tunnel stays a possible later addition behind the
   visible opt-in described above, and the encrypted relay is deferred
   until there is demand. Phone access away from the local network is
   therefore not supported yet.

3. **Publishing to GitHub — open source, with donations.** The owner's
   direction is an open-source project that accepts donations as thanks.
   Donations are independent of the licence: every mainstream open-source
   licence permits them, and the funding platforms (GitHub Sponsors,
   Ko-fi, Open Collective) work with any of them, so that half needs no
   decision here.

   **Licence decided: LGPL-3.0-or-later** (the owner's choice). It is weak
   copyleft: anyone may use, change, and share the code; a modified
   version that is distributed must be shared under the same licence; and
   other software may link to it as a library under its own terms, within
   the limits of LGPLv3 §4. That is looser than GPL or AGPL, which would
   also require a whole product built on this code to be open, and
   tighter than MIT or Apache-2.0, which require nothing. Two things
   worth knowing rather than discovering later. LGPL is written for
   libraries, so for an application its practical effect is that a
   closed-source product may be built on these packages provided changes
   to the LGPL'd files are shared. And it does not reach hosted use: a
   company could offer this as a service without releasing its changes.
   AGPL is what covers that, and it would matter only if the web
   companion were ever offered as a service.

   Checked when it was chosen: all 461 Rust crates and 56 runtime
   JavaScript packages are permissive, MPL-2.0, or dual-licensed with a
   permissive option. None is GPL-only, AGPL, proprietary, or without a
   licence. CLAUDE.md §9 keeps that true for new dependencies.

   The text is in `COPYING.LESSER`, with the GPL it builds on in
   `COPYING`, and each manifest carries the SPDX identifier. "Or later"
   follows the FSF's recommended notice; `LGPL-3.0-only` is a one-line
   change per manifest until the code is public. As sole copyright holder
   the owner can still relicense, but once outside contributions are
   merged that stops being true without each contributor's agreement, so
   a contribution policy (a DCO or a CLA) should exist before the first
   one is accepted. **Decided: a DCO.** Contributors keep their copyright
   and sign off each commit (`git commit -s`), certifying they may submit
   it under LGPL-3.0-or-later. The consequence is accepted: the licence
   cannot be changed later without every contributor's agreement, and a
   CLA cannot be required retroactively. See `CONTRIBUTING.md`.

   The repository is public on GitHub, `main` is the default branch, and
   commits carry `support@paleonyx.com` rather than a personal address.
   The copyright line in `README.md` names "Paleonyx" with
   `support@paleonyx.com`; the owner chose that over a legal name.
