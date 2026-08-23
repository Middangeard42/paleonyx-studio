import { afterEach, describe, expect, it, vi } from "vitest";
import { loadModelCatalog } from "./load-catalog.js";

/**
 * Guards a discrepancy found by running against a real Ollama install:
 * Ornith-1.0-9B's model card describes tool calling, but its GGUF build
 * reports only "completion" to Ollama, because the chat template does
 * not implement tool calls.
 *
 * The bundled list describes a model in general; Ollama describes the
 * build on this machine. When they disagree, the machine wins — an
 * adapter that claims tool support the build lacks would have agent-core
 * offer tools that are silently ignored, which reads as the agent
 * choosing not to use them.
 */

function tagsResponse(models: unknown[]) {
  return new Response(JSON.stringify({ models }), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installed capabilities override bundled claims", () => {
  it("marks a bundled model as lacking tools when its build reports none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        tagsResponse([
          {
            name: "hf.co/ornith-ai/Ornith-1.0-9B-GGUF:Q4_K_M",
            capabilities: ["completion"],
            details: { parameter_size: "8.95B", context_length: 262144 },
          },
        ])
      )
    );

    const catalog = await loadModelCatalog();
    const ornith = catalog.entries.find((e) => e.id.includes("Ornith-1.0-9B"));
    expect(ornith?.supportsToolCalling).toBe(false);
  });

  it("keeps tool support when the build does report it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        tagsResponse([
          {
            name: "qwen2.5-coder:1.5b",
            capabilities: ["completion", "tools", "insert"],
            details: { parameter_size: "1.5B", context_length: 32768 },
          },
        ])
      )
    );

    const catalog = await loadModelCatalog();
    const qwen = catalog.entries.find((e) => e.id === "qwen2.5-coder:1.5b");
    expect(qwen?.supportsToolCalling).toBe(true);
    expect(qwen?.contextWindow).toBe(32768);
  });

  it("leaves uninstalled entries describing the model rather than a build", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => tagsResponse([])));

    const catalog = await loadModelCatalog();
    const ornith = catalog.entries.find((e) => e.id.includes("Ornith-1.0-9B"));
    // Nothing observed, so the bundled claim stands — and the UI only
    // shows the tool-calling note for installed models.
    expect(ornith?.supportsToolCalling).toBe(true);
    expect(catalog.installedIds).toHaveLength(0);
  });

  it("treats a missing capabilities field as no tool support", async () => {
    // Older Ollama builds omit the field. Assuming support would be the
    // same mistake in a different place.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        tagsResponse([{ name: "some-model:latest", details: { parameter_size: "7B" } }])
      )
    );

    const catalog = await loadModelCatalog();
    const model = catalog.entries.find((e) => e.id === "some-model:latest");
    expect(model?.supportsToolCalling).toBe(false);
  });

  it("still returns the bundled catalog when Ollama is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection refused");
    }));

    const catalog = await loadModelCatalog();
    expect(catalog.entries.length).toBeGreaterThan(0);
    expect(catalog.installedIds).toHaveLength(0);
  });
});
