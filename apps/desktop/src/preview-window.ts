import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const PREVIEW_WINDOW_LABEL = "preview";

/**
 * Opens the running project in its own window.
 *
 * The label matters. Capabilities in `capabilities/default.json` are
 * granted to `windows: ["main"]`, so a window labelled anything else
 * gets no permissions at all — it cannot invoke a single command. That
 * is the point: this window renders the user's project, which is often
 * code a model proposed and nobody has read closely, and it must be
 * able to reach nothing.
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
