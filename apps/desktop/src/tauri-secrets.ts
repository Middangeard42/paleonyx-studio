import { invoke } from "@tauri-apps/api/core";
import { BYOK_PROVIDERS } from "@paleonyx/ui";

/**
 * Access to OS-native credential storage.
 *
 * Note what this module does not do: cache. There is no module-level
 * variable holding a key, and nothing here returns one to be kept. The
 * only reader is the remote adapter, per request, which discards it
 * immediately (CLAUDE.md §4.2).
 */

export async function setProviderKey(providerId: string, key: string): Promise<void> {
  await invoke("set_provider_key", { provider: providerId, key });
}

export async function deleteProviderKey(providerId: string): Promise<void> {
  await invoke("delete_provider_key", { provider: providerId });
}

/** Asks only whether a key exists — the secret stays in the credential store. */
export async function hasProviderKey(providerId: string): Promise<boolean> {
  return invoke<boolean>("has_provider_key", { provider: providerId });
}

export async function getProviderKey(providerId: string): Promise<string | null> {
  return invoke<string | null>("get_provider_key", { provider: providerId });
}

export interface KeyedProviders {
  /** Which providers have a key stored, for rendering the settings list. */
  ids: string[];
  /** Why the credential store could not be checked, or null when it could. */
  problem: string | null;
}

export async function loadKeyedProviders(): Promise<KeyedProviders> {
  const checks = await Promise.all(
    BYOK_PROVIDERS.map(async (provider) => {
      try {
        return { id: provider.id, hasKey: await hasProviderKey(provider.id), problem: null };
      } catch (error) {
        // An unusable store is a real failure, but not one worth blocking
        // the whole Models screen over: no key is listed, so local models
        // stay usable, and the reason is passed on to be shown.
        return {
          id: provider.id,
          hasKey: false,
          problem: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );
  return {
    ids: checks.filter((check) => check.hasKey).map((check) => check.id),
    problem: checks.find((check) => check.problem !== null)?.problem ?? null,
  };
}
