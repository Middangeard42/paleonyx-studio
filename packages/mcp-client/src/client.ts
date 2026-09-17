import type { McpToolInfo } from "@paleonyx/shared-types";
import {
  METHOD_NOT_FOUND,
  UNSUPPORTED_PROTOCOL_VERSION,
  encode,
  isRecord,
  parseIncoming,
} from "./json-rpc.js";
import type { RequestId } from "./json-rpc.js";
import { describeToolResult, parseTool } from "./tools.js";
import type { ToolCallOutcome } from "./tools.js";

/**
 * The revision that carries its version on every request instead of
 * opening a session. Servers written before it still expect the
 * `initialize` handshake, so both are spoken (see `handshake`).
 */
export const MODERN_PROTOCOL_VERSION = "2026-07-28";

/**
 * Handshake-era revisions this client can use, newest first. Their
 * differences do not touch listing or calling tools, which is all this
 * client does.
 */
export const LEGACY_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

export const MAX_TOOL_PAGES = 10;
export const MAX_TOOLS_PER_SERVER = 100;

/** Diagnostic lines kept from a server that writes things that are not messages. */
const MAX_NOISE_LINES = 5;

export interface ServerExit {
  exitCode: number | null;
  /** The last lines the server wrote to its error stream. */
  log: string;
}

export interface TransportEvents {
  /** One line the server wrote to its standard output. */
  message(line: string): void;
  /** The server has stopped. Called once. */
  closed(exit: ServerExit): void;
}

/**
 * The process underneath. Supplied by the host, because starting a
 * program is a shell capability (CLAUDE.md §2) — this package never
 * spawns anything itself.
 */
export interface McpTransport {
  /** Writes one message. The transport adds the line ending. */
  send(line: string): Promise<void>;
  /** Asks the server to stop. `closed` fires once it has. */
  close(): Promise<void>;
}

export type OpenTransport = (events: TransportEvents) => Promise<McpTransport>;

export type McpErrorKind =
  /** The server exited, or could not be written to. */
  | "stopped"
  /** No answer in time. */
  | "timeout"
  /** The server answered with an error. */
  | "rejected"
  /** The server answered with something this client cannot read. */
  | "protocol"
  /** No protocol version both sides speak. */
  | "unsupported-version";

export class McpError extends Error {
  constructor(
    readonly kind: McpErrorKind,
    message: string,
    /** What the server printed, when it helps explain the failure. */
    readonly log = "",
    readonly code?: number,
    readonly data?: unknown
  ) {
    super(message);
    this.name = "McpError";
  }
}

export interface McpClientOptions {
  clientInfo: { name: string; version: string };
  /**
   * How long the discovery probe waits before deciding the server
   * predates it. Generous, because the first answer also waits for the
   * server to start, and `npx` may be downloading it.
   */
  probeTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface ListedTools {
  tools: McpToolInfo[];
  /** Tools that were left out, and why. */
  problems: string[];
}

interface Pending {
  resolve(result: Record<string, unknown>): void;
  reject(error: McpError): void;
  timer: ReturnType<typeof setTimeout>;
}

interface RequestOptions {
  timeoutMs?: number;
  /**
   * Whether to tell the server to stop on timeout. Not for the probe or
   * the handshake: a server that predates the probe knows nothing of
   * cancellation yet, and `initialize` must never be cancelled.
   */
  cancelOnTimeout?: boolean;
}

export class McpClient {
  private transport: McpTransport | undefined;
  private nextId = 1;
  private readonly pending = new Map<RequestId, Pending>();
  private era: "unknown" | "modern" | "legacy" = "unknown";
  private version = MODERN_PROTOCOL_VERSION;
  private exit: ServerExit | undefined;
  private readonly noise: string[] = [];
  private readonly exitListeners = new Set<(exit: ServerExit) => void>();
  private capabilities: Record<string, unknown> = {};
  private info: { name?: string; version?: string } = {};
  private serverInstructions: string | undefined;

  private constructor(private readonly options: McpClientOptions) {}

