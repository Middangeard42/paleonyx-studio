import { Channel, invoke } from "@tauri-apps/api/core";
import type { McpServerConfig } from "@paleonyx/shared-types";
import type { OpenTransport } from "@paleonyx/mcp-client";

/** What the shell reports about a running server (src-tauri/src/mcp.rs). */
type ServerEvent =
  | { kind: "message"; line: string }
  | { kind: "oversized"; bytes: number }
  | { kind: "closed"; exitCode: number | null; log: string };

/**
 * A page that has just loaded cannot know what an earlier copy of itself
 * started — a reload in development, or a crash of the page alone. Those
 * servers are stopped once, before this page starts any of its own.
 */
let leftoversStopped: Promise<void> | undefined;

/**
 * Starts a server through the shell and connects it to the MCP client.
 *
 * The program and its arguments go down separately and are never joined
 * into a command line — there is no shell anywhere on this path, the
 * same as `run_command`.
 */
export function serverTransport(config: McpServerConfig): OpenTransport {
  return async (events) => {
    leftoversStopped ??= invoke<void>("mcp_stop_all");
    await leftoversStopped;

    const channel = new Channel<ServerEvent>();
    channel.onmessage = (event) => {
      switch (event.kind) {
        case "message":
          events.message(event.line);
          return;
        case "oversized":
          // Passed on as a line the client cannot parse, which it keeps
          // for diagnosis — the request that was waiting on this message
          // will time out, and this explains why.
          events.message(`(A ${event.bytes}-byte message from the server was too large and was dropped.)`);
          return;
        case "closed":
          events.closed({ exitCode: event.exitCode, log: event.log });
          return;
      }
    };

    const id = await invoke<number>("mcp_start", {
      program: config.command,
      args: config.args,
      env: config.env,
      events: channel,
    });

    return {
      send: (line) => invoke<void>("mcp_send", { id, line }),
      close: () => invoke<void>("mcp_stop", { id }),
    };
  };
}
