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

  const installedById = new Map(installed.map((entry) => [entry.id, entry]));
  const bundledIds = new Set(BUNDLED_CATALOG_ENTRIES.map((entry) => entry.id));
  const extras = installed.filter((entry) => !bundledIds.has(entry.id));

  // Where a model is actually installed, what Ollama reports about that
  // build overrides what the bundled list claims about the model. The
  // bundled entry describes a model in general; Ollama describes the
  // specific build sitting on this machine, and they can disagree — a
  // quantized GGUF may not carry the chat template that makes tool
  // calling work, whatever the model card says.
  const merged = BUNDLED_CATALOG_ENTRIES.map((entry) => {
    const observed = installedById.get(entry.id);
    if (!observed) return entry;
    return {
      ...entry,
      contextWindow: observed.contextWindow,
      supportsToolCalling: observed.supportsToolCalling,
    };
  });

  return {
    source: "bundled",
    retrievedAt: BUNDLED_CATALOG_RETRIEVED_AT,
    entries: [...merged, ...extras],
    installedIds: installed.map((entry) => entry.id),
  };
}

interface OllamaTagsResponse {
  models?: {
    name?: unknown;
    /**
     * Ollama reports what each build can actually do, e.g. ["completion",
     * "tools"]. Worth reading rather than assuming: a model whose card
     * describes tool calling may still ship a GGUF whose chat template
     * does not implement it, and Ollama is the one that knows.
     */
    capabilities?: unknown;
    details?: {
      parameter_size?: unknown;
      quantization_level?: unknown;
      context_length?: unknown;
    };
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
      contextWindow:
        typeof model.details?.context_length === "number"
          ? model.details.context_length
          : 8192,
      supportsToolCalling: hasCapability(model.capabilities, "tools"),
      description: "Installed locally.",
      codeSpecialized: false,
    });
  }

  return refineCapabilities(baseUrl, entries);
}

/**
 * Re-reads tool support from `/api/show`, which is the endpoint that
 * actually knows.
 *
 * Ollama's two endpoints disagree, and not harmlessly. For a GGUF pulled
 * from HuggingFace, `/api/tags` reported `["completion"]` while
 * `/api/show` reported `["tools", "thinking", "completion"]` for the
 * same build — the listing does not analyse the chat template and the
 * inspection does. First-party models agree in both, which is why this
 * went unnoticed: qwen2.5-coder looked right while Ornith, the model
 * this product recommends by default, was told it could not run
 * commands and ran single-pass for it.
 *
 * One request per installed model, on loopback, in parallel. Any that
 * fails keeps whatever `/api/tags` said, so this can only add
 * capabilities we would otherwise have missed.
 */
async function refineCapabilities(
  baseUrl: string,
  entries: ModelCatalogEntry[]
): Promise<ModelCatalogEntry[]> {
  return Promise.all(
    entries.map(async (entry) => {
      try {
        const response = await fetch(`${baseUrl}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: entry.id }),
        });
        if (!response.ok) return entry;
        const shown = (await response.json()) as { capabilities?: unknown };
        if (!Array.isArray(shown.capabilities)) return entry;
        return {
          ...entry,
          supportsToolCalling: hasCapability(shown.capabilities, "tools"),
        };
      } catch {
        return entry;
      }
    })
  );
}

function hasCapability(raw: unknown, capability: string): boolean {
  return Array.isArray(raw) && raw.includes(capability);
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
