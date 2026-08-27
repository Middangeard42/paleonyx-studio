import { invoke } from "@tauri-apps/api/core";

export interface PreviewInfo {
  port: number;
}

/**
 * Starts the local preview server for the opened project, or returns
 * the running one's port if it is already serving this project.
 *
 * Bound to 127.0.0.1 in the shell, so the URL this produces is only
 * reachable from this machine — the preview never becomes a way to
 * expose the user's project to the network.
 */
export async function startPreview(): Promise<PreviewInfo> {
  return invoke<PreviewInfo>("start_preview");
}

export async function stopPreview(): Promise<void> {
  await invoke("stop_preview");
}

/**
 * Builds the URL for one file in the served project.
 *
 * Each segment is encoded separately so a folder or file with a space
 * or a `#` in its name resolves, while the separators stay separators.
 */
export function previewUrl(port: number, entryPath: string): string {
  const encoded = entryPath
    .split(/[\\/]/)
    .map(encodeURIComponent)
    .join("/");
  return `http://127.0.0.1:${port}/${encoded}`;
}

/**
 * Turns the preview server's selection script on or off.
 *
 * The flag lives in the shell rather than in a URL, so a previewed page
 * cannot instrument itself. Callers must reload the frame afterwards —
 * the script is added as a page is served, so an already-loaded page
 * does not have it.
 */
export async function setDesignMode(enabled: boolean): Promise<void> {
  await invoke("set_design_mode", { enabled });
}
