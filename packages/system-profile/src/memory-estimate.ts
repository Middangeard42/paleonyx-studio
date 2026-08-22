import type { ModelCatalogEntry, Quantization } from "@paleonyx/shared-types";

const GIB = 1024 ** 3;

/**
 * Effective bits per weight, including the embedding/norm tensors that
 * k-quants leave at higher precision — so these run above each format's
 * nominal bit count.
 *
 * Calibrated against the published GGUF file sizes for Ornith-1.0-9B,
 * which ships every format below from one 9B parameter count and so
 * isolates the per-format overhead cleanly:
 *
 *   format   published   this table   error
 *   q4_K_M     5.63 GB     5.51 GB    -2%
 *   q5_K_M     6.47 GB     6.41 GB    -1%
 *   q6_K       7.36 GB     7.43 GB    +1%
 *   q8_0       9.53 GB     9.56 GB    +0.3%
 *   bf16      17.90 GB    18.00 GB    +0.6%
 */
const BITS_PER_PARAMETER: Record<Quantization, number> = {
  q4_K_M: 4.9,
  q5_K_M: 5.7,
  q6_K: 6.6,
  q8_0: 8.5,
  f16: 16,
};

/**
 * KV cache is sized for a realistic working context rather than the
 * model's advertised maximum.
 *
 * This matters more than it looks: at a full 256K context a 35B model's
 * f16 KV cache alone runs to tens of gigabytes, which would rate every
 * long-context model unusable on every consumer machine. No local runtime
 * allocates that by default — Ollama's default `num_ctx` is far smaller —
 * so sizing against the maximum would be arithmetically defensible and
 * practically useless advice.
 */
const PRACTICAL_CONTEXT_TOKENS = 32768;

/**
 * KV cache per token, calibrated against one datapoint we can state
 * confidently: an 8B model with a 32-layer / 8-KV-head / 128-dim
 * attention stack holds roughly 1 GiB of f16 KV cache at 8k context,
 * i.e. ~128 KiB per token.
 *
 * Scaling is sqrt-of-parameters rather than linear because grouped-query
 * attention holds KV-head count roughly fixed as models grow — only
 * depth increases. Linear scaling overestimates a 70B model's cache by
 * several-fold; sqrt lands within ~20% of the real figure across the 3B
 * to 70B range.
 */
const KV_BYTES_PER_TOKEN_AT_8B = 128 * 1024;
const KV_REFERENCE_PARAMETERS_B = 8;

export function estimateWeightBytes(entry: ModelCatalogEntry): number {
  const bits = BITS_PER_PARAMETER[entry.defaultQuantization];
  return (entry.parametersBillions * 1e9 * bits) / 8;
}

export function estimateKvCacheBytes(entry: ModelCatalogEntry): number {
  const scale = Math.sqrt(entry.parametersBillions / KV_REFERENCE_PARAMETERS_B);
  const tokens = Math.min(entry.contextWindow, PRACTICAL_CONTEXT_TOKENS);
  return tokens * KV_BYTES_PER_TOKEN_AT_8B * scale;
}

/**
 * Total memory a model is expected to occupy while loaded: weights, KV
 * cache at its full advertised context, plus a small fixed allowance for
 * the runtime's own working set.
 *
 * Approximate by construction (see PRD.md §8) — used to sort entries
 * into three coarse buckets, never presented to the user as a precise
 * figure or a guarantee.
 */
export function estimateTotalMemoryBytes(entry: ModelCatalogEntry): number {
  const RUNTIME_OVERHEAD_BYTES = 0.5 * GIB;
  return estimateWeightBytes(entry) + estimateKvCacheBytes(entry) + RUNTIME_OVERHEAD_BYTES;
}
