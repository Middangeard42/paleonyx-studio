/**
 * A minimal Chrome DevTools Protocol client, over Node's built-in
 * WebSocket.
 *
 * The usual route to driving a Tauri app is `tauri-driver` plus a
 * WebView2 driver binary that has to match the installed runtime
 * exactly. WebView2 is Chromium, though, and it opens the DevTools
 * protocol when told to by an environment variable, so the whole
 * dependency can be a hundred lines here instead.
 *
 * It also buys something WebDriver made awkward: `Input.dispatchMouseEvent`
 * is a real, trusted click that Chromium hit-tests and routes to whatever
 * is under the pointer — including the sandboxed, cross-origin preview
 * frame, which design mode depends on and which synthetic clicks from
 * page script could not reach.
 */

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface Protocol {
  id?: number;
  result?: unknown;
  error?: { message: string };
}

export interface Target {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export async function listTargets(port: number): Promise<Target[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  return (await response.json()) as Target[];
}

export class CdpSession {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Protocol;
      if (message.id === undefined) return;
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);
    });
  }

  static async connect(target: Target): Promise<CdpSession> {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP connect failed")), {
        once: true,
      });
    });
    return new CdpSession(socket);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Runs an expression in the page and returns its value.
   *
   * Throws with the page's own error text when the expression throws,
   * rather than returning undefined — a test that silently reads
   * `undefined` from a failed lookup is a test that passes by accident.
   */
  async evaluate<T>(expression: string): Promise<T> {
    const reply = await this.send<{
      result: { value?: T };
      exceptionDetails?: { exception?: { description?: string }; text: string };
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (reply.exceptionDetails) {
      throw new Error(
        reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text
      );
    }
    return reply.result.value as T;
  }

  close(): void {
    this.socket.close();
  }
}
