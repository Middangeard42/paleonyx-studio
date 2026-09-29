import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { loadKeyedProviders } from "./tauri-secrets.js";

const STORE_DOWN =
  "Could not check for a saved key: the credential store could not be used. Saved keys need a Secret Service.";

beforeEach(() => {
  invoke.mockReset();
});

describe("loadKeyedProviders", () => {
  it("lists the providers that have a key, with no problem", async () => {
    invoke.mockImplementation(async (_command: string, args: { provider: string }) => args.provider === "groq");
    const result = await loadKeyedProviders();
    expect(result.ids).toEqual(["groq"]);
    expect(result.problem).toBeNull();
  });

  it("is not a problem when there is simply no key", async () => {
    invoke.mockResolvedValue(false);
    expect(await loadKeyedProviders()).toEqual({ ids: [], problem: null });
  });

  // The regression: an unusable credential store was read as "no key", so
  // nothing on the Models screen said anything was wrong until someone tried
  // to add a key and it failed.
  it("reports why the credential store could not be checked", async () => {
    invoke.mockRejectedValue(STORE_DOWN);
    const result = await loadKeyedProviders();
    expect(result.ids).toEqual([]);
    expect(result.problem).toBe(STORE_DOWN);
  });

  // Local models must stay usable, and a provider that was checked fine
  // still counts even when another check failed.
  it("still lists the keys it could read when one check fails", async () => {
    invoke.mockImplementation(async (_command: string, args: { provider: string }) => {
      if (args.provider === "groq") return true;
      throw new Error(STORE_DOWN);
    });
    const result = await loadKeyedProviders();
    expect(result.ids).toEqual(["groq"]);
    expect(result.problem).toBe(STORE_DOWN);
  });
});
