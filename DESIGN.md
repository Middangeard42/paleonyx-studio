# Paleonyx Studio — Design System & Interaction Language

Status: draft, awaiting approval
Scope: desktop app (primary), web companion, future mobile remote client

This document defines how Paleonyx Studio looks, feels, and behaves. It is the
source of truth for visual language, layout, motion, and interaction rules.
Implementation (tokens, components) follows from this document, not the
other way around — if code and this document disagree, this document wins
until amended.

---

## 1. Design Principles

These are load-bearing. Every screen, component, and micro-interaction should
be checkable against them.

1. **This is a workbench, not a conversation.** The unit of the product is
   the project — files, diffs, tasks, history — not a chat transcript. Chat
   is one input modality among several (guided forms, inline actions,
   command palette), never the whole interface.

2. **Every agent action is visible, inspectable, and reversible before it's
   trusted.** No silent writes. No hidden state. If the agent did something,
   there is a durable, clickable record of exactly what, where, and why —
   and a way back.

3. **Show state, don't imply it.** A spinner is not a status. If the agent
   is reading files, say "Reading 4 files." If it's uncertain, show a
   confidence signal, not confident-sounding prose. Loading skeletons must
   match the real shape of the content they precede.

4. **Meet the developer where they are.** The same product serves someone
   writing their first function and someone with fifteen years of
   experience — neither should feel like an afterthought. Explanation
   depth, tone, and proactive teaching adapt to a skill-level setting;
   the mechanism for *how* is never patronizing (no badges, no forced
   tutorials) and never gatekept behind jargon a newcomer hasn't met yet.
   See §6.1.

5. **Density with breathing room.** IDE users work in this tool for hours.
   Optimize for information density and low friction over marketing-page
   whitespace, but never at the cost of legibility or misclickable targets.

6. **Keyboard-first, mouse-friendly.** Every action reachable by mouse must
   be reachable by keyboard, and the reverse doesn't have to be true. The
   command palette is a first-class citizen, not an easter egg.

7. **Calm by default.** No urgency manufactured through motion, color, or
   copy. Destructive/irreversible actions get visual weight; everything
   else stays quiet. Notifications inform, they don't nag.

8. **Local-first is a visible property, not just a backend fact.** The UI
   should make it legible when something is local vs. would leave the
   machine (e.g., a remote model call, a mobile relay session).

---

## 2. Visual Language

### 2.1 Color

**Dark is the default theme.** Light and any additional themes (high-
contrast, future community/brand themes) are selectable in Settings, built
from day one on the same semantic token set so no theme is a second-class,
inverted afterthought — but dark is what ships unconfigured, matching both
IDE convention and the product's visual identity. Every theme, present and
future, consumes the same token names; adding a theme means supplying new
values, never new component logic.

Accent hue (tentative, pending a dedicated token-exploration pass): a warm
amber/copper — evoking the "onyx/fossil" identity in the product name and
deliberately outside the saturated blue/purple palette that reads as
generic "AI product" branding. Treat as a placeholder value, not final.

**Semantic token layers:**

- `--surface-0..3` — layered background elevation (app shell → panel →
  card → overlay), each a small, deliberate step, not a big jump.
- `--border-subtle`, `--border-default`, `--border-strong`
- `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-disabled`
- `--accent` (single brand accent, used sparingly — primary actions,
  active states, focus rings) and `--accent-muted` for backgrounds
- `--status-info`, `--status-success`, `--status-warning`, `--status-danger`
  — reserved exclusively for actual status communication (build results,
  diff additions/deletions, permission levels), never decoration
- `--diff-add`, `--diff-remove`, `--diff-add-bg`, `--diff-remove-bg` —
  distinct from generic success/danger; diffs need their own stable
  color identity independent of theme mood

Rules:
- One accent hue. Additional hues are reserved for semantic meaning
  (diff, status, syntax) — never introduced purely for visual variety.
- No gradients on structural chrome (panels, buttons, nav). Gradients are
  permitted only as a very restrained treatment on marketing/empty-state
  illustration, if at all.
- Contrast minimum: 4.5:1 for body text, 3:1 for large text/icons, verified
  against both themes for every semantic token pairing.

### 2.2 Typography

- **UI font:** a neutral, high-legibility grotesk (e.g. Inter or system
  UI font stack) for chrome, labels, and prose.
- **Code/mono font:** a coding-optimized monospace with ligature support
  off by default (user-toggleable) — e.g. JetBrains Mono / Berkeley Mono
  stack — used in the editor, diffs, terminal output, and inline code
  references anywhere in the UI.