  /**
   * Starts a session with a server: open the transport, work out which
   * protocol generation it speaks, and agree a version.
   *
   * Closes the transport again if any of that fails, so a failed
   * connection never leaves a process running.
   */
  static async connect(open: OpenTransport, options: McpClientOptions): Promise<McpClient> {
    const client = new McpClient(options);
    client.transport = await open({
      message: (line) => client.receive(line),
      closed: (exit) => client.handleExit(exit),
    });
    try {
      await client.handshake();
    } catch (error) {
      // The handshake failure is what explains this to the user. A
      // server that cannot even be asked to stop has already stopped.
      await client.close().catch(() => undefined);
      throw error;
    }
    return client;
  }

  get protocolVersion(): string {
    return this.version;
  }

  get serverName(): string | undefined {
    return this.info.name;
  }

  get serverVersion(): string | undefined {
    return this.info.version;
  }

  /** Guidance the server wrote for models. Untrusted, like its tool descriptions. */
  get instructions(): string | undefined {
    return this.serverInstructions;
  }

  get offersTools(): boolean {
    return isRecord(this.capabilities.tools);
  }

  get stopped(): boolean {
    return this.exit !== undefined;
  }

  /** Called once when the server stops, whether asked to or not. */
  onExit(listener: (exit: ServerExit) => void): () => void {
    if (this.exit) {
      listener(this.exit);
      return () => {};
    }
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  async listTools(): Promise<ListedTools> {
    if (!this.offersTools) return { tools: [], problems: [] };

    const tools: McpToolInfo[] = [];
    const problems: string[] = [];
    const names = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const result = await this.request("tools/list", cursor === undefined ? {} : { cursor });
      if (!Array.isArray(result.tools)) {
        throw new McpError("protocol", "The server's list of tools is not a list.");
      }

      for (const entry of result.tools) {
        if (tools.length >= MAX_TOOLS_PER_SERVER) {
          problems.push(
            `The server offers more than ${MAX_TOOLS_PER_SERVER} tools; the rest were left out.`
          );
          return { tools, problems };
        }
        const parsed = parseTool(entry);
        if (!parsed.ok) {
          problems.push(parsed.error);
          continue;
        }
        if (names.has(parsed.tool.name)) {
          problems.push(`The server lists "${parsed.tool.name}" twice; only the first is used.`);
          continue;
        }
        names.add(parsed.tool.name);
        tools.push(parsed.tool);
      }

      const next = result.nextCursor;
      if (typeof next !== "string" || next.length === 0) return { tools, problems };
      // A server that hands back a cursor it already gave would be read
      // forever.
      if (cursors.has(next)) {
        problems.push("The server's list of tools repeats itself, so reading it was stopped.");
        return { tools, problems };
      }
      cursors.add(next);
      cursor = next;
    }

    problems.push(`The server's list of tools runs past ${MAX_TOOL_PAGES} pages; the rest were left out.`);
    return { tools, problems };
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<ToolCallOutcome> {
    const result = await this.request("tools/call", { name, arguments: args }, { timeoutMs });
    const outcome = describeToolResult(result);
    if (!outcome) {
      throw new McpError("protocol", `The server's answer from ${name} could not be read.`);
    }
    return outcome;
  }

  /** Stops the server, and resolves once it has stopped. */
  async close(): Promise<void> {
    if (this.exit || !this.transport) return;
    const exited = new Promise<void>((resolve) => {
      this.onExit(() => resolve());
    });
    await this.transport.close();
    await exited;
  }

  /**
   * Works out which generation of MCP the server speaks.
   *
   * Follows the stdio compatibility rules in MCP 2026-07-28: ask with
   * `server/discover` first. An answer, or the protocol's own
   * unsupported-version error, means a current server. Anything else —
   * any other error, or silence — means one that predates the probe, and
   * the `initialize` handshake is used instead. The fallback is not tied
   * to a particular error code, because older servers answer unknown
   * methods in different ways, or not at all.
   */
  private async handshake(): Promise<void> {
    let discovered: Record<string, unknown>;
    try {
      discovered = await this.request(
        "server/discover",
        {},
        { timeoutMs: this.options.probeTimeoutMs ?? 15_000, cancelOnTimeout: false }
      );
    } catch (error) {
      if (!(error instanceof McpError) || error.kind === "stopped") throw error;
      if (error.kind === "rejected" && error.code === UNSUPPORTED_PROTOCOL_VERSION) {
        const supported = isRecord(error.data) ? versionList(error.data.supported) : undefined;
        if (!supported) {
          throw new McpError(
            "protocol",
            "The server refused this client's protocol version without saying which versions it supports."
          );
        }
        // It speaks the current generation, just not this version of it.
        // A handshake-era version it lists is the only other option.
        return this.initializeWithAny(supported);
      }
      return this.initialize(LEGACY_PROTOCOL_VERSIONS[0]!);
    }

    const supported = versionList(discovered.supportedVersions);
    if (!supported) {
      throw new McpError("protocol", "The server's description of itself lists no protocol versions.");
    }
    if (!supported.includes(MODERN_PROTOCOL_VERSION)) return this.initializeWithAny(supported);

    this.era = "modern";
    this.capabilities = isRecord(discovered.capabilities) ? discovered.capabilities : {};
    const meta = isRecord(discovered._meta) ? discovered._meta : {};
    this.info = readInfo(meta["io.modelcontextprotocol/serverInfo"]);
    this.serverInstructions =
      typeof discovered.instructions === "string" ? discovered.instructions : undefined;
  }

  private async initializeWithAny(supported: string[]): Promise<void> {
    const shared = LEGACY_PROTOCOL_VERSIONS.find((version) => supported.includes(version));
    if (!shared) {
      throw new McpError(
        "unsupported-version",
        `The server speaks MCP ${supported.slice(0, 4).join(", ")}, and Paleonyx Studio speaks ${[
          MODERN_PROTOCOL_VERSION,
          ...LEGACY_PROTOCOL_VERSIONS,
        ].join(", ")}.`
      );
    }
    return this.initialize(shared);
  }

  private async initialize(version: string): Promise<void> {
    // Set first: a server of this generation may ping during the
    // handshake, and pings are answered only in this generation.
    this.era = "legacy";
    const result = await this.request(
      "initialize",
      {
        protocolVersion: version,
        // Nothing offered: no sampling, no roots, no elicitation. A
        // server cannot ask the app for anything.
        capabilities: {},
        clientInfo: this.options.clientInfo,
      },
      { cancelOnTimeout: false }
    );

    const agreed = result.protocolVersion;
    if (typeof agreed !== "string" || !LEGACY_PROTOCOL_VERSIONS.includes(agreed)) {
      throw new McpError(
        "unsupported-version",
        `The server wants to speak MCP ${
          typeof agreed === "string" ? agreed.slice(0, 32) : "(unstated)"
        }, which Paleonyx Studio does not support.`
      );
    }
    this.version = agreed;
    this.capabilities = isRecord(result.capabilities) ? result.capabilities : {};
    this.info = readInfo(result.serverInfo);
    this.serverInstructions = typeof result.instructions === "string" ? result.instructions : undefined;
    await this.notify("notifications/initialized");
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    options: RequestOptions = {}
  ): Promise<Record<string, unknown>> {
    if (this.exit) return Promise.reject(this.stoppedError());
    const transport = this.transport;
    if (!transport) return Promise.reject(new McpError("stopped", "The server is not running."));

    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs ?? 60_000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (options.cancelOnTimeout !== false) {
          // Best effort by nature: if this cannot be sent, the server has
          // stopped, and that is reported through the exit handler.
          this.notify("notifications/cancelled", { requestId: id, reason: "Timed out" }).catch(
            () => undefined
          );
        }
        reject(
          new McpError(
            "timeout",
            `The server did not answer within ${Math.round(timeoutMs / 1000)} seconds.`,
            this.noiseLog()
          )
        );
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      transport.send(encode({ id, method, params: this.withMeta(params, method) })).catch(
        (error: unknown) => {
          const pending = this.pending.get(id);
          if (!pending) return;
          this.pending.delete(id);
          clearTimeout(pending.timer);
          pending.reject(
            new McpError(
              "stopped",
              `Could not send to the server: ${error instanceof Error ? error.message : String(error)}`
            )
          );
        }
      );
    });
  }

