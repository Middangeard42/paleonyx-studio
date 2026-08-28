/**
 * Progress of a model download (PRD.md §3 journey 9).
 *
 * Here rather than in `runtime` because both sides need it: the adapter
 * that produces it and the panel that renders it. Putting it in the
 * package that computes it would make `ui` depend on `runtime` for a
 * shape, which is the wrong direction for a type.
 */
export interface ModelPullProgress {
  /** The runtime's own words for what is happening, e.g. "downloading". */
  status: string;
  /** 0–1 across the whole download, or null before any size is known. */
  fraction: number | null;
  completedBytes: number | null;
  totalBytes: number | null;
}

/**
 * A download size a person can read.
 *
 * Beside the type it formats so there is one definition: the runtime
 * produces these numbers and the panel renders them, and two copies of
 * the rounding rules would eventually disagree about the same figure.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 10, none above, where it stops carrying meaning.
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
