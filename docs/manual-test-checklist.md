# What to test next time

Everything below is committed on `master`. Items are in priority order —
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
      Expected: **13 passed**. They use a throwaway profile and a temporary
      project, so your own settings aren't touched.

---

## Decisions waiting on you

- [ ] **Licence** — MIT, Apache-2.0, GPL-3.0, or AGPL-3.0. This is the only
      thing blocking publishing to GitHub. See PRD §10.
- [ ] **Web companion over Cloudflare** — which of the three shapes in
      PRD §10. Needed before that work starts.
