import type {
  ModelCatalog,
  ModelCatalogEntry,
  Quantization,
} from "@paleonyx/shared-types";
import {
  BUNDLED_CATALOG_ENTRIES,
  BUNDLED_CATALOG_RETRIEVED_AT,
} from "./bundled-catalog.js";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export interface LoadCatalogOptions {
  ollamaBaseUrl?: string;
}

/**
 * Builds the browsable catalog: the bundled baseline, plus whatever is
 * actually installed in the local Ollama instance (including models we
 * don't ship an entry for — a user's own pulls belong in their catalog).
 *
 * Note on the "live" source in CLAUDE.md §4.1: it is not implemented
 * yet, and this function never returns `source: "live"`. Ollama exposes
 * no public API for its full model library, only for what's installed
 * locally, so a real live refresh needs a Paleonyx-hosted index that
 * doesn't exist. Everything this function touches is on localhost — no
 * traffic leaves the machine — so the labeling requirement attached to
 * the live path isn't in play until that index is built.
 */
export async function loadModelCatalog(
  options: LoadCatalogOptions = {}
): Promise<ModelCatalog> {
  const baseUrl = options.ollamaBaseUrl ?? DEFAULT_OLLAMA_URL;
  const installed = await fetchInstalledModels(baseUrl);

  const bundledIds = new Set(BUNDLED_CATALOG_ENTRIES.map((entry) => entry.id));
  const extras = installed.filter((entry) => !bundledIds.has(entry.id));

  return {
    source: "bundled",
    retrievedAt: BUNDLED_CATALOG_RETRIEVED_AT,
    entries: [...BUNDLED_CATALOG_ENTRIES, ...extras],
    installedIds: installed.map((entry) => entry.id),
  };
}

interface OllamaTagsResponse {
  models?: {
    name?: unknown;
    details?: { parameter_size?: unknown; quantization_level?: unknown };
  }[];
}

/**
 * Returns [] when Ollama isn't running — a missing local runtime is an
 * ordinary state here, not an error worth propagating: the bundled
 * catalog is still perfectly browsable without it.
 */
async function fetchInstalledModels(baseUrl: string): Promise<ModelCatalogEntry[]> {
  let payload: OllamaTagsResponse;
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) return [];
    payload = (await response.json()) as OllamaTagsResponse;
  } catch {
    return [];
  }

  if (!Array.isArray(payload.models)) return [];

  const entries: ModelCatalogEntry[] = [];
  for (const model of payload.models) {
    if (typeof model.name !== "string") continue;
    entries.push({
      id: model.name,
      label: model.name,
      runtime: "ollama",
      parametersBillions: parseParameterSize(model.details?.parameter_size) ?? 7,
      defaultQuantization: parseQuantization(model.details?.quantization_level),
      // Ollama's tag listing doesn't report either of these, and guessing
      // high would misrepresent what the model can do. Conservative
      // defaults; a real capability probe is a v1 concern.
      contextWindow: 8192,
      supportsToolCalling: false,
      description: "Installed locally.",
      codeSpecialized: false,
    });
  }
  return entries;
}

/** Parses Ollama's "8.0B" / "1.5B" style parameter-size strings. */
function parseParameterSize(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined;
  const match = raw.match(/^([\d.]+)\s*([BM])$/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return match[2]?.toUpperCase() === "M" ? value / 1000 : value;
}

const QUANTIZATION_ALIASES: Record<string, Quantization> = {
  q4_k_m: "q4_K_M",
  q5_k_m: "q5_K_M",
  q6_k: "q6_K",
  q8_0: "q8_0",
  f16: "f16",
};

function parseQuantization(raw: unknown): Quantization {
  if (typeof raw !== "string") return "q4_K_M";
  return QUANTIZATION_ALIASES[raw.toLowerCase()] ?? "q4_K_M";
}
