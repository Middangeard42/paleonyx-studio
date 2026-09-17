import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const PREVIEW_WINDOW_LABEL = "preview";

/**
 * Opens the running project in its own window.
 *
 * This window renders the user's project, which is often code a model
 * proposed and nobody has read closely, so it must not be able to call
 * the app. What guarantees that is where the page comes from, not what
 * the window is called: it is served from the preview server's own
 * origin, and Tauri grants a capability to a remote origin only when that
 * capability lists it. None does, so every command is refused.
 *
 * Established by experiment rather than assumed. The end-to-end suite
 * calls `read_project_file` from this window and expects a refusal; that
 * held even with this label added to the main capability's windows,
 * which is what showed the label was not the protection. Keeping the
 * label out of that list is still right — it costs nothing — but the
 * rule to preserve is: never add the preview server's address to a
 * capability's `remote` URLs.
 *
 * Focuses the existing window rather than stacking duplicates, which is
 * what pressing the button twice should do.
 */
export async function openPreviewWindow(url: string): Promise<void> {
  const existing = await WebviewWindow.getByLabel(PREVIEW_WINDOW_LABEL);
  if (existing) {
    await existing.setFocus();
    return;
  }

  const created = new WebviewWindow(PREVIEW_WINDOW_LABEL, {
    url,
    title: "Preview — Paleonyx Studio",
    width: 480,
    height: 860,
  });

  await new Promise<void>((resolve, reject) => {
    void created.once("tauri://created", () => resolve());
    void created.once("tauri://error", (event) =>
      reject(new Error(String(event.payload)))
    );
  });
}

export async function closePreviewWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(PREVIEW_WINDOW_LABEL);
  await existing?.close();
}
