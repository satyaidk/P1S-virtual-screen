import {
  COMMAND_SPECS,
  commandEffectObserved,
  validateCommand,
  type CommandResult,
  type CommandType,
  type PrinterCommand,
  type ValidationResult,
} from "./commands";
import type { EventLog } from "./event-log";
import type { PrinterProvider } from "./providers/PrinterProvider";
import type { Clock } from "./simulation/clock";

export type RequestStatus = "pending" | "succeeded" | "failed" | "rejected" | "timeout";

export interface CommandRequest {
  id: number;
  command: PrinterCommand;
  status: RequestStatus;
  startedAt: number;
  finishedAt: number | null;
  attempts: number;
  message: string | null;
}

export interface CommandManagerOptions {
  /** Overall budget for ack + observed effect. */
  timeoutMs?: number;
  /** Extra attempts for idempotent commands whose ack timed out. Destructive ones never retry. */
  maxRetries?: number;
  staleAfterMs?: number;
  historySize?: number;
}

const TIMEOUT = Symbol("timeout");

/**
 * Turns a UI intent into a tracked request:
 * validate -> record pending -> send -> await ack -> await observed effect -> settle.
 */
export class CommandManager {
  private requests: CommandRequest[] = [];
  private seq = 0;
  private listeners = new Set<(requests: readonly CommandRequest[]) => void>();
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly historySize: number;

  constructor(
    private readonly provider: PrinterProvider,
    private readonly clock: Clock,
    private readonly log: EventLog,
    private readonly options: CommandManagerOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 1;
    this.historySize = options.historySize ?? 20;
  }

  validate(command: PrinterCommand): ValidationResult {
    return validateCommand(command, this.provider.getState(), {
      supported: this.provider.capabilities.commands,
      now: this.clock.now(),
      staleAfterMs: this.options.staleAfterMs,
    });
  }

  isPending(type: CommandType): boolean {
    return this.requests.some((r) => r.status === "pending" && r.command.type === type);
  }

  getRequests(): readonly CommandRequest[] {
    return this.requests;
  }

  subscribe(listener: (requests: readonly CommandRequest[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async execute(command: PrinterCommand): Promise<CommandRequest> {
    const spec = COMMAND_SPECS[command.type];
    const request: CommandRequest = {
      id: ++this.seq,
      command,
      status: "pending",
      startedAt: this.clock.now(),
      finishedAt: null,
      attempts: 0,
      message: null,
    };

    const validation = this.isPending(command.type)
      ? ({ ok: false, reason: "Already in progress" } as const)
      : this.validate(command);
    if (!validation.ok) {
      this.record({
        ...request,
        status: "rejected",
        finishedAt: this.clock.now(),
        message: validation.reason,
      });
      this.log.push({
        category: "command",
        level: "warn",
        message: `${spec.label} rejected: ${validation.reason}`,
      });
      return this.find(request.id);
    }

    this.record(request);
    this.log.push({
      category: "command",
      level: "info",
      message: `${spec.label} sent`,
      data: command,
    });

    const deadline = request.startedAt + this.timeoutMs;
    let ack: CommandResult | typeof TIMEOUT = TIMEOUT;
    const maxAttempts = spec.idempotent && !spec.destructive ? 1 + this.maxRetries : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.update(request.id, { attempts: attempt });
      const remaining = deadline - this.clock.now();
      if (remaining <= 0) break;
      // Split the remaining budget so a permitted retry still has time to run.
      const budget = remaining / (maxAttempts - attempt + 1);
      ack = await this.withTimeout(this.provider.sendCommand(command), budget);
      if (ack !== TIMEOUT) break;
      if (attempt < maxAttempts) {
        this.log.push({
          category: "command",
          level: "warn",
          message: `${spec.label}: no ack, retrying`,
        });
      }
    }

    if (ack === TIMEOUT)
      return this.settle(request.id, "timeout", "No acknowledgement from printer");
    if (!ack.ok)
      return this.settle(request.id, "failed", ack.message ?? "Printer reported failure");

    const observed = await this.waitForEffect(command, deadline - this.clock.now());
    if (!observed)
      return this.settle(
        request.id,
        "timeout",
        ack.message ?? "Printer did not confirm the change",
      );
    return this.settle(request.id, "succeeded", spec.successLabel);
  }

  private waitForEffect(command: PrinterCommand, budgetMs: number): Promise<boolean> {
    if (commandEffectObserved(command, this.provider.getState())) return Promise.resolve(true);
    if (budgetMs <= 0) return Promise.resolve(false);
    return new Promise((resolve) => {
      const unsubscribe = this.provider.subscribe((state) => {
        if (commandEffectObserved(command, state)) {
          this.clock.clearTimeout(timer);
          unsubscribe();
          resolve(true);
        }
      });
      const timer = this.clock.setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, budgetMs);
    });
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
    return new Promise((resolve) => {
      const timer = this.clock.setTimeout(() => resolve(TIMEOUT), Math.max(0, ms));
      promise.then(
        (value) => {
          this.clock.clearTimeout(timer);
          resolve(value);
        },
        () => {
          this.clock.clearTimeout(timer);
          resolve({ ok: false, message: "Transport error" } as T);
        },
      );
    });
  }

  private settle(id: number, status: RequestStatus, message: string): CommandRequest {
    this.update(id, { status, message, finishedAt: this.clock.now() });
    const req = this.find(id);
    const spec = COMMAND_SPECS[req.command.type];
    this.log.push({
      category: "command",
      level: status === "succeeded" ? "info" : "error",
      message:
        status === "succeeded" ? `${spec.label}: confirmed` : `${spec.label} ${status}: ${message}`,
    });
    return req;
  }

  private find(id: number): CommandRequest {
    const req = this.requests.find((r) => r.id === id);
    if (!req) throw new Error(`Unknown request ${id}`);
    return req;
  }

  private record(request: CommandRequest): void {
    this.requests = [...this.requests, request].slice(-this.historySize);
    this.emit();
  }

  private update(id: number, patch: Partial<CommandRequest>): void {
    this.requests = this.requests.map((r) => (r.id === id ? { ...r, ...patch } : r));
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l(this.requests);
  }
}
