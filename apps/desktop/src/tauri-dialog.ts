import { open } from "@tauri-apps/plugin-dialog";

/**
 * Native folder picker.
 *
 * Granted as `dialog:allow-open` rather than `dialog:default` in the
 * shell's capabilities — the default set also permits save, message,
 * confirm, and ask dialogs, none of which this app uses.
 *
 * Returns `null` when the user cancels, which callers treat as an
 * ordinary outcome rather than a failure.
 */
export async function openFolderDialog(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open a project folder",
  });
  // The plugin types allow an array for multi-select; we ask for one, so
  // anything else is unexpected and treated as no selection.
  return typeof selected === "string" ? selected : null;
}