- Type scale is small and disciplined: 11/12/13/14/16/20/24px. Most UI
  chrome lives at 12–13px (IDE density norm); 14px is body/editor default.
- Line height: 1.4–1.5 for prose, 1.5–1.6 for code (readability over
  density in the one place users read most).
- Never more than two weights per surface (regular + medium/semibold).
  No light weights for body text (legibility at small sizes).

### 2.3 Spacing & Layout Grid

- Base unit: **8px**. All padding, margin, and gap values are multiples of
  8, with a single 4px half-step permitted for icon-to-label gaps and
  dense list rows.
- Scale: `4, 8, 12, 16, 24, 32, 48, 64`.
- Panels snap to this grid on resize where practical; text and icons are
  exempt from hard snapping but their containers are not.

### 2.4 Elevation & Layering

- Elevation is communicated primarily through `--surface` steps and hairline
  borders, not drop shadows. Shadows are reserved for truly floating
  elements (menus, popovers, modals, the command palette) and stay small
  and low-opacity — this is a dense workspace, not a card-based marketing
  UI.
- z-index scale is named, not numeric-guessed: `base, panel, sticky,
  overlay, modal, toast`.

### 2.5 Iconography

- Single icon set, consistent stroke weight, 16px and 20px grid sizes only.
  No mixing icon families.
- Icons never carry meaning alone in agent-action contexts — always paired
  with a text label or accessible name. Status icons (success/warning/
  error) are the one exception, and even those get a tooltip/aria-label.

### 2.6 Motion

- Durations: 100ms (micro, hover/press feedback), 150–200ms (panel/menu
  transitions), 250ms (larger layout shifts). Nothing above ~300ms outside
  of intentional, skippable onboarding moments.
- Easing: standard ease-out for entrances, ease-in for exits. No bounce,
  no spring-for-spring's-sake.
- Motion communicates a state change (panel opening, diff applying, task
  progressing) — it never plays purely for delight. If removing an
  animation loses no information, cut it.
- Respect `prefers-reduced-motion` everywhere; provide an in-app setting
  too, since developer environments often run in windowed, motion-sensitive
  contexts.
- Streaming agent text is the one place sustained motion is expected
  (token-by-token render); it must be interruptible/skippable and never
  block interaction with the rest of the UI.

---

## 3. Layout System

### 3.1 Desktop App Shell

```
┌─────────────────────────────────────────────────────────────────┐
│ Title bar: project name · branch · permission-mode indicator     │
├──────┬───────────────────┬──────────────────┬────────────────────┤
│ Act- │  File Tree /       │  Editor           │  Agent Panel       │
│ ivity│  Search /          │  (tabs, multi-    │  (chat + guided    │
│ Bar  │  Source Control /  │   pane)           │   task forms)      │
│      │  Context panel     │                   │                    │
│      │  (switchable)      │                   ├────────────────────┤
│      │                    │                   │  Diff / Timeline   │
│      │                    │                   │  panel (collapsible)│
├──────┴───────────────────┴──────────────────┴────────────────────┤
│ Status bar: model in use · permission level · budget meter ·      │
│             indexing status · run/test status                     │
└─────────────────────────────────────────────────────────────────┘
```

- **Activity Bar** (far left, icon rail): switches the left panel's mode —
  Files, Search, Source Control, Context (what the agent can see).
- **Left Panel**: single-purpose per mode, resizable, collapsible to icon
  rail only.
- **Editor**: center, multi-tab, splittable. Always the largest region at
  default window size.
- **Agent Panel**: right side, resizable, dockable to bottom on narrow
  windows. Contains the conversation/guided-form surface.
- **Diff/Timeline Panel**: distinct from the agent panel — it is the
  historical and pending-change record, addressable independently (e.g.
  deep-linkable, keyboard-navigable) so it survives outside any single
  chat turn.
- **Status bar**: always-visible, always-honest system state — current
  model, permission mode, session budget remaining, background indexing
  progress. This is where "what is the AI allowed to do right now" lives
  permanently, not buried in a settings screen.

### 3.2 Responsive Behavior (web & future mobile)

- Desktop is the reference layout (≥1280px): all panels visible
  simultaneously.
- **Web companion** (768–1279px): agent panel and diff/timeline collapse
  into a tabbed right-hand drawer; file tree collapses to an overlay
  triggered from the activity bar.
- **Mobile / remote-control** (<768px): this is a *remote session* UI, not
  a full IDE recreation. Primary surfaces are: task status, diff review
  (read + approve/reject), and a lightweight chat input. Full multi-pane
  editing is explicitly out of scope for the phone form factor — see
  PRD non-goals.
