import type { McpServerConfig, McpToolInfo } from "@paleonyx/shared-types";
import { McpClient, McpError, fingerprintServer } from "@paleonyx/mcp-client";
import type { McpTransport, OpenTransport } from "@paleonyx/mcp-client";

export type ServerStatus =
  | { kind: "stopped" }
  | { kind: "starting" }
  | {
      kind: "running";
      tools: McpToolInfo[];
      /** Tools the server offered that could not be used, and why. */
      problems: string[];
      protocolVersion: string;
      serverName?: string;
    }
  | {
      kind: "failed";
      message: string;
      log: string;
      /** The configuration that failed. A changed one is worth trying. */
      fingerprint: string;
    };

export interface ServerManagerOptions {
  openTransport: (config: McpServerConfig) => OpenTransport;
  clientInfo: { name: string; version: string };
  /** Something about a server changed; re-render. */
  onChange: () => void;
  /** A server reported its tools, running the configuration given. */
  onToolsListed: (serverId: string, fingerprint: string, tools: McpToolInfo[]) => void;
}

export interface RunningSession {
  serverId: string;
  client: McpClient;
  tools: McpToolInfo[];
}

interface Session {
  fingerprint: string;
  cancelled: boolean;
  transport?: McpTransport;
  client?: McpClient;
  tools?: McpToolInfo[];
}

/**
 * Keeps the running servers in line with what should be running.
 *
 * The caller decides *which* servers may run — approved, unchanged since
 * approval, in a permission mode that can use them — and hands the list
 * to `reconcile`. This starts what is missing, stops what is no longer
 * wanted or whose configuration changed underneath it, and never
 * restarts a failed server by itself: a server that crashes on start
 * would otherwise be started in a loop.
 */
export class ServerManager {
  private readonly sessions = new Map<string, Session>();
  private readonly statuses = new Map<string, ServerStatus>();
  private readonly paused = new Set<string>();
  private wanted: readonly McpServerConfig[] = [];

  constructor(private readonly options: ServerManagerOptions) {}

  status(serverId: string): ServerStatus {
    return this.statuses.get(serverId) ?? { kind: "stopped" };
  }

  /** Stopped by the user for this session. */
  isPaused(serverId: string): boolean {
    return this.paused.has(serverId);
  }

  running(): RunningSession[] {
    const running: RunningSession[] = [];
    for (const [serverId, session] of this.sessions) {
      if (session.client && session.tools) {
        running.push({ serverId, client: session.client, tools: session.tools });
      }
    }
    return running;
  }

  reconcile(wanted: readonly McpServerConfig[]): void {
    this.wanted = wanted;
    const byId = new Map(wanted.map((config) => [config.id, config]));

    for (const [serverId, session] of [...this.sessions]) {
      const config = byId.get(serverId);
      if (!config || this.paused.has(serverId) || fingerprintServer(config) !== session.fingerprint) {
        this.stop(serverId);
      }
    }

    for (const config of wanted) {
      if (this.sessions.has(config.id) || this.paused.has(config.id)) continue;
      const status = this.statuses.get(config.id);
      if (status?.kind === "failed" && status.fingerprint === fingerprintServer(config)) continue;
      void this.start(config);
    }
  }

  pause(serverId: string): void {
    this.paused.add(serverId);
    this.reconcile(this.wanted);
    this.options.onChange();
  }

  resume(serverId: string): void {
    this.paused.delete(serverId);
    this.reconcile(this.wanted);
    this.options.onChange();
  }

  /** Clears a failure so the next reconcile tries again. */
  retry(serverId: string): void {
    if (this.statuses.get(serverId)?.kind === "failed") this.statuses.delete(serverId);
    this.paused.delete(serverId);
    this.reconcile(this.wanted);
    this.options.onChange();
  }

  stopAll(): void {
    this.wanted = [];
    for (const serverId of [...this.sessions.keys()]) this.stop(serverId);
  }

  private stop(serverId: string): void {
    const session = this.sessions.get(serverId);
    if (!session) return;
    this.sessions.delete(serverId);
    session.cancelled = true;
    this.statuses.set(serverId, { kind: "stopped" });

    // Before the handshake finishes there is no client yet, only the
    // process; closing that ends the handshake too.
    const closing = session.client ? session.client.close() : session.transport?.close();
    closing?.catch((error: unknown) => {
      this.statuses.set(serverId, {
        kind: "failed",
        message: `Couldn't stop the server: ${error instanceof Error ? error.message : String(error)}`,
        log: "",
        fingerprint: session.fingerprint,
      });
      this.options.onChange();
    });
    this.options.onChange();
  }

  private async start(config: McpServerConfig): Promise<void> {
    const serverId = config.id;
    const session: Session = { fingerprint: fingerprintServer(config), cancelled: false };
    this.sessions.set(serverId, session);
    this.statuses.set(serverId, { kind: "starting" });
    this.options.onChange();

    const base = this.options.openTransport(config);
    const open: OpenTransport = async (events) => {
      const transport = await base(events);
      session.transport = transport;
      if (session.cancelled) await transport.close();
      return transport;
    };

    try {
      const client = await McpClient.connect(open, { clientInfo: this.options.clientInfo });
      session.client = client;
      if (session.cancelled) {
        await client.close();
        return;
      }

      client.onExit((exit) => {
        // A stop that was asked for is not a failure.
        if (this.sessions.get(serverId) !== session) return;
        this.sessions.delete(serverId);
        this.statuses.set(serverId, {
          kind: "failed",
          message:
            exit.exitCode === null
              ? "The server stopped unexpectedly."
              : `The server stopped unexpectedly (exit code ${exit.exitCode}).`,
          log: exit.log,
          fingerprint: session.fingerprint,
        });
        this.options.onChange();
      });

      const listed = await client.listTools();
      if (session.cancelled) return;
      session.tools = listed.tools;
      this.statuses.set(serverId, {
        kind: "running",
        tools: listed.tools,
        problems: listed.problems,
        protocolVersion: client.protocolVersion,
        ...(client.serverName ? { serverName: client.serverName } : {}),
      });
      this.options.onToolsListed(serverId, session.fingerprint, listed.tools);
      this.options.onChange();
    } catch (error) {
      if (session.cancelled) return;
      this.sessions.delete(serverId);
      // A server that answered the handshake but failed to list its
      // tools is still running.
      if (session.client && !session.client.stopped) {
        // The shell's stop cannot fail — a server already gone is simply
        // gone — so this can only reject if that changes. The error being
        // reported below is the one that explains what happened.
        await session.client.close().catch(() => undefined);
      }
      this.statuses.set(serverId, {
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
        log: error instanceof McpError ? error.log : "",
        fingerprint: session.fingerprint,
      });
      this.options.onChange();
    }
  }
}
