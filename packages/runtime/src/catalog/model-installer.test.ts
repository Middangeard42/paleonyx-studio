import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelPullProgress } from "./pull-progress.js";
import { OllamaModelInstaller, installerFor } from "./model-installer.js";

/** Builds a streaming Response that yields the given chunks in order. */
function streaming(chunks: string[], ok = true, status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status, statusText: ok ? "OK" : "Error" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OllamaModelInstaller.install", () => {
  it("reports progress that grows across layers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streaming([
          '{"status":"pulling manifest"}\n',
          '{"status":"downloading","digest":"sha256:a","total":1000,"completed":500}\n',
          '{"status":"downloading","digest":"sha256:a","total":1000,"completed":1000}\n',
          '{"status":"downloading","digest":"sha256:b","total":1000,"completed":250}\n',
          '{"status":"success"}\n',
        ])
      )
    );

    const seen: ModelPullProgress[] = [];
    await new OllamaModelInstaller().install("qwen2.5-coder:7b", {
      onProgress: (p) => seen.push(p),
    });

    expect(seen[0]!.fraction).toBeNull();
    expect(seen.at(-1)!.status).toBe("success");
    const completed = seen.map((p) => p.completedBytes ?? 0);
    // Monotonic: a progress bar that goes backwards mid-download reads
    // as a broken app rather than as Ollama changing layer.
    expect(completed).toEqual([...completed].sort((a, b) => a - b));
  });

  // A read boundary lands wherever the network puts it, not on newlines.
  it("survives a chunk that splits an update in half", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streaming([
          '{"status":"downloading","digest":"sha256:a","tot',
          'al":1000,"completed":1000}\n{"status":"suc',
          'cess"}\n',
        ])
      )
    );

    const seen: ModelPullProgress[] = [];
    await new OllamaModelInstaller().install("m", {
      onProgress: (p) => seen.push(p),
    });
    expect(seen.at(-1)!.status).toBe("success");
    expect(seen.some((p) => p.completedBytes === 1000)).toBe(true);
  });

  it("reads a final update that arrives without a trailing newline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streaming(['{"status":"success"}']))
    );
    const seen: ModelPullProgress[] = [];
    await new OllamaModelInstaller().install("m", {
      onProgress: (p) => seen.push(p),
    });
    expect(seen.at(-1)?.status).toBe("success");
  });

  // Ollama sends 200 first and reports a bad model name inside the
  // stream, so this is the only place that failure can be noticed.
  it("fails when the stream carries an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streaming([
          '{"status":"pulling manifest"}\n',
          '{"error":"model \'nope\' not found"}\n',
        ])
      )
    );

    await expect(
      new OllamaModelInstaller().install("nope")
    ).rejects.toThrow(/not found/);
  });

  it("fails when the request itself is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );
    await expect(new OllamaModelInstaller().install("m")).rejects.toThrow(
      /500/
    );
  });

  it("passes the abort signal through so a download can be cancelled", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      streaming(['{"status":"success"}\n'])
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    await new OllamaModelInstaller().install("m", { signal: controller.signal });

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      signal: controller.signal,
    });
  });

  it("asks Ollama for the model by name", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      streaming(['{"status":"success"}\n'])
    );
    vi.stubGlobal("fetch", fetchMock);

    await new OllamaModelInstaller().install("qwen2.5-coder:7b");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/api/pull");
    expect(JSON.parse(String(init!.body))).toMatchObject({
      model: "qwen2.5-coder:7b",
    });
  });
});

describe("OllamaModelInstaller.uninstall", () => {
  it("asks Ollama to delete the model", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await new OllamaModelInstaller().uninstall("qwen2.5-coder:7b");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/api/delete");
    expect(init!.method).toBe("DELETE");
    expect(JSON.parse(String(init!.body))).toMatchObject({
      model: "qwen2.5-coder:7b",
    });
  });

  // Removing is destructive, so a failure must surface rather than
  // leaving the user believing the model is gone.
  it("fails loudly when Ollama refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    await expect(
      new OllamaModelInstaller().uninstall("ghost")
    ).rejects.toThrow(/404/);
  });
});

describe("installerFor", () => {
  it("returns an installer for a provider that can manage models", () => {
    expect(installerFor("ollama")?.providerId).toBe("ollama");
  });

  // Null is what the UI renders around: "here is how to do this
  // elsewhere", rather than a button that fails when pressed.
  it("returns null for providers that cannot", () => {
    expect(installerFor("openrouter")).toBeNull();
    expect(installerFor("groq")).toBeNull();
    expect(installerFor("mock")).toBeNull();
  });
});
