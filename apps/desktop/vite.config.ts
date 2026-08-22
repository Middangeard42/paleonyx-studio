import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri-specific dev server conventions: fixed port matching
// tauri.conf.json's devUrl, and strictPort so a silent port bump never
// desyncs the two.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true,
    watch: {
      // Rust build output changes constantly during `tauri dev` and Vite's
      // watcher grabbing a handle on the in-progress .exe races cargo's
      // own writes to it — on Windows that's a hard EBUSY crash, not just
      // a wasted rebuild. src-tauri is never a frontend source anyway.
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
});
