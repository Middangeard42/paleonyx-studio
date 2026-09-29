# Paleonyx Studio

A local-first AI IDE. It treats AI-assisted editing as an engineering
workflow — explicit plans, reviewable diffs, safe undo, and visible
permissions — rather than a chat window added to a text editor. Your code
and prompts stay on your machine unless you turn a remote provider on.

**Status: early development.** There is no release yet, and it is not ready
for everyday use. The desktop app has so far only been built and tested on
Windows.

## What it does

- **Proposes, then waits.** The agent produces a plan and a diff. Nothing is
  written until you approve it, unless you have opted a project into
  auto-apply.
- **Undo that is safe.** Every applied change is recorded in your project's
  git repository, on a separate ref, and can be undone on its own without
  touching your commits or your other edits.
- **Visible permissions.** Read-only, suggest-only, auto-apply, and
  can-run-commands are explicit per-project modes. Commands run from an
  allowlist, with no shell.
- **Local models first.** It talks to models on your machine through Ollama.
  Bring-your-own-key providers (OpenRouter, Groq) are opt-in.
- **Connected tools.** Local MCP servers can give the agent extra tools, each
  one approved by you and only usable in can-run-commands mode.
- **Live preview and design mode.** Preview your project, click an element,
  and describe the change you want.

The scope is in [PRD.md](PRD.md), the design rules in [DESIGN.md](DESIGN.md),
and the engineering conventions in [CLAUDE.md](CLAUDE.md).

## Building

You need Node 20 or later, [pnpm](https://pnpm.io) 9 (the exact version is
pinned in `package.json`), and a Rust toolchain.

```sh
pnpm install
pnpm verify                                   # lint, typecheck, unit tests
pnpm --filter @paleonyx/desktop tauri dev     # run the desktop app
```

On a Windows computer that has never had the project on it, follow
[docs/windows-setup.md](docs/windows-setup.md) first: it lists everything
to install, in order, and what to do when a step fails.

The desktop end-to-end tests drive the real app and run on Windows only:
`pnpm --filter @paleonyx/desktop e2e`.

To work on it with Claude Code in the cloud, see
[docs/cloud-sessions.md](docs/cloud-sessions.md).

## Licence

Copyright (C) 2026 Paleonyx <support@paleonyx.com>

Paleonyx Studio is free software, licensed under the GNU Lesser General
Public License, version 3 or (at your option) any later version. The licence
is in [COPYING.LESSER](COPYING.LESSER); it adds permissions to the GNU General
Public License in [COPYING](COPYING).

In short: you may use, study, change, and share it, and if you distribute a
modified version you must share your changes under the same licence. Other
software that links to this code as a library may be under different terms,
within the limits the licence sets. The licence text is the authority; this
paragraph is only a summary.
