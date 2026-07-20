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

1. **Open a project.** User points Paleonyx at an existing multi-language
   repo. The app indexes it (file-aware + AST-aware), surfaces indexing
   progress honestly, and is immediately useful for navigation/search even
   before indexing completes.

2. **Ask for a bug fix (suggest-only, default mode).** User describes a bug
   (freeform or via a guided "Bug Fix" task form). Agent investigates
   (reads files, may run tests), produces a task plan, then a diff. Nothing
   is written until the user reviews and approves.

3. **Review and apply a diff.** User inspects the proposed diff per file,
   approves some hunks and rejects others if needed, applies. The change
   lands as an inspectable, timestamped entry in the timeline.

4. **Undo an AI change.** User (immediately or later) reverts a specific
   agent change from the timeline without losing unrelated work done since,
   including their own manual edits.

5. **Use a guided task form.** Instead of freeform prompting, user picks
   Refactor / Explain / Write Tests / Document / Bug Fix, fills structured
   fields (target file/selection, constraints), gets a more predictable,
   narrower agent run.

6. **Inspect and edit agent context.** Before or during a task, user opens
   the context panel to see exactly what files/docs/rules the agent can
   see, and adds or removes items explicitly.

7. **Change permission mode.** User raises a specific project from
   Suggest-only to Auto-apply (or narrows it back), sees a clear
   confirmation of what that changes, and sees the mode reflected
   persistently in the status bar for the rest of the session.

8. **Switch or add a local model.** User installs/points to a different
   local runtime (Ollama, LM Studio, llama.cpp, GPT4All) or the default
   recommended model (Ornith-1), and the app picks it up through the same
   unified interface without workflow changes elsewhere in the app.

9. **Continue a task from mobile.** User starts a task on desktop, steps
   away, and from a phone reviews task status and approves/rejects a
   pending diff via a remote-controlled session against the running
   desktop instance.

10. **Get an explanation pitched at the right level.** A newcomer asks
    "why does this fix work" and gets a grounded, jargon-defined walkthrough
    tied to their actual diff, with the option to go deeper. A professional
    gets a one-line rationale by default and can ask for more only if they
    want it. Both are the same feature at different settings (DESIGN.md
    §6.1), and switching the setting takes effect immediately, not on next
    session.

11. **Hit a budget or ambiguity wall.** Agent pauses mid-task (budget
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
- MCP tool integration for extending agent capability.
- Simple skill system: reusable task templates/workflows.
- **Skill-level adaptation**: a user-set level (new to coding / comfortable
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
  local-vs-remote legibility principle).
- **No proprietary-model lock-in.** The runtime abstraction is a product
  requirement, not just an implementation detail — v1 must demonstrably
  work with at least one fully local model path.
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
  aspiration.
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
single default; full permission-mode and budget system; skill-level
adaptation (§4) live for at least the core journeys; web companion
functional against the same local backend; mobile remote-control for
review/approve only.

**Later (v2+, not committed scope)**
Native mobile editing clients; live multiplayer collaboration; plugin
marketplace; enterprise governance console; expanded skill-sharing/
community templates; broader remote/cloud model options beyond
user-opted-in remote providers.

---

## 8. Risks & Assumptions

- **Ornith-1 compatibility is assumed, not yet verified** against the
  chosen local runtimes (Ollama/llama.cpp/etc.); needs an early spike
  before it's load-bearing in v0.
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
- **Skill-level detection/defaults**: no default skill level is chosen yet
  for a brand-new install (e.g. asked at onboarding vs. a neutral
  "Comfortable" default) — needs a decision before the onboarding journey
  (§3, journey 1) is implemented, so it isn't guessed silently at first
  launch.

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
