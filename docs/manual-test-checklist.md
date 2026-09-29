# What to test next time

Everything below is committed on `main`. Items are in priority order —
the first three are where a real model and a real folder matter most, and
where the automated tests can't stand in for you.

When something goes wrong, a screenshot of the message plus the model name
is the most useful thing to send back.

---

## Before you start

- [ ] Launch the app the usual way (`tauri dev`). The Rust side changed, so
      the first start rebuilds for about a minute.
- [ ] **Models panel → Rescan.** Ornith should now be marked *can run
      commands*. If it still says it can't call tools, send a screenshot.

## New this time: connected tools (MCP)

The agent can now use tools from MCP servers — small programs that
give it extra abilities. This is the first time a real server will have
run inside the app; the automated tests use a small fake one.

- [ ] In a test project, create `.paleonyx/mcp.json` with:

      {
        "mcpServers": {
          "memory": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-memory"]
          }
        }
      }

      This is the official "memory" server. The first start downloads it
      with npx, which takes a little while.
- [ ] Open the project → the **plug icon** (Connected tools) on the left.
      Expected: *memory* listed as **Needs your OK**, showing the exact
      command. Nothing is running yet.
- [ ] Click **Allow** while the project is still *Suggest-only*.
      Expected: **Allowed — not running**. It should not start yet.
- [ ] Status bar → switch to **Can run commands**. Expected: the server
      starts (**Starting…**, then **Running**) and lists its tools, all
      switched on. If it shows **Couldn't run**, screenshot the message and
      the log under it.
- [ ] Switch a couple of tools off. Pick a model marked *can run
      commands* (Ornith), then ask something like *"Remember that this
      project uses tabs, then tell me what you remember."* Expected: *What
      the agent checked* shows a plug icon for each tool it used; clicking
      one shows **Sent** and **Returned**.
- [ ] Switch back to *Suggest-only*. Expected: the server stops.
- [ ] Edit `mcp.json`: add `"env": { "EXAMPLE": "1" }` next to `args`.
      Expected: the server shows **Changed — check again** and does not
      start until you allow it again. Its tool choices are kept.
- [ ] Close the app while a server is running, then check Task Manager:
      no leftover `node` processes from it.

## Also fixed this time — worth a quick check

- [ ] **`npm test` can now actually run on Windows.** Before, the app
      could never start `npm` or `npx` at all (they are `.cmd` files).
      In a project with a `test` script: *Can run commands* → **Bug Fix**
      → ask why a test fails. Expected: *What the agent checked* shows
      `npm test` with its real output.
- [ ] While that test run is going, the window should stay responsive
      (drag a panel). Long commands used to run on the app's main thread.
- [ ] The preview could occasionally show a blank page or a missing
      image, especially while a model was busy. Two causes found and
      fixed; mention it if you still see one.
- [ ] **No black console window flashes for git.** This needs a release
      build (`pnpm --filter @paleonyx/desktop tauri build`), because a
      development build already has a console. Run the app from the
      installed build, open a project, and apply a change. Expected: no
      black window appears at any point. The agent's `git` calls were the
      only ones missing the setting that hides it. Changed without being
      run on Windows.

## 1. Design changes with a real model — most important

The last session found and fixed four separate reasons these failed. This
is the first real test since.

- [ ] Open the chicken-counter project → **Show preview** → **Select
      something to change** (the pointer icon).
- [ ] Click the heading and ask for new text.
- [ ] Click the button and ask for it to be bigger.
- [ ] Click the button and ask for bigger text.
- [ ] Expected: *What the agent checked* shows the file read **once**. It
      should not try `sed`, `cat`, or `npm run preview`. If it does try a
      command, it should still come back with a proposed change instead of
      stopping.
- [ ] If a change is refused, the message now says *which line* it expected
      and couldn't find. Screenshot that message.

## 2. Start something new — into an **empty** folder

This was broken before today and nobody knew: creating a file inside a
folder that didn't exist yet (like `src/app.js`) failed. Your earlier test
only worked because that folder already had `src/`.