  private async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    if (this.exit || !this.transport) return;
    await this.transport.send(encode(params ? { method, params } : { method }));
  }

  /**
   * Current-generation requests carry their version and the client's
   * capabilities with them, since there is no session to hold them. The
   * probe is sent this way too — that is what makes it a probe.
   */
  private withMeta(params: Record<string, unknown>, method: string): Record<string, unknown> {
    if (this.era === "legacy" || (this.era === "unknown" && method !== "server/discover")) {
      return params;
    }
    return {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": this.version,
        "io.modelcontextprotocol/clientInfo": this.options.clientInfo,
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    };
  }

  private receive(line: string): void {
    const message = parseIncoming(line);
    switch (message.kind) {
      case "result": {
        const pending = this.take(message.id);
        pending?.resolve(message.result);
        return;
      }
      case "error": {
        const pending = message.id === null ? undefined : this.take(message.id);
        if (!pending) {
          this.remember(line);
          return;
        }
        pending.reject(
          new McpError(
            "rejected",
            message.error.message,
            "",
            message.error.code,
            message.error.data
          )
        );
        return;
      }
      case "request":
        // Only a handshake-era server may ask the client things, and this
        // client offered it nothing to ask for. Current servers never
        // send requests, and a client of that generation must never send
        // a response — so outside the older generation, nothing is said.
        if (this.era !== "legacy") {
          this.remember(line);
          return;
        }
        this.transport
          ?.send(
            encode(
              message.method === "ping"
                ? { id: message.id, result: {} }
                : {
                    id: message.id,
                    error: {
                      code: METHOD_NOT_FOUND,
                      message: `Paleonyx Studio does not support ${message.method.slice(0, 64)}.`,
                    },
                  }
            )
          )
          // A reply that cannot be sent means the server has gone, which
          // the exit handler reports.
          .catch(() => undefined);
        return;
      case "notification":
        // Progress, log messages, list changes. None of them change what
        // this client does, so they are read and let go.
        return;
      case "invalid":
        this.remember(line);
        return;
    }
  }

  /** Late answers — to a request that already timed out — find nothing and are dropped. */
  private take(id: RequestId): Pending | undefined {
    const pending = this.pending.get(id);
    if (!pending) return undefined;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    return pending;
  }

  /**
   * Keeps a few of the lines that were not usable messages. A server
   * that prints a banner to its output instead of its error stream is
   * the most common way these break, and seeing the banner explains it.
   */
  private remember(line: string): void {
    if (this.noise.length >= MAX_NOISE_LINES) return;
    this.noise.push(line.length > 200 ? `${line.slice(0, 200)}…` : line);
  }

  private noiseLog(): string {
    if (this.noise.length === 0) return "";
    return `The server also wrote lines that were not MCP messages:\n${this.noise.join("\n")}`;
  }

  private handleExit(exit: ServerExit): void {
    if (this.exit) return;
    this.exit = exit;
    const error = this.stoppedError();
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
    for (const listener of this.exitListeners) listener(exit);
    this.exitListeners.clear();
  }

  private stoppedError(): McpError {
    const exit = this.exit;
    const code = exit?.exitCode;
    const log = [exit?.log.trim() ?? "", this.noiseLog()].filter(Boolean).join("\n\n");
    return new McpError(
      "stopped",
      code === null || code === undefined
        ? "The server stopped."
        : `The server stopped (exit code ${code}).`,
      log
    );
  }
}

function versionList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.every((entry) => typeof entry === "string") ? (value as string[]) : undefined;
}

function readInfo(value: unknown): { name?: string; version?: string } {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.name === "string" ? { name: value.name.slice(0, 100) } : {}),
    ...(typeof value.version === "string" ? { version: value.version.slice(0, 40) } : {}),
  };
}
