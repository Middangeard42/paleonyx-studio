import { describe, expect, it } from "vitest";
import type { HardwareFit, SystemProfile } from "@paleonyx/shared-types";
import { assessFit } from "@paleonyx/system-profile";
import { BUNDLED_CATALOG_ENTRIES } from "./bundled-catalog.js";

const GIB = 1024 ** 3;

/**
 * `@paleonyx/system-profile` is a devDependency here, imported only by
 * this test. Runtime code must not depend on it — hardware fit is a
 * catalog-UI concern, not something the provider layer knows about.
 *
 * What this guards: the bundled entries and the memory estimator have to
 * stay plausible *together*. A wrong parameter count on one entry, or a
 * drifted constant in the estimator, shows up here as an implausible
 * bucket spread rather than as a bad recommendation in the product.
 */
function bucketCounts(profile: SystemProfile): Record<HardwareFit, number> {
  const counts: Record<HardwareFit, number> = {
    "fits-comfortably": 0,
    "will-be-slow": 0,
    "too-large": 0,
  };
  for (const entry of BUNDLED_CATALOG_ENTRIES) {
    const assessment = assessFit(entry, profile);
    if (assessment) counts[assessment.fit] += 1;
  }
  return counts;
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

describe("bundled catalog", () => {
  it("has unique ids", () => {
    const ids = BUNDLED_CATALOG_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares plausible parameter counts and context windows", () => {
    for (const entry of BUNDLED_CATALOG_ENTRIES) {
      expect(entry.parametersBillions).toBeGreaterThan(0);
      expect(entry.parametersBillions).toBeLessThan(1000);
      expect(entry.contextWindow).toBeGreaterThanOrEqual(2048);
    }
  });

  it("offers a modest laptop something usable without calling everything too large", () => {
    const counts = bucketCounts(machine({ totalMemoryBytes: 8 * GIB }));
    expect(counts["fits-comfortably"]).toBeGreaterThan(0);
    expect(counts["too-large"]).toBeLessThan(BUNDLED_CATALOG_ENTRIES.length);
  });

  it("hides the largest models behind the toggle on a 16GB CPU-only machine", () => {
    const counts = bucketCounts(machine());
    // This is what makes the "Show N too-large models" toggle meaningful:
    // if nothing ever landed in that bucket the control would never appear.
    expect(counts["too-large"]).toBeGreaterThan(0);
  });

  it("opens up the catalog on a high-VRAM workstation", () => {
    const workstation = machine({
      totalMemoryBytes: 128 * GIB,
      gpu: { name: "Workstation GPU", vramBytes: 48 * GIB },
    });
    const counts = bucketCounts(workstation);
    expect(counts["too-large"]).toBe(0);
    expect(counts["fits-comfortably"]).toBeGreaterThan(counts["will-be-slow"]);
  });

  it("still rates a 70B model as too large for a 16GB machine", () => {
    const large = BUNDLED_CATALOG_ENTRIES.find((entry) => entry.parametersBillions >= 70);
    expect(large).toBeDefined();
    expect(assessFit(large!, machine())?.fit).toBe("too-large");
  });
});
