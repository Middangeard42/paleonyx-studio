/**
 * The browsable/installable model list — distinct from `ModelInfo` /
 * `ModelCapabilities`, which describe a single *already-configured*
 * provider (CLAUDE.md §4.1).
 */

/**
 * Weight formats we can estimate memory for. Bits-per-parameter for each
 * lives in packages/system-profile — the catalog only names the format.
 */
export type Quantization = "q4_K_M" | "q5_K_M" | "q6_K" | "q8_0" | "f16";

export interface ModelCatalogEntry {
  /** Pull id for the runtime that serves it, e.g. "qwen2.5-coder:7b". */
  id: string;
  label: string;
  /** Which local runtime can install this, e.g. "ollama". */
  runtime: string;
  /** Total parameters. All of them occupy memory, MoE included. */
  parametersBillions: number;
  /**
   * Set only for mixture-of-experts models, where far fewer parameters
   * are active per token than are resident in memory. Memory always
   * follows the total; speed follows this. Left undefined when a model
   * is dense, or when an MoE's active count isn't published — the fit
   * heuristic then falls back to the total, which under-promises rather
   * than overclaims.
   */
  activeParametersBillions?: number;
  defaultQuantization: Quantization;
  contextWindow: number;
  supportsToolCalling: boolean;
  /** Short, factual description — no marketing copy. */
  description: string;
  /** True for models specifically trained/tuned for code. */
  codeSpecialized: boolean;
}

/**
 * Which source produced the list the user is currently looking at. This
 * is surfaced in the UI, not just tracked internally — the live-refresh
 * path is one of exactly two sanctioned network exceptions (PRD.md §6)
 * and its visibility is what keeps it sanctioned rather than silent.
 */
export type CatalogSource = "bundled" | "live";

export interface ModelCatalog {
  source: CatalogSource;
  entries: ModelCatalogEntry[];
  /**
   * When the underlying data was produced: the app's release date for
   * `bundled`, or fetch time for `live`.
   */
  retrievedAt: string;
  /**
   * Catalog ids already present on this machine. Kept alongside the
   * entries rather than as a flag on them, because installed-ness is
   * machine state that changes independently of the catalog data.
   */
  installedIds: string[];
}
