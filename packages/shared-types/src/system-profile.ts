/**
 * Read-only description of the machine, used only to annotate the model
 * catalog with hardware fit (CLAUDE.md §4.1). Desktop-only: `apps/web`
 * has no way to obtain this and shows the catalog unannotated rather
 * than fabricating one.
 */
export interface SystemProfile {
  totalMemoryBytes: number;
  /** Free right now — fluctuates, so fit scoring uses total, not this. */
  availableMemoryBytes: number;
  cpuCoreCount: number;
  /** Undetected GPUs are `undefined`, never a zeroed-out placeholder. */
  gpu?: GpuInfo;
  os: OsInfo;
}

export interface GpuInfo {
  name: string;
  /**
   * Undefined when a GPU was found but its dedicated memory couldn't be
   * read. Distinct from "no GPU" — the fit heuristic treats the two
   * differently (see packages/system-profile).
   */
  vramBytes?: number;
}

export interface OsInfo {
  /** e.g. "windows", "macos", "linux". */
  platform: string;
  version: string;
  arch: string;
}

/**
 * How well a catalog entry is expected to run here. Deliberately three
 * coarse buckets rather than a numeric score — detection is best-effort
 * (PRD.md §8) and a precise-looking number would overclaim.
 */
export type HardwareFit = "fits-comfortably" | "will-be-slow" | "too-large";

/**
 * `undefined` fit means "no profile available" (i.e. web), which is
 * distinct from any of the three real buckets — callers must render that
 * as unannotated, not as a guess.
 */
export interface FitAssessment {
  fit: HardwareFit;
  /** One short, plain-language sentence for the UI. Never a guarantee. */
  rationale: string;
  estimatedMemoryBytes: number;
}
