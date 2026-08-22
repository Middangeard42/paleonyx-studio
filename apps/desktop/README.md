# apps/desktop

The Tauri desktop shell. Build-verified — `cargo check`, a full `tauri dev`
run (real window, real WebView2), and a real `open_project` →
`list_project_files` → `read_project_file` round trip against this repo
itself all succeeded.

To bring it up:

1. Install Rust: https://rustup.rs
2. Windows only: install the "Desktop development with C++" workload via
   [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   (Tauri needs the MSVC linker).
3. From the repo root: `pnpm install`
4. `pnpm --filter @paleonyx/desktop tauri dev`

Notes from getting it running the first time, in case they resurface:

- `beforeDevCommand`/`beforeBuildCommand` in `tauri.conf.json` call `npx
  vite` rather than `pnpm exec vite` — Tauri spawns them as a raw shell
  command without necessarily inheriting a shell where `pnpm` is
  resolvable, whereas `npx` reliably finds the local install.
- `vite.config.ts` ignores `**/src-tauri/**` in its file watcher. Without
  that, Vite grabs a watch handle on `src-tauri/target/debug/deps/*.exe`
  while cargo is still writing it, which is a hard `EBUSY` crash on
  Windows, not just a wasted rebuild.
- `icons/` is a generated placeholder set (solid color + "P"), not real
  branding — `tauri-build` requires `icons/icon.ico` to exist at all to
  generate the Windows resource, regardless of what `bundle.icon` in
  `tauri.conf.json` lists. Regenerate with `pnpm --filter @paleonyx/desktop
  tauri icon <path-to-1024px-png>` once there's real artwork.
- `capabilities/default.json`'s permission set is unverified beyond "the
  three custom commands work in dev" — it hasn't been checked against a
  `cargo tauri build`-generated schema yet.

`apps/web` runs the identical shared packages (`ui`, `editor`,
`agent-core`, `runtime`, `indexing`) in a plain browser dev server and is
useful for faster UI iteration without a Rust rebuild in the loop.
