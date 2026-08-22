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

/** Which providers are connected, for rendering the settings list. */
export async function loadKeyedProviderIds(): Promise<string[]> {
  const checks = await Promise.all(
    BYOK_PROVIDERS.map(async (provider) => ({
      id: provider.id,
      // A credential store that cannot be read is a real failure, but not
      // one worth blocking the whole Models screen over: treat it as
      // "no key" so local models stay usable.
      hasKey: await hasProviderKey(provider.id).catch(() => false),
    }))
  );
  return checks.filter((check) => check.hasKey).map((check) => check.id);
}
