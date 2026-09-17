import { defineConfig } from "vitest/config";

/**
 * End-to-end runs, kept apart from the unit suite.
 *
 * They start the real app and a dev server, so they are slow, need a
 * desktop session, and must not run concurrently — two instances would
 * fight over the dev server's fixed port.
 */
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["**/*.e2e.ts"],
    testTimeout: 120_000,
    hookTimeout: 240_000,
    fileParallelism: false,
    pool: "forks",
  },
});
