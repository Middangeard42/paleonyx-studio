import { describe, expect, it } from "vitest";
import type { ModelCatalogEntry, SystemProfile } from "@paleonyx/shared-types";
import { assessFit } from "./fit.js";
import { estimateTotalMemoryBytes, estimateWeightBytes } from "./memory-estimate.js";

const GIB = 1024 ** 3;

function model(overrides: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry {
  return {
    id: "test:7b",
    label: "Test 7B",
    runtime: "ollama",
    parametersBillions: 7,
    defaultQuantization: "q4_K_M",
    contextWindow: 8192,
    supportsToolCalling: true,
    description: "Fixture.",
    codeSpecialized: false,
    ...overrides,
  };
}

function machine(overrides: Partial<SystemProfile> = {}): SystemProfile {
  return {
    totalMemoryBytes: 16 * GIB,
    availableMemoryBytes: 10 * GIB,
    cpuCoreCount: 8,
    os: { platform: "windows", version: "11", arch: "x86_64" },
    ...overrides,
  };
}

describe("estimateWeightBytes", () => {
  // Ornith-1.0-9B publishes every format from one 9B parameter count,
  // which makes it a clean calibration target for the whole table.
  // Sizes below are the repo's own published GGUF file sizes in GB.
  const PUBLISHED_9B_SIZES_GB = {
    q4_K_M: 5.63,
    q5_K_M: 6.47,
    q6_K: 7.36,
    q8_0: 9.53,
    f16: 17.9,
  } as const;

  for (const [quantization, publishedGb] of Object.entries(PUBLISHED_9B_SIZES_GB)) {
    it(`estimates ${quantization} within 5% of the published 9B file size`, () => {
      const estimated =
        estimateWeightBytes(
          model({
            parametersBillions: 9,
            defaultQuantization: quantization as keyof typeof PUBLISHED_9B_SIZES_GB,
          })
        ) / 1e9;
      expect(Math.abs(estimated - publishedGb) / publishedGb).toBeLessThan(0.05);
    });
  }
});

describe("estimateTotalMemoryBytes", () => {
  it("lands near the real loaded footprint of an 8B q4_K_M model", () => {
    const bytes = estimateTotalMemoryBytes(
      model({ parametersBillions: 8, contextWindow: 8192 })
    );
    expect(bytes / GIB).toBeGreaterThan(5);
    expect(bytes / GIB).toBeLessThan(7.5);
  });

  it("caps KV cache at a practical context instead of the advertised maximum", () => {
    // A 256k-context model would otherwise be charged tens of GB of KV
    // cache and be rated unusable on every consumer machine, despite no
    // local runtime allocating that by default.
    const practical = estimateTotalMemoryBytes(
      model({ parametersBillions: 9, contextWindow: 32768 })
    );
    const advertised = estimateTotalMemoryBytes(
      model({ parametersBillions: 9, contextWindow: 262144 })
    );
    expect(advertised).toBe(practical);
    expect(advertised / GIB).toBeLessThan(16);
  });

  it("grows with quantization precision", () => {
    const q4 = estimateTotalMemoryBytes(model({ defaultQuantization: "q4_K_M" }));
    const q8 = estimateTotalMemoryBytes(model({ defaultQuantization: "q8_0" }));
    const f16 = estimateTotalMemoryBytes(model({ defaultQuantization: "f16" }));
    expect(q8).toBeGreaterThan(q4);
    expect(f16).toBeGreaterThan(q8);
  });

  it("charges more KV cache for a longer context window", () => {
    const short = estimateTotalMemoryBytes(model({ contextWindow: 4096 }));
    const long = estimateTotalMemoryBytes(model({ contextWindow: 32768 }));
    expect(long).toBeGreaterThan(short);
  });
});

describe("assessFit", () => {
  it("returns undefined with no profile, rather than guessing a bucket", () => {
    expect(assessFit(model(), undefined)).toBeUndefined();
  });

  it("calls a model that fits in VRAM comfortable", () => {
    const result = assessFit(
      model({ parametersBillions: 7 }),
      machine({ gpu: { name: "Test GPU", vramBytes: 16 * GIB } })
    );
    expect(result?.fit).toBe("fits-comfortably");
  });

  it("calls a small model on a CPU-only machine comfortable", () => {
    const result = assessFit(model({ parametersBillions: 3 }), machine());
    expect(result?.fit).toBe("fits-comfortably");
  });

  it("calls a large CPU-only model slow even when it fits in RAM", () => {
    const result = assessFit(
      model({ parametersBillions: 14 }),
      machine({ totalMemoryBytes: 64 * GIB })
    );
    expect(result?.fit).toBe("will-be-slow");
  });

  it("calls a model larger than VRAM but within RAM slow, not too-large", () => {
    const result = assessFit(
      model({ parametersBillions: 32 }),
      machine({
        totalMemoryBytes: 64 * GIB,
        gpu: { name: "Small GPU", vramBytes: 8 * GIB },
      })
    );
    expect(result?.fit).toBe("will-be-slow");
  });

  it("calls a model beyond total RAM too-large", () => {
    const result = assessFit(
      model({ parametersBillions: 70 }),
      machine({ totalMemoryBytes: 16 * GIB })
    );
    expect(result?.fit).toBe("too-large");
  });

  it("treats a GPU with undetectable VRAM as CPU-only rather than assuming capacity", () => {
    const withUnknownVram = assessFit(
      model({ parametersBillions: 14 }),
      machine({ totalMemoryBytes: 64 * GIB, gpu: { name: "Unknown GPU" } })
    );
    const withNoGpu = assessFit(
      model({ parametersBillions: 14 }),
      machine({ totalMemoryBytes: 64 * GIB })
    );
    expect(withUnknownVram?.fit).toBe(withNoGpu?.fit);
  });

  it("judges an MoE model's speed by active parameters, not resident ones", () => {
    // 16B resident, 2.4B active: costs memory like a 16B model but should
    // not be written off as slow the way a dense 16B would be.
    const moe = assessFit(
      model({ parametersBillions: 16, activeParametersBillions: 2.4 }),
      machine({ totalMemoryBytes: 32 * GIB })
    );
    const dense = assessFit(
      model({ parametersBillions: 16 }),
      machine({ totalMemoryBytes: 32 * GIB })
    );
    expect(moe?.fit).toBe("fits-comfortably");
    expect(dense?.fit).toBe("will-be-slow");
  });

  it("still charges an MoE model memory for every resident parameter", () => {
    const moe = estimateTotalMemoryBytes(
      model({ parametersBillions: 16, activeParametersBillions: 2.4 })
    );
    const smallDense = estimateTotalMemoryBytes(model({ parametersBillions: 2.4 }));
    expect(moe).toBeGreaterThan(smallDense * 2);
  });

  it("never phrases a rationale as a guarantee", () => {
    const results = [
      assessFit(model({ parametersBillions: 3 }), machine()),
      assessFit(model({ parametersBillions: 70 }), machine()),
      assessFit(
        model({ parametersBillions: 7 }),
        machine({ gpu: { name: "GPU", vramBytes: 24 * GIB } })
      ),
    ];
    for (const result of results) {
      expect(result?.rationale).toBeTruthy();
      expect(result?.rationale.toLowerCase()).not.toMatch(/will run perfectly|guaranteed/);
    }
  });
});