- [ ] **Start something new** → create a brand-new, empty folder in the
      picker → describe something small → pick **Android** and **iOS**.
- [ ] **Apply change.** It will first offer to create a git repository —
      that's expected, since undo history lives there. Expected after that:
      every file is created, including any in subfolders.
- [ ] Preview at **Phone** width. The page should be laid out for a phone.
- [ ] Open `index.html` and check no `<script src="….ts">` appears — the
      browser can't run those.

## 3. Skills — new

- [ ] Open a file, add it to context → Task → **Use a skill** → **Look for
      bugs** → the task box fills in, but nothing runs until you press
      **Run**.
- [ ] Type a task of your own → **Save as skill** → give it a name.
      Expected: `.paleonyx/skills/<name>.md` appears in the file tree, and
      the skill shows up under *From this project*.
- [ ] Choose that saved skill. Expected: a notice that it came from the
      project, above the task box.
- [ ] Edit the saved file by hand and add a line `permission:
      can-run-commands` under `task:`. Reopen the project. Expected: a
      warning that *1 skill file couldn't be used*, explaining that a skill
      can't change what the agent is allowed to do.

## 4. Project conventions file — was silently broken

`.paleonyx/context.md` has never loaded in the desktop app until today.

- [ ] Create `.paleonyx/context.md` in a project with a clear rule, e.g.
      *Always use single quotes in JavaScript.*
- [ ] Reopen the project. Expected: *Follow this project's conventions*
      lists `.paleonyx/context.md`.
- [ ] Ask for a small change. Does the model follow the rule?

## 5. Panels and the pop-out preview

- [ ] Drag the three dividers (file panel, preview, agent panel). Reopen
      the project — the widths should be kept.
- [ ] Preview → **Open in its own window**. Resize it. Apply a change and
      check the pop-out updates (press its reload if not).
- [ ] Note: selecting an element for a design change only works in the
      panel, not in the pop-out. That's expected.

## 6. Models

- [ ] Download a small model you don't have. Watch the progress bar.
- [ ] Cancel a download part-way, then start it again.
- [ ] Remove a model. Expected: it asks first, and asks differently if it's
      the one in use.
- [ ] With Ornith, run a **Bug Fix**. *What the agent checked* should list
      what it read.

## 7. Budgets and task types

- [ ] Click **Budget** in the status bar. Raise *Steps it may take* to
      about 16 — Ornith now uses real steps and may hit the default 8.
- [ ] Try **Refactor**, **Write Tests**, and **Document** once each.

## 8. Optional — run the automated desktop tests yourself

- [ ] Stop `tauri dev` first; the tests need its port.
- [ ] Run `npx pnpm@9.12.0 --filter @paleonyx/desktop e2e`
- [ ] Windows will open and close on their own for about half a minute.
      Expected: **16 passed**. They use a throwaway profile and a temporary
      project, so your own settings aren't touched.

---

## Decisions waiting on you

- [x] **Licence** — LGPL-3.0-or-later, decided and added. See PRD §10 for
      what it does and does not protect.
- [x] **Copyright line** — "Copyright (C) 2026 Paleonyx
      <support@paleonyx.com>" in the README's Licence section. Nothing here
      uses your real name.
- [x] **Commit email** — every commit now uses `support@paleonyx.com`.
      GitHub links commits to an account by their email, so until that
      address is added and verified under GitHub → Settings → Emails,
      commits show your name without a link to your profile.
- [x] **Contribution policy** — a DCO, decided. `CONTRIBUTING.md` says how
      to sign off. Nothing enforces it yet: before the first outside
      contribution, decide whether to add a CI check for `Signed-off-by`.
- [x] **Web companion over Cloudflare** — same-machine only for now
      (PRD §10). A user-started tunnel is a possible later addition.
- [ ] **Design mode: source-tagging review (end of v1)** — remind the owner.
      Leaning: React, Angular, Vue.js, Next.js and Svelte first, more on
      demand (PRD §10). Decide from real use: which frameworks people open,
      and how often search misses the right element.
- [x] **Design mode: screenshot option** — deferred to the larger
      design-mode build (PRD §10).
