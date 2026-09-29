# Working on Paleonyx Studio in a Claude cloud session

A cloud session is Claude Code running on Anthropic's infrastructure instead
of on your computer. It keeps going when you close your laptop, and you can
steer it from the browser, the Claude app on your phone, or the desktop app.
It works from a copy of this repository cloned from GitHub.

This page says what the repository already does for cloud sessions, what
you set up once, and what a cloud session cannot do here.

## What you set up once

1. **Put the repository on GitHub.** A cloud session clones it from there
   and pushes its work to a branch. Private repositories work.
2. **Let Claude reach it.** Either way is fine:
   - At [claude.ai/code](https://claude.ai/code), connect GitHub and install
     the Claude GitHub App on this repository. This is also what allows
     Auto-fix on pull requests.
   - Or run `/web-setup` in a terminal Claude Code session. It sends your
     local `gh` token to your Claude account, so it needs the GitHub CLI.
3. **Check the environment.** The **Default** environment is enough for the
   TypeScript packages. Network access should stay at **Trusted**, which
   allows the npm registry, crates.io, and GitHub. **None** breaks the
   dependency install.
4. **Start a session on the repository.** In the desktop app choose
   **Cloud** instead of **Local** when starting a session, or use the
   **Continue in** menu to send a local session up. From a terminal,
   `claude --cloud "task"` does the same for the current repository. The
   cloud copy comes from GitHub, so push first.

## What the repository does for you

`.claude/settings.json` runs `scripts/cloud-setup.sh` when a session starts
or resumes. In a cloud session it installs the JavaScript dependencies with
the pnpm version pinned in `package.json`. On a developer's machine it does
nothing: the hook only calls the script when `CLAUDE_CODE_REMOTE` is
`true`, and the script checks again.

`.claude/settings.local.json` is not committed. It holds one machine's
permission choices and must not travel.

## What works in the cloud, and what does not

| Works | Why |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | Plain TypeScript; the session image has Node and pnpm. |
| Editing any file, including the Rust shell | Editing needs no toolchain. |
| Reading the PRD, DESIGN, and CLAUDE documents | They are in the repository. |

| Does not work | Why |
| --- | --- |
| Desktop end-to-end tests (`pnpm --filter @paleonyx/desktop e2e`) | They drive WebView2, which is Windows-only. They skip themselves elsewhere. |
| Running the desktop app, or the manual checklist | There is no display and no Windows. |
| Anything that needs a real model | Ollama is not running there. The tests use scripted fakes. |
| `cargo test` for the desktop shell, until the system libraries are installed (Linux tests only) | The shell links against the platform's web view. See below. |

The Rust shell was written on Windows. Some of its tests are Windows-only
and compile out elsewhere. With the libraries below installed it builds on
Linux, and `cargo test` runs 69 tests there; the first attempt turned up
one unused import in a test module, since fixed. `.github/workflows/ci.yml`
runs the tests on GitHub's Linux and Windows machines.

### Building the Rust shell in the cloud

Add a setup script to the environment (the environment dialog at
claude.ai/code). It runs before Claude starts and is cached for later
sessions as long as it finishes in roughly five minutes. These are the
packages Tauri's own prerequisites page lists for Debian and Ubuntu; the
cloud image is Ubuntu 24.04. Installing them by hand as root in a session
worked; the setup-script route is untried.

```sh
apt-get update
apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Cautions

- Environment variables and setup scripts can be read by anyone who can use
  the environment. Do not put a key in them. This project needs none to
  build or test.
- A session can contain code from a private repository. Check a session for
  anything sensitive before sharing it.
- The hook needs network access to install packages, and adds a few
  seconds to every session start and resume.
