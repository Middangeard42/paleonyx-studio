# Setting up a Windows computer for Paleonyx Studio

For testing on a computer that has never had the project on it. Allow about
an hour: most of it is downloads and the first Rust build, which is slow
once and fast afterwards.

Nothing here needs an account. The repository is public.

## 1. Install the tools (once)

Restart the terminal (or the computer) after these so the new programs are
found. Each has a command to check it.

1. **Git for Windows** — <https://git-scm.com/download/win>. The default
   options are fine. Check: `git --version`
2. **Node.js 20 or later** (the LTS version) — <https://nodejs.org>.
   Check: `node --version`
3. **Rust** — <https://rustup.rs>. Run `rustup-init.exe` and take the
   default (MSVC). It will tell you it needs the Visual Studio C++ build
   tools. Install **Visual Studio Build Tools 2022** and, in its installer,
   tick **Desktop development with C++**. Do not skip this: the project
   compiles C code, and without the tools the first build stops with
   `link.exe not found`. Check: `rustc --version` and `cargo --version`
4. **WebView2 runtime** — already present on Windows 11 and on an
   up-to-date Windows 10. Only if the app opens to a blank window,
   install the "Evergreen" runtime from Microsoft.
5. **Ollama** — <https://ollama.com/download/windows>. Start it once. The
   app looks for it at `http://localhost:11434`, and downloads models
   through its **Models** panel, so you do not pull models by hand.
   Check: `ollama --version`

You do **not** need to install pnpm. Every command below uses
`npx pnpm@9.12.0`, the version the project pins.

## 2. Get the code

Use a short folder near the top of a drive. Windows stops at 260
characters in a path, and `node_modules` and the Rust build go deep.

```powershell
mkdir C:\dev
cd C:\dev
git clone https://github.com/Middangeard42/paleonyx-studio.git
cd paleonyx-studio
```

Testing needs no git identity. **Only if you will commit from this
computer**, set it for this repository alone, not globally:

```powershell
git config user.name "Paleonyx Studio"
git config user.email "support@paleonyx.com"
git commit -s -m "..."        # -s adds the sign-off the dco check requires
```

Pushing from a new computer asks you to sign in to GitHub in a browser the
first time.

## 3. Install and run the automated checks

```powershell
npx pnpm@9.12.0 install
npx pnpm@9.12.0 verify
```

`verify` runs lint, type checks and the unit tests. Expected: everything
passes. The Rust tests are separate, and the first build takes several
minutes:

```powershell
cd apps\desktop\src-tauri
cargo test
cd ..\..\..
```

Expected: `test result: ok` and no failures.

## 4. Run the desktop end-to-end tests

They drive the real app, so close any running copy first. They need no
model.

```powershell
npx pnpm@9.12.0 --filter @paleonyx/desktop e2e
```

Windows open and close on their own. Expected: every journey passes. They
use a throwaway profile and a temporary project, so your own settings are
not touched. If one fails, read the **first** failure: later ones are often
the app left in a state the next one did not expect.

## 5. Run the app

```powershell
npx pnpm@9.12.0 --filter @paleonyx/desktop tauri dev
```

The first start compiles the Rust side: several minutes. Later starts take
seconds.

## 6. Build the release version (for the console-window check)

A development build already has a console, so a stray console window only
shows up in a release build. This skips the installer:

```powershell
npx pnpm@9.12.0 --filter @paleonyx/desktop tauri build --no-bundle
```

Then run `apps\desktop\src-tauri\target\release\paleonyx-desktop.exe`.

## Then the manual checklist

[manual-test-checklist.md](manual-test-checklist.md), starting with the
section "Changed since the last Windows test".

## If something fails

| What you see | Likely cause |
| --- | --- |
| `link.exe not found`, or a C compiler error in the first build | The C++ build tools are missing. Re-run the Visual Studio Build Tools installer and tick **Desktop development with C++**. |
| A blank window | The WebView2 runtime is missing or out of date. |
| `Port 5174 is already in use` | Another `tauri dev` is running. Close it. |
| A path-too-long error | The folder is too deep. Clone nearer the top of a drive, for example `C:\dev`. |
| `npx` asks to install `pnpm` | Say yes. It is the pinned version. |
| The first build takes 10 minutes or more | Normal once. Antivirus scanning the build folder makes it slower; excluding the project folder helps. |
| Windows warns about an unknown publisher when you run the release `.exe` | It is not signed. You built it yourself, so choose to run it. |
