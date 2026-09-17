import type { McpTransport, OpenTransport, ServerExit, TransportEvents } from "../client.js";

/**
 * An MCP server in memory, for driving the real client over its real
 * wire format.
 *
 * Each generation is played the way real servers behave, including the
 * awkward parts: handshake-era servers answering the discovery probe
 * with an error, or with nothing at all.
 */

export type ServerEra = "modern" | "legacy" | "dual";

export interface ReceivedMessage {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

export type CallReply =
  | { result: Record<string, unknown> }
  | { error: { code: number; message: string; data?: unknown } }
  /** Never answer. */
  | "hang";

export interface ScriptedServerOptions {
  era: ServerEra;
  modernVersions?: string[];
  /** Handshake versions it accepts; it answers with the first otherwise. */
  legacyVersions?: string[];
  /**
   * How a handshake-era server treats a request before `initialize`.
   * Both kinds exist in the wild.
   */
  beforeInitialize?: "error" | "silent";
  capabilities?: Record<string, unknown>;
  tools?: unknown[];
  /** Tools per `tools/list` page. All on one page when absent. */
  pageSize?: number;
  /** Overrides the cursor handed back after each page. */
  cursorFor?: (page: number) => string | undefined;
  call?: (name: string, args: unknown) => CallReply;
  /** Lines written to standard output before anything else. */
  banner?: string[];
  instructions?: string;
  serverInfo?: { name: string; version: string };
}

export class ScriptedServer {
  readonly received: ReceivedMessage[] = [];
  private events: TransportEvents | undefined;
  private initialized = false;
  private stopped = false;
  closeRequests = 0;

  constructor(private readonly options: ScriptedServerOptions) {}

  readonly open: OpenTransport = async (events) => {
    this.events = events;
    for (const line of this.options.banner ?? []) this.write(line);
    const transport: McpTransport = {
      send: async (line) => {
        if (this.stopped) throw new Error("broken pipe");
        if (line.includes("\n")) throw new Error("a message contained a newline");
        const message = JSON.parse(line) as ReceivedMessage;
        this.received.push(message);
        queueMicrotask(() => this.handle(message));
      },
      close: async () => {
        this.closeRequests += 1;
        this.exit({ exitCode: 0, log: "" });
      },
    };
    return transport;
  };

  /** Simulates the process ending on its own. */
  exit(exit: ServerExit): void {
    if (this.stopped) return;
    this.stopped = true;
    queueMicrotask(() => this.events?.closed(exit));
  }

  /** Writes a raw line, as a misbehaving server might. */
  write(line: string): void {
    queueMicrotask(() => this.events?.message(line));
  }

  requests(method: string): ReceivedMessage[] {
    return this.received.filter((message) => message.method === method);
  }

  private reply(id: string | number, body: Record<string, unknown>): void {
    this.write(JSON.stringify({ jsonrpc: "2.0", id, ...body }));
  }

  private handle(message: ReceivedMessage): void {
    if (this.stopped || message.method === undefined) return;
    const { id, method } = message;
    const era = this.options.era;
    const modernVersions = this.options.modernVersions ?? ["2026-07-28"];
    const legacyVersions = this.options.legacyVersions ?? ["2025-11-25"];
    const meta = message.params?._meta as Record<string, unknown> | undefined;
    const requested = meta?.["io.modelcontextprotocol/protocolVersion"];

    if (id === undefined) {
      if (method === "notifications/initialized") this.initialized = true;
      return;
    }

    // A current-generation request is recognised by its metadata.
    if (typeof requested === "string" && era !== "legacy") {
      if (!modernVersions.includes(requested)) {
        this.reply(id, {
          error: {
            code: -32022,
            message: "Unsupported protocol version",
            data: {
              supported: era === "dual" ? [...modernVersions, ...legacyVersions] : modernVersions,
              requested,
            },
          },
        });
        return;
      }
      if (method === "server/discover") {
        this.reply(id, {
          result: {
            resultType: "complete",
            supportedVersions: era === "dual" ? [...modernVersions, ...legacyVersions] : modernVersions,
            capabilities: this.options.capabilities ?? { tools: {} },
            _meta: { "io.modelcontextprotocol/serverInfo": this.options.serverInfo },
            ...(this.options.instructions ? { instructions: this.options.instructions } : {}),
          },
        });
        return;
      }
      this.serve(id, method, message.params ?? {});
      return;
    }

    if (method === "initialize") {
      if (era === "modern") {
        this.reply(id, { error: { code: -32601, message: "Method not found: initialize" } });
        return;
      }
      const asked = message.params?.protocolVersion;
      this.reply(id, {
        result: {
          protocolVersion:
            typeof asked === "string" && legacyVersions.includes(asked) ? asked : legacyVersions[0],
          capabilities: this.options.capabilities ?? { tools: {} },
          serverInfo: this.options.serverInfo,
          ...(this.options.instructions ? { instructions: this.options.instructions } : {}),
        },
      });
      return;
    }

    if (era === "modern") {
      this.reply(id, { error: { code: -32602, message: "Missing _meta" } });
      return;
    }
    if (!this.initialized) {
      if (this.options.beforeInitialize === "silent") return;
      this.reply(id, { error: { code: -32601, message: `Method not found: ${method}` } });
      return;
    }
    this.serve(id, method, message.params ?? {});
  }

  private serve(id: string | number, method: string, params: Record<string, unknown>): void {
    const complete = this.options.era === "legacy" ? {} : { resultType: "complete" };

    if (method === "tools/list") {
      const tools = this.options.tools ?? [];
      const size = this.options.pageSize ?? Math.max(tools.length, 1);
      const page = typeof params.cursor === "string" ? Number(params.cursor.replace("page-", "")) : 0;
      const slice = tools.slice(page * size, (page + 1) * size);
      const hasMore = (page + 1) * size < tools.length;
      const nextCursor = this.options.cursorFor
        ? this.options.cursorFor(page)
        : hasMore
          ? `page-${page + 1}`
          : undefined;
      this.reply(id, {
        result: { ...complete, tools: slice, ...(nextCursor ? { nextCursor } : {}) },
      });
      return;
    }

    if (method === "tools/call") {
      const reply = this.options.call?.(String(params.name), params.arguments) ?? {
        error: { code: -32602, message: `Unknown tool: ${String(params.name)}` },
      };
      if (reply === "hang") return;
      if ("error" in reply) {
        this.reply(id, { error: reply.error });
        return;
      }
      this.reply(id, { result: { ...complete, ...reply.result } });
      return;
    }

    this.reply(id, { error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

export const CLIENT_INFO = { name: "paleonyx-test", version: "0.0.0" };

export function textTool(name: string, description = `Does ${name}.`): Record<string, unknown> {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { topic: { type: "string" } },
      required: ["topic"],
    },
  };
}
