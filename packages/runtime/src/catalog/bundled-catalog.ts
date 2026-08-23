import type { ModelCatalogEntry } from "@paleonyx/shared-types";

/**
 * Offline-safe baseline for the model catalog (CLAUDE.md §4.1). This is
 * a point-in-time snapshot of widely-available Ollama models, not a
 * live index — the hybrid live-refresh path exists precisely because
 * this list goes stale between releases.
 *
 * Parameter counts and context windows are as published by the model
 * authors; memory figures are *not* stored here — packages/system-profile
 * derives those, so one estimator change updates every entry at once.
 *
 * Deliberately not a curated shortlist: entries are added here on
 * availability, never trimmed to steer users toward a favored few. The
 * only narrowing anywhere is the UI's default collapse of "too large"
 * entries, which is reversible in one click (DESIGN.md §6.3).
 */
export const BUNDLED_CATALOG_ENTRIES: ModelCatalogEntry[] = [
  // Ornith-1.0 — the recommended default family (PRD.md §4). MIT
  // licensed, purpose-built for agentic coding, with native tool calling.
  // Pulled straight from the Hugging Face GGUF repos, which Ollama
  // supports as a first-class source, because the family isn't in
  // Ollama's own library.
  //
  // The 397B family member is deliberately absent: it ships FP8 only,
  // with no GGUF build, so no Ollama-backed runtime can load it. That's
  // an "this runtime cannot run it" exclusion, not the curation-by-
  // shortlist this file otherwise forbids.
  {
    id: "hf.co/ornith-ai/Ornith-1.0-9B-GGUF:Q4_K_M",
    label: "Ornith 1.0 9B",
    runtime: "ollama",
    parametersBillions: 9,
    defaultQuantization: "q4_K_M",
    contextWindow: 262144,
    // The model documents tool calling, but observed behaviour is that
    // this GGUF build reports only "completion" to Ollama — its chat
    // template does not implement tool calls. `loadModelCatalog`
    // overrides this with what Ollama reports once the model is
    // installed, so the claim below never outranks the build in front of
    // the user.
    supportsToolCalling: true,
    description:
      "Recommended default. Dense agentic-coding model with native tool calling and a 256k context.",
    codeSpecialized: true,
  },
  {
    id: "hf.co/ornith-ai/Ornith-1.0-35B-GGUF:Q4_K_M",
    label: "Ornith 1.0 35B",
    runtime: "ollama",
    parametersBillions: 35,
    // Mixture-of-experts, but the active parameter count isn't published.
    // Left undefined on purpose: the fit heuristic then judges speed by
    // the full 35B, which understates this model rather than overselling
    // it. Fill in once the figure is confirmed.
    defaultQuantization: "q4_K_M",
    contextWindow: 262144,
    supportsToolCalling: true,
    description:
      "Larger Ornith, mixture-of-experts. Stronger agentic reasoning; needs substantial memory.",
    codeSpecialized: true,
  },
  {
    id: "qwen2.5-coder:1.5b",
    label: "Qwen2.5 Coder 1.5B",
    runtime: "ollama",
    parametersBillions: 1.5,
    defaultQuantization: "q4_K_M",
    contextWindow: 32768,
    supportsToolCalling: true,
    description: "Very small code model. Runs on modest hardware.",
    codeSpecialized: true,
  },
  {
    id: "qwen2.5-coder:7b",
    label: "Qwen2.5 Coder 7B",
    runtime: "ollama",
    parametersBillions: 7,
    defaultQuantization: "q4_K_M",
    contextWindow: 32768,
    supportsToolCalling: true,
    description: "Strong general-purpose code model at a size most machines can run.",
    codeSpecialized: true,
  },
  {
    id: "qwen2.5-coder:14b",
    label: "Qwen2.5 Coder 14B",
    runtime: "ollama",
    parametersBillions: 14,
    defaultQuantization: "q4_K_M",
    contextWindow: 32768,
    supportsToolCalling: true,
    description: "Larger Qwen2.5 Coder. Noticeably stronger on multi-file reasoning.",
    codeSpecialized: true,
  },
  {
    id: "qwen2.5-coder:32b",
    label: "Qwen2.5 Coder 32B",
    runtime: "ollama",
    parametersBillions: 32,
    defaultQuantization: "q4_K_M",
    contextWindow: 32768,
    supportsToolCalling: true,
    description: "Largest Qwen2.5 Coder. Needs substantial GPU memory.",
    codeSpecialized: true,
  },
  {
    id: "llama3.2:3b",
    label: "Llama 3.2 3B",
    runtime: "ollama",
    parametersBillions: 3,
    defaultQuantization: "q4_K_M",
    contextWindow: 131072,
    supportsToolCalling: true,
    description: "Small general model with a long context window.",
    codeSpecialized: false,
  },
  {
    id: "llama3.1:8b",
    label: "Llama 3.1 8B",
    runtime: "ollama",
    parametersBillions: 8,
    defaultQuantization: "q4_K_M",
    contextWindow: 131072,
    supportsToolCalling: true,
    description: "Well-rounded general model. A safe default on most machines.",
    codeSpecialized: false,
  },
  {
    id: "llama3.1:70b",
    label: "Llama 3.1 70B",
    runtime: "ollama",
    parametersBillions: 70,
    defaultQuantization: "q4_K_M",
    contextWindow: 131072,
    supportsToolCalling: true,
    description: "Large general model. Requires a high-memory GPU or workstation.",
    codeSpecialized: false,
  },
  {
    id: "deepseek-coder-v2:16b",
    label: "DeepSeek Coder V2 16B",
    runtime: "ollama",
    parametersBillions: 16,
    // MoE: 16B resident, ~2.4B active per token. Costs memory like a 16B
    // model but runs closer to a 2-3B one.
    activeParametersBillions: 2.4,
    defaultQuantization: "q4_K_M",
    contextWindow: 32768,
    supportsToolCalling: false,
    description: "Mixture-of-experts code model with broad language coverage.",
    codeSpecialized: true,
  },
  {
    id: "codellama:7b",
    label: "Code Llama 7B",
    runtime: "ollama",
    parametersBillions: 7,
    defaultQuantization: "q4_K_M",
    contextWindow: 16384,
    supportsToolCalling: false,
    description: "Established code model. Widely tested, older than most here.",
    codeSpecialized: true,
  },
  {
    id: "codellama:13b",
    label: "Code Llama 13B",
    runtime: "ollama",
    parametersBillions: 13,
    defaultQuantization: "q4_K_M",
    contextWindow: 16384,
    supportsToolCalling: false,
    description: "Mid-size Code Llama.",
    codeSpecialized: true,
  },
  {
    id: "starcoder2:3b",
    label: "StarCoder2 3B",
    runtime: "ollama",
    parametersBillions: 3,
    defaultQuantization: "q4_K_M",
    contextWindow: 16384,
    supportsToolCalling: false,
    description: "Small code model trained on permissively-licensed source.",
    codeSpecialized: true,
  },
  {
    id: "starcoder2:15b",
    label: "StarCoder2 15B",
    runtime: "ollama",
    parametersBillions: 15,
    defaultQuantization: "q4_K_M",
    contextWindow: 16384,
    supportsToolCalling: false,
    description: "Larger StarCoder2 with the same training-data provenance.",
    codeSpecialized: true,
  },
  {
    id: "mistral:7b",
    label: "Mistral 7B",
    runtime: "ollama",
    parametersBillions: 7,
    defaultQuantization: "q4_K_M",
    contextWindow: 32768,
    supportsToolCalling: true,
    description: "Fast general model, strong for its size.",
    codeSpecialized: false,
  },
  {
    id: "gemma2:9b",
    label: "Gemma 2 9B",
    runtime: "ollama",
    parametersBillions: 9,
    defaultQuantization: "q4_K_M",
    contextWindow: 8192,
    supportsToolCalling: false,
    description: "Google's mid-size open model.",
    codeSpecialized: false,
  },
  {
    id: "gemma2:27b",
    label: "Gemma 2 27B",
    runtime: "ollama",
    parametersBillions: 27,
    defaultQuantization: "q4_K_M",
    contextWindow: 8192,
    supportsToolCalling: false,
    description: "Largest Gemma 2. Competitive with much bigger models.",
    codeSpecialized: false,
  },
  {
    id: "phi3:3.8b",
    label: "Phi-3 Mini 3.8B",
    runtime: "ollama",
    parametersBillions: 3.8,
    defaultQuantization: "q4_K_M",
    contextWindow: 131072,
    supportsToolCalling: false,
    description: "Small model tuned for reasoning density over raw size.",
    codeSpecialized: false,
  },
];

/**
 * The app-release date this snapshot reflects. Shown in the UI alongside
 * the "bundled" source label so a stale list is legible as stale rather
 * than presented as current.
 */
export const BUNDLED_CATALOG_RETRIEVED_AT = "2026-08-21";
