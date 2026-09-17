// A small MCP server for the end-to-end tests, in the handshake-era
// protocol most servers in use still speak. It records what happens to
// it in the file named by NOTES_LOG, outside the project, so the tests
// can tell whether it was started, what it was asked, and whether it
// stopped.
import { appendFileSync } from "node:fs";
import process from "node:process";
import { createInterface } from "node:readline";

const log = (entry) => appendFileSync(process.env.NOTES_LOG, `${JSON.stringify(entry)}\n`);
const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

log({ event: "started" });

let initialized = false;
const lines = createInterface({ input: process.stdin });

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) {
    if (message.method === "notifications/initialized") initialized = true;
    return;
  }
  if (message.method === "initialize") {
    send({
      id: message.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "notes", version: "1.0.0" },
      },
    });
    return;
  }
  if (!initialized) {
    send({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
    return;
  }
  if (message.method === "tools/list") {
    send({
      id: message.id,
      result: {
        tools: [
          {
            name: "lookup",
            description: "Looks up the team's notes on a topic.",
            inputSchema: {
              type: "object",
              properties: { topic: { type: "string" } },
              required: ["topic"],
            },
          },
        ],
      },
    });
    return;
  }
  if (message.method === "tools/call") {
    const { name, arguments: args } = message.params;
    log({ event: "call", name, arguments: args });
    send({
      id: message.id,
      result: {
        content: [
          {
            type: "text",
            text: `PALEONYX-E2E-NOTES: loops over ${args.topic} stop before the length.`,
          },
        ],
      },
    });
    return;
  }
  send({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
});

// A closed input is how the app asks a server to stop.
lines.on("close", () => {
  log({ event: "stopped" });
  process.exit(0);
});
