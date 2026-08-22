import type {
  FitAssessment,
  ModelCatalogEntry,
  SystemProfile,
} from "@paleonyx/shared-types";
import { estimateTotalMemoryBytes } from "./memory-estimate.js";

const GIB = 1024 ** 3;

/**
 * Memory left for the OS, this app, and whatever else the user has open.
 * Scales with total RAM but is floored so small machines aren't assumed
 * to have a usable 90%, and capped so large machines aren't penalized.
 */
function usableSystemMemoryBytes(profile: SystemProfile): number {
  const reserve = Math.min(8 * GIB, Math.max(3 * GIB, profile.totalMemoryBytes * 0.2));
  return Math.max(0, profile.totalMemoryBytes - reserve);
}

/** Display/compositor overhead — smaller and flatter than the RAM reserve. */
function usableVramBytes(vramBytes: number): number {
  const reserve = Math.min(1.5 * GIB, Math.max(0.5 * GIB, vramBytes * 0.1));
  return Math.max(0, vramBytes - reserve);
}

/**
 * Above roughly this many *active* parameters, CPU-only inference is
 * slow enough to be unpleasant for interactive editing even when the
 * model fits in RAM. Below it, CPU inference is usable.
 */
const COMFORTABLE_CPU_PARAMETERS_B = 9;

/**
 * Parameters actually computed per token. For a mixture-of-experts model
 * this is far below the resident total, which is exactly why MoE is
 * attractive locally: it costs memory like a large model but runs closer
 * to the speed of a small one.
 */
function activeParameters(entry: ModelCatalogEntry): number {
  return entry.activeParametersBillions ?? entry.parametersBillions;
}

/**
 * Sorts a catalog entry into one of three coarse buckets for this
 * machine (CLAUDE.md §4.1).
 *
 * Returns `undefined` when there's no profile to judge against — callers
 * must render that as *unannotated*, which is distinct from any real
 * bucket. `apps/web` always takes this path (DESIGN.md §5's
 * real-states-only rule: no fabricated hardware).
 */
export function assessFit(
  entry: ModelCatalogEntry,
  profile: SystemProfile | undefined
): FitAssessment | undefined {
  if (!profile) return undefined;

  const estimatedMemoryBytes = estimateTotalMemoryBytes(entry);
  const usableRam = usableSystemMemoryBytes(profile);
  const vram = profile.gpu?.vramBytes;

  if (vram !== undefined && estimatedMemoryBytes <= usableVramBytes(vram)) {
    return {
      fit: "fits-comfortably",
      rationale: `Should fit in your ${formatGib(vram)} of graphics memory.`,
      estimatedMemoryBytes,
    };
  }

  if (estimatedMemoryBytes > usableRam) {
    return {
      fit: "too-large",
      rationale: `Needs about ${formatGib(estimatedMemoryBytes)}, more than this machine can spare.`,
      estimatedMemoryBytes,
    };
  }

  // Fits in RAM. Whether that's pleasant depends on how much of the work
  // lands on the CPU.
  if (vram !== undefined) {
    return {
      fit: "will-be-slow",
      rationale: `Larger than your graphics memory, so part of it runs on the CPU.`,
      estimatedMemoryBytes,
    };
  }

  if (activeParameters(entry) <= COMFORTABLE_CPU_PARAMETERS_B) {
    return {
      fit: "fits-comfortably",
      rationale: entry.activeParametersBillions
        ? `Only ${entry.activeParametersBillions}B parameters run per token, so it stays usable on the CPU.`
        : `Small enough to run on the CPU at a usable speed.`,
      estimatedMemoryBytes,
    };
  }

  return {
    fit: "will-be-slow",
    rationale: `Fits in memory, but this size is slow without a dedicated GPU.`,
    estimatedMemoryBytes,
  };
}

function formatGib(bytes: number): string {
  const gib = bytes / GIB;
  return `${gib < 10 ? gib.toFixed(1) : Math.round(gib)} GB`;
}
