import { invoke } from "@tauri-apps/api/core";
import type { SystemProfile } from "@paleonyx/shared-types";
import type { SystemProfileReader } from "@paleonyx/system-profile";

/**
 * Desktop-only hardware detection, backed by the `get_system_profile`
 * Rust command. `apps/web` has no counterpart — it passes `undefined`
 * profiles to `assessFit` rather than substituting a fabricated one
 * (CLAUDE.md §4.1).
 */
export class TauriSystemProfileReader implements SystemProfileReader {
  async read(): Promise<SystemProfile> {
    return invoke<SystemProfile>("get_system_profile");
  }
}