- Breakpoints are defined once as tokens (`--bp-sm/md/lg/xl`) and consumed
  everywhere; no ad hoc pixel checks in component code.

---

## 4. Component System

**Recommendation: Radix UI primitives + Tailwind CSS, wrapped in a
project-owned component layer (`packages/ui`), token-driven via CSS
variables.**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Radix primitives + Tailwind + custom tokens | Unstyled/accessible-by-default primitives (focus mgmt, ARIA, keyboard nav built in); full control over visual identity so the app doesn't read as a generic AI-chat template; tree-shakeable; matches "serious IDE" goal since we're not fighting an opinionated theme | More upfront work authoring the component layer and design tokens ourselves | **Recommended** |
| Mantine | Fast to build with, large batteries-included component set | Strong visual opinion that's hard to fully erase — risks the "generic app" look we're explicitly avoiding; heavier bundle | Rejected for primary UI |
| Fluent UI (Microsoft) | IDE-adjacent visual language (close to VS Code's own DNA), solid accessibility | Coupled to Microsoft's evolving design language; less flexible for a distinct brand identity; React-only, complicates future non-React surfaces | Rejected, revisit only if we want deliberate VS Code-alikeness |
| Build fully from scratch (no primitive library) | Maximum control | Reinventing accessible focus/keyboard/portal behavior is high-risk, high-cost, and exactly where "polished" projects quietly fail | Rejected |

Rationale: an IDE's credibility rests on precise, unglamorous interaction
details (focus order, escape-to-close, roving tabindex in lists, portal
z-index correctness). Radix solves those correctly and invisibly, leaving
our design effort focused on visual identity and IDE-specific components
(diff viewer, file tree, task plan cards, permission indicator) that no
off-the-shelf kit provides anyway.

**Editor: Monaco**, over CodeMirror 6, for v1. Monaco gives us VS Code-
grade language intelligence integration (LSP client ecosystem, familiar
keybindings, minimap, multi-cursor) essentially for free, which matters
more than its larger bundle size for a desktop-first product. CodeMirror 6
is revisited if/when a lightweight web or mobile editing surface is
prioritized (smaller footprint, more mobile-friendly touch handling).

---

## 5. States

Every view that can be empty, loading, errored, or overflow with content
must design for all four *before* the happy path ships.

### 5.1 Empty States
- Always explain *why* it's empty and *what action* resolves it (e.g. "No
  files indexed yet — Paleonyx indexes on first open" with a progress
  affordance, not "No results").
- Never a bare illustration with no path forward. Illustration, if used, is
  restrained line art in the neutral palette — not a mascot, not a
  gradient blob.

### 5.2 Loading States
- Skeletons mirror real content geometry (file tree skeleton looks like a
  tree, not generic bars) — or, if that's not feasible, use a plain
  indeterminate indicator rather than a misleading skeleton.
