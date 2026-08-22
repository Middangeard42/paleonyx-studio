import { Cpu, HardDrive, MonitorCog } from "lucide-react";
import type { SystemProfile } from "@paleonyx/shared-types";

const GIB = 1024 ** 3;

export interface SystemProfileSummaryProps {
  /** Undefined on web, where no hardware detection exists (CLAUDE.md §4.1). */
  profile: SystemProfile | undefined;
}

/**
 * The "here's what we found" panel above the model catalog (DESIGN.md
 * §6.3). Deliberately framed as guidance — detection is best-effort
 * (PRD.md §8), so this never implies a guarantee about what will run.
 */
export function SystemProfileSummary({ profile }: SystemProfileSummaryProps) {
  if (!profile) {
    return (
      <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
        <p className="text-xs text-text-secondary">
          Hardware detection isn&apos;t available in the browser, so models below
          aren&apos;t marked for fit. Open the desktop app to see which ones suit
          this machine.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-text-secondary">
        <span className="flex items-center gap-1.5">
          <HardDrive size={13} className="text-text-tertiary" />
          {formatGib(profile.totalMemoryBytes)} memory
        </span>
        <span className="flex items-center gap-1.5">
          <Cpu size={13} className="text-text-tertiary" />
          {profile.cpuCoreCount} CPU cores
        </span>
        <span className="flex items-center gap-1.5">
          <MonitorCog size={13} className="text-text-tertiary" />
          {describeGpu(profile)}
        </span>
      </div>
      <p className="mt-2 text-xs text-text-tertiary">
        Fit notes below are estimates based on this hardware, not guarantees —
        actual speed depends on the runtime and what else is running.
      </p>
    </div>
  );
}

function describeGpu(profile: SystemProfile): string {
  if (!profile.gpu) return "No dedicated GPU detected";
  if (profile.gpu.vramBytes === undefined) {
    return `${profile.gpu.name} (memory unknown)`;
  }
  return `${profile.gpu.name} · ${formatGib(profile.gpu.vramBytes)}`;
}

function formatGib(bytes: number): string {
  const gib = bytes / GIB;
  return `${gib < 10 ? gib.toFixed(1) : Math.round(gib)} GB`;
}
