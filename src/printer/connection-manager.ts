import type { Clock, TimerHandle } from "./simulation/clock";

/** The subset of the browser WebSocket API the connection manager needs (easy to fake in tests). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export const SOCKET_OPEN = 1;

export interface BackoffPolicy {
  initialMs: number;
  maxMs: number;
  factor: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { initialMs: 1000, maxMs: 30_000, factor: 2 };

export function backoffDelay(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF): number {
  return Math.min(policy.maxMs, policy.initialMs * policy.factor ** Math.max(0, attempt));
}

export type ManagerStatus = "idle" | "connecting" | "open" | "waiting";

export interface ConnectionHandlers {
  onStatus(status: ManagerStatus, detail?: string): void;
  onMessage(data: unknown): void;
}

/**
 * Keeps one socket to the bridge open, reconnecting with capped exponential backoff.
 * It never replays messages after a reconnect: commands are the command manager's concern.
 */
export class ConnectionManager {
  private socket: SocketLike | null = null;
  private attempt = 0;
  private retryTimer: TimerHandle | null = null;
  private running = false;
  private status: ManagerStatus = "idle";

  constructor(
    /** A function is re-evaluated on every (re)connect, e.g. to add a resume flag. */
    private readonly url: string | (() => string),
    private readonly factory: SocketFactory,
    private readonly clock: Clock,
    private readonly handlers: ConnectionHandlers,
    private readonly backoff: BackoffPolicy = DEFAULT_BACKOFF,
  ) {}

  get currentStatus(): ManagerStatus {
    return this.status;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    this.open();
  }

  stop(): void {
    this.running = false;
    if (this.retryTimer !== null) this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close(1000, "client stop");
    }
    this.setStatus("idle");
  }

  send(data: string): boolean {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return false;
    this.socket.send(data);
    return true;
  }

  private open(): void {
    this.setStatus("connecting");
    let socket: SocketLike;
    try {
      socket = this.factory(typeof this.url === "function" ? this.url() : this.url);
    } catch (error) {
      this.scheduleRetry(error instanceof Error ? error.message : "socket creation failed");
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus("open");
    };
    socket.onmessage = (ev) => this.handlers.onMessage(ev.data);
    socket.onerror = () => {
      /* onclose follows and handles the retry */
    };
    socket.onclose = (ev) => {
      if (this.socket === socket) this.socket = null;
      this.scheduleRetry(ev.reason || `closed (${ev.code ?? "?"})`);
    };
  }

  private scheduleRetry(reason: string): void {
    if (!this.running) return;
    const delay = backoffDelay(this.attempt++, this.backoff);
    this.setStatus("waiting", `${reason}; retrying in ${Math.round(delay / 1000)}s`);
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      if (this.running) this.open();
    }, delay);
  }

  private setStatus(status: ManagerStatus, detail?: string): void {
    this.status = status;
    this.handlers.onStatus(status, detail);
  }
}
