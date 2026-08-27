import {
  NdjsonBuffer,
  PullProgressTracker,
  type ModelPullProgress,
} from "./pull-progress.js";

/**
 * Installing and removing models from inside the app (PRD.md §3 journey
 * 9).
 *
 * An interface rather than a pair of Ollama functions, because not every
 * provider can do this: Ollama exposes an API for it, LM Studio and
 * llama.cpp do not in the same way, and a remote provider has nothing to
 * install at all. Whether a provider supports it is therefore declared —
 * the app asks for an installer and gets one or gets null, instead of
 * offering a button and discovering at click time that it fails
 * (CLAUDE.md §4).
 */
export interface ModelInstaller {
  /** Which adapter this manages, matching `ModelInfo.provider`. */
  readonly providerId: string;
  install(modelId: string, options?: InstallOptions): Promise<void>;
  uninstall(modelId: string): Promise<void>;
}

export interface InstallOptions {
  onProgress?: (progress: ModelPullProgress) => void;
  /** Cancels the download. A partial pull leaves nothing usable behind. */
  signal?: AbortSignal;
}

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

/**
 * Ollama's implementation.
 *
 * Local by construction: it talks to Ollama on loopback, and Ollama is
 * what reaches the network to fetch the weights. Nothing about the
 * user's project or prompts is involved, so this is not an egress path
 * in the sense CLAUDE.md §4 governs — but it *is* a download the user
 * asked for, which is why it never starts on its own.
 */
export class OllamaModelInstaller implements ModelInstaller {
  readonly providerId = "ollama";

  constructor(private readonly baseUrl: string = DEFAULT_OLLAMA_URL) {}

  async install(modelId: string, options: InstallOptions = {}): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, stream: true }),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Could not start downloading ${modelId}: Ollama replied ${response.status}.`
      );
    }
    if (!response.body) {
      throw new Error(`Ollama sent no progress for ${modelId}.`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const buffer = new NdjsonBuffer();
    const tracker = new PullProgressTracker();

    const handle = (updates: ReturnType<NdjsonBuffer["push"]>) => {
      for (const update of updates) {
        // Ollama reports failure inside the stream with a 200 already
        // sent, so this is the only place a bad model name surfaces.
        if (update.error) throw new Error(update.error);
        options.onProgress?.(tracker.update(update));
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        handle(buffer.push(decoder.decode(value, { stream: true })));
      }
      handle(buffer.flush());
    } finally {
      // Releasing matters on the cancel path: an abandoned reader holds
      // the connection open until the process exits.
      reader.releaseLock();
    }
  }

  async uninstall(modelId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId }),
    });

    if (!response.ok) {
      throw new Error(
        `Could not remove ${modelId}: Ollama replied ${response.status}.`
      );
    }
  }
}

/**
 * The installer for a provider, or null when that provider cannot manage
 * models. Null is the answer the UI renders around — it means "show how
 * to do this elsewhere", not "the button failed".
 */
export function installerFor(
  providerId: string,
  baseUrl?: string
): ModelInstaller | null {
  if (providerId === "ollama") return new OllamaModelInstaller(baseUrl);
  return null;
}

export type { ModelPullProgress };