- Long-running agent operations show *what step* is in progress ("Running
  test suite (2/5)"), not just a spinner. This is a direct requirement
  from principle #3.
- Any operation over ~2s gets a cancel affordance.

### 5.3 Error States
- Errors are specific and actionable: what failed, why (if known), and the
  next step (retry, view logs, adjust permissions). Never a bare "Something
  went wrong."
- Agent tool-execution errors surface inline in the task/plan view, with
  the raw tool output available on expand — never swallowed into a vague
  chat message.
- Destructive-adjacent errors (failed write, partial apply) always link
  directly to the diff/timeline entry so the user can see exactly what
  state the files are in.

### 5.4 Long Content
- Editor and diff views virtualize; the file tree virtualizes for large
  repos.
- Long agent responses and large diffs truncate with an explicit "Show
  more" / expand-all — never infinite silent scroll, never auto-collapsed
  with no indication more exists.
- Large diffs default to a summary (files changed, +/- counts) with
  per-file expansion, so a 40-file agent change doesn't dump an
  unreadable wall of text.

---

## 6. Agent-Specific UX Patterns

These are the components that make this an IDE-grade agent tool rather than
a chat window bolted onto a file tree.

### 6.1 Skill-Level Adaptation

This is a headline differentiator for the product (per PRD.md §2/§4), not a
cosmetic setting, so it gets its own pattern rather than being folded into
general preferences.

- **Skill Level control**: a persistent, user-set value — New to coding /
  Experienced / Professional (PRD.md §9 decision 4) — first chosen during
  onboarding (§6.3) and reachable afterward from Settings and the status
  bar area. Never silently inferred and silently acted on without the
  user seeing the current setting; the app may *suggest* a level based on
  behavior, but changing it is always an explicit user action.
- **Explanation Depth, not a different product**: the skill-level setting
  changes how much the agent explains (terse + assumes vocabulary at
  Professional; walks through reasoning and defines terms at New to
  coding) — it never changes *what* the agent is capable of doing, and
  never blocks a beginner from professional-grade output or a pro from
  asking "explain this like I'm new to it" in the moment.
- **Lesson Callout**: an optional, dismissible inline explainer attached to
  a specific diff or suggestion ("Why this fix works," "What this pattern
  does") — grounded in the user's actual code, never a generic tutorial
  pulled from nowhere. Expanded by default at lower skill levels, collapsed
  (but still available on demand) at Professional. Dismissing one doesn't
  suppress future ones — each is evaluated independently against the
  current setting.
- **No gamification layer** (badges, streaks, XP, progress-bar-to-mastery)
  — this is a professional tool that happens to teach, not a learning app
  that happens to have a code editor. See §8.
- **Pro mode stays terse by construction**: at the Professional setting,
  Lesson Callouts and expanded reasoning default to off, task plans and
  diffs default to their most compact form, and nothing about the skill-
  level system should read as "aimed at beginners" to an experienced user
  — it should be invisible until asked for.

### 6.2 Core Patterns

- **Task Plan Card**: before execution, the agent presents a numbered plan
  (steps, target files, tools it intends to use). Collapsible, always
  re-visitable from history.
- **Diff Review**: side-by-side or inline (user preference), per-file
  approve/reject, with the ability to approve some hunks and not others.
  Applying is a distinct, deliberate action — never implicit in "closing"
  a panel.
- **Permission/Mode Indicator**: always visible (status bar), one of
  `Read-only / Suggest-only / Auto-apply / Can-run-commands`, color-coded
  using the semantic status tokens, one click away from changing it.
  Switching to a more permissive mode requires explicit confirmation with
  a plain-language consequence statement.
- **Context Panel**: explicit list of everything currently in the agent's
  context (files, docs, rules) with per-item remove and a visible add
  action — context is never implicit or hidden.
- **Confidence/Uncertainty Signal**: when the agent flags low confidence
  (ambiguous request, conflicting files, failing verification), it's a
  distinct, consistent visual treatment — not just hedging language in
  prose.
- **Budget Meter**: session limits (writes, commands, tokens) shown as a
  simple consumed/remaining indicator in the status bar, with a clear
  state when a budget is exhausted and the agent has paused for it.
- **Timeline**: a chronological, filterable log of every applied agent
  change, each entry reversible independently (backed by the git-based
  undo system — see CLAUDE.md §5).

### 6.3 Onboarding & Model Setup

First-run only (app-level, not per-project — PRD.md §3 journey 1), and
built from the same screens Settings uses afterward rather than a
disposable one-time UI.

- **Welcome**: one screen, local-first framing, no decisions required yet.
- **Skill Level**: New to coding / Experienced / Professional as
  selectable cards (§6.1's descriptors as body text on each card, not a
  bare radio group) — this is a real choice being made, sized
  accordingly, with a visible "change this anytime in Settings" note so
  it doesn't feel like a one-shot commitment.
- **Model setup** (the Models screen, reused verbatim from Settings):
  - A brief, local-only "here's what we found" hardware summary (RAM, CPU
    cores, GPU/VRAM if detected) — legible per DESIGN.md §1.8's
    local-first-is-visible principle, framed as guidance ("likely to run
    well") rather than a guarantee (PRD.md §8 risk: detection is
    best-effort).
  - The **full** local model catalog stays browsable underneath that
    summary — hardware fit is an annotation/sort signal on every card. If
    the catalog's current view is the bundled offline baseline vs. a
    live-refreshed list (CLAUDE.md §4.1), that's a small, honest label,
    not hidden metadata.
  - One specific exception to "never filtered": entries annotated **"Too
    large for this machine"** are collapsed out of view by default —
    showing a wall of models someone's hardware can't realistically run
    isn't useful density, it's noise (DESIGN.md §1.5). This is a visible,
    reversible UI default, not a data-level exclusion: a plain toggle
    reading **"Show N too-large models"** sits at the bottom of the
    catalog, off by default, one click to reveal — never a silent count
    with no way to see what's behind it (mirrors the "Show more" pattern
    in §5.4). The toggle's state is a remembered local preference, not
    something reset every time the screen opens. "Fits comfortably" and
    "will be slow" entries are always shown; only the "too large" bucket
    gets this default collapse.
  - A **visually secondary, clearly separated** "Bring your own API key"
    section below the local catalog — same visual system, lower emphasis
    (no accent-colored primary buttons, no top billing). This is a
    deliberate hierarchy choice, not an oversight: cloud/BYOK options
    must never visually compete with or outrank local options, or the
    onboarding flow undercuts the product's own local-first positioning.
    Each provider entry: name, a one-line note on free-tier availability
    where one exists, and a link out to that provider's key-creation
    page — entering the key is the only required interaction here.
  - Every choice on this screen is skippable; skipping leaves the
    corresponding budget/permission/model state at its safe default
    rather than blocking progress.
- **Ready**: a one-screen summary of what was chosen, then straight into
  the normal shell — no separate "tour" step bolted on.

---

## 7. Accessibility Rules

- Baseline target: **WCAG 2.1 AA**, verified, not assumed.
- Full keyboard operability: every panel reachable via a documented
  shortcut; command palette (`Cmd/Ctrl+K`-style) as the universal fallback
  for any action.
- Visible focus rings on all interactive elements, using the accent color
  at sufficient contrast against every surface step — never `outline:
  none` without a replacement.
- All icon-only controls have accessible names (`aria-label` or equivalent)
  and a tooltip.
- Color is never the sole signal — diff add/remove, status, and permission
  levels all pair color with icon and/or text.
- Respect OS-level text scaling and `prefers-reduced-motion` /
  `prefers-contrast` where the platform exposes them.
- Screen-reader flows are explicitly designed for the highest-stakes
  interactions first: diff review/approval and permission-mode changes.

---

## 8. What to Avoid ("AI slop" checklist)

Reject a design if it does any of the following:

- Purple/blue gradient backgrounds or buttons used as a default "AI"
  signifier
- Glassmorphism/frosted blur as a primary surface treatment
- Sparkle/magic-wand icons standing in for actual state communication
- Chat-bubble metaphors for agent *actions* (a file edit is not a message)
- Decorative blobs, mesh gradients, or abstract 3D renders in product UI
- Skeleton loaders shaped nothing like the content they precede
- Fake/animated progress that doesn't correspond to real progress
- Emoji used as functional UI signifiers (status, severity, category)
- Overuse of large rounded corners / neumorphic shadows on functional
  chrome (fine, sparingly, on true floating surfaces only)
- Marketing-site whitespace and hero-section patterns bleeding into the
  working IDE surfaces
- Copy that anthropomorphizes uncertainty away ("I've got this!") instead
  of showing calibrated confidence
- Gamification of learning (badges, streaks, XP, level-up moments) — the
  skill-level system (§6.1) teaches through grounded, dismissible
  explanation, not through game mechanics
- Condescending tone at low skill levels (baby-talk, excessive
  exclamation, over-praising trivial actions) or curt/impatient tone at
  high skill levels — both are failures of the same principle (§1.4)
- BYOK/cloud model options given equal or greater visual weight than
  local options anywhere in the product — §6.3's secondary-placement rule
  is the specific fix; the general failure to watch for is any screen
  where "the AI" implicitly means "the cloud" by default styling
- Hardware-fit annotations in the model catalog phrased as guarantees
  ("Will run perfectly") rather than guidance — detection is best-effort
  (PRD.md §8) and the copy must not overclaim certainty it doesn't have

---

## 9. Decisions

1. ~~Component stack~~ — **Decided: Radix + Tailwind**, per §4.
2. ~~Editor~~ — **Decided: Monaco**, per §4.
3. ~~Theming approach~~ — **Decided: dark is the default theme**; light and
   further themes are available in Settings, built on the same token set
   from the start (§2.1).
4. ~~Skill-level taxonomy~~ — **Decided: New to coding / Experienced /
   Professional** (§6.1), fixed three-tier set rather than a slider —
   discrete cards read better for a real onboarding choice than a
   continuous control would.
5. ~~Onboarding structure~~ — **Decided: Welcome → Skill Level → Model
   setup → Ready** (§6.3), sharing the Models screen with Settings rather
   than maintaining a separate onboarding-only version of it.
6. ~~Too-large model visibility~~ — **Decided: hidden by default, behind
   a visible "Show N too-large models" toggle** (§6.3) — a reversible UI
   default, not a data-level exclusion; "fits comfortably" and "will be
   slow" entries always show.
7. **Open**: exact accent hue. Tentatively proposing a warm amber/copper
   (§2.1) in place of the generic AI blue/purple; final value pending a
   dedicated token-exploration pass before implementation.
