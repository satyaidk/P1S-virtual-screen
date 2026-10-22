import type { SocketFactory, SocketLike } from "./connection-manager";

/**
 * Adapts the server bridge's HTTP transport to the WebSocket-like interface the
 * ConnectionManager expects:
 *  - receive: Server-Sent Events from `${base}/stream`
 *  - send:    POST `${base}/command`; the JSON response (a command_result) is delivered
 *             through `onmessage` like any other server message.
 *
 * EventSource reconnects on its own; we close it on error instead so the ConnectionManager's
 * backoff stays the single reconnect policy.
 */
export class SseSocket implements SocketLike {
  onopen: SocketLike["onopen"] = null;
  onclose: SocketLike["onclose"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onerror: SocketLike["onerror"] = null;
  private source: EventSource | null;
  private closed = false;

  constructor(private readonly base: string) {
    this.source = new EventSource(`${base}/stream`);
    this.source.onopen = () => this.onopen?.({});
    this.source.onmessage = (ev) => this.onmessage?.({ data: ev.data });
    this.source.onerror = () => {
      this.onerror?.({});
      this.shutdown("Bridge stream interrupted");
    };
  }

  get readyState(): number {
    if (this.closed || !this.source) return 3;
    return this.source.readyState === EventSource.OPEN ? 1 : 0;
  }

  send(data: string): void {
    void fetch(`${this.base}/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: data,
    })
      .then(async (res) => {
        const body = await res.text();
        if (res.ok) this.onmessage?.({ data: body });
        else this.onmessage?.({ data: failureResult(data, body, res.status) });
      })
      .catch((error: unknown) => {
        this.onmessage?.({
          data: failureResult(data, error instanceof Error ? error.message : "Network error", 0),
        });
      });
  }

  close(): void {
    this.shutdown(null);
  }

  private shutdown(reason: string | null): void {
    if (this.closed) return;
    this.closed = true;
    this.source?.close();
    this.source = null;
    this.onclose?.({ code: reason ? 1006 : 1000, reason: reason ?? "closed" });
  }
}

function failureResult(request: string, detail: string, status: number): string {
  let requestId = "";
  try {
    requestId = String((JSON.parse(request) as { requestId?: unknown }).requestId ?? "");
  } catch {
    /* ignore */
  }
  let message = detail;
  try {
    message = String((JSON.parse(detail) as { error?: unknown }).error ?? detail);
  } catch {
    /* plain text */
  }
  return JSON.stringify({
    type: "command_result",
    requestId,
    ok: false,
    message: status ? `${message} (HTTP ${status})` : message,
  });
}

export const sseSocketFactory: SocketFactory = (base) => new SseSocket(base);
