import type { SystemProfile } from "@paleonyx/shared-types";

export { assessFit } from "./fit.js";
export {
  estimateTotalMemoryBytes,
  estimateWeightBytes,
  estimateKvCacheBytes,
} from "./memory-estimate.js";

/**
 * Read-only, no write capability at all (CLAUDE.md §4.1). `apps/desktop`
 * implements this over a Tauri command; `apps/web` has no implementation
 * and passes `undefined` profiles through to `assessFit` instead of
 * substituting a fake one.
 */
export interface SystemProfileReader {
  read(): Promise<SystemProfile>;
}
