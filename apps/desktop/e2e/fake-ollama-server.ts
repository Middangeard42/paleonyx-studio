import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A scripted Ollama, as a real HTTP server the desktop app talks to.
 *
 * A real model answers differently every run, and the journeys these
 * tests check — propose a change, apply it, undo it — need the same
 * answer every time. The app is pointed here through a development-only
 * setting (see OLLAMA_URL in App.tsx); a shipped build cannot be.
 *
 * It sends permissive CORS headers because the app's page is served from
 * the Vite dev server's origin and this is another one. Real Ollama
 * allows the app's origins the same way.
 */

export interface FakeChat {
  model: string;
  messages: { role: string; content: string; tool_name?: string }[];
  tools?: { function: { name: string } }[];
}

export interface FakeOllamaServer {
  url: string;
  /** Every chat request received, parsed. */
  chats: FakeChat[];
  /** Replaces the structured answer the next chat receives. */
  setAnswer(answer: unknown): void;
  close(): Promise<void>;
}

export const FAKE_MODEL = "fake-model";

/**
 * A second model, one that calls tools. While gathering, it asks for
 * `TOOLS_MODEL_CALL` once — if that tool is on offer — then says it has
 * what it needs. Listed after `FAKE_MODEL`, so it is used only when a
 * journey picks it.
 */
export const TOOLS_MODEL = "fake-tools-model";
export const TOOLS_MODEL_CALL = { name: "mcp__notes__lookup", arguments: { topic: "sum" } };

export async function startFakeOllama(initialAnswer: unknown): Promise<FakeOllamaServer> {
  const chats: FakeOllamaServer["chats"] = [];
  let answer = initialAnswer;

  const server: Server = createServer((request, response) => {
    void route(request, response);
  });

  async function route(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    const url = request.url ?? "";
    if (url.startsWith("/api/tags")) {
      send(response, {
        models: [
          {
            name: FAKE_MODEL,
            // Completion only: the app takes the single-pass path, so one
            // chat request carries the whole answer and the test does not
            // depend on how a gathering loop happens to unfold.
            capabilities: ["completion"],
            details: { parameter_size: "7B", context_length: 32768 },
          },
          {
            name: TOOLS_MODEL,
            capabilities: ["completion", "tools"],
            details: { parameter_size: "7B", context_length: 32768 },
          },
        ],
      });
      return;
    }

    if (url.startsWith("/api/show")) {
      const body = JSON.parse(await readBody(request)) as { model?: string; name?: string };
      const name = body.model ?? body.name;
      send(response, {
        capabilities: name === TOOLS_MODEL ? ["completion", "tools"] : ["completion"],
      });
      return;
    }

    if (url.startsWith("/api/chat")) {
      const body = JSON.parse(await readBody(request)) as FakeChat;
      chats.push(body);
      const last = body.messages.at(-1);
      const answering =
        last?.role === "user" && /^(Now answer|Reply with only the fenced)/.test(last.content);
      const offered = (body.tools ?? []).some(
        (tool) => tool.function.name === TOOLS_MODEL_CALL.name
      );
      const alreadyCalled = body.messages.some((message) => message.role === "tool");

      if (body.model === TOOLS_MODEL && !answering) {
        send(response, {
          message:
            offered && !alreadyCalled
              ? { role: "assistant", content: "", tool_calls: [{ function: TOOLS_MODEL_CALL }] }
              : { role: "assistant", content: "I have what I need." },
          done: true,
          prompt_eval_count: 10,
          eval_count: 10,
        });
        return;
      }

      send(response, {
        message: {
          role: "assistant",
          content: "```json\n" + JSON.stringify(answer) + "\n```",
        },
        done: true,
        prompt_eval_count: 10,
        eval_count: 10,
      });
      return;
    }

    response.writeHead(404).end(`fake ollama has no route for ${url}`);
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    chats,
    setAnswer(next) {
      answer = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function send(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (data += chunk));
    request.on("end", () => resolve(data));
    request.on("error", reject);
  });
}
