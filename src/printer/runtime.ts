import { CommandManager, type CommandRequest } from "./command-manager";
import type { PrinterCommand, ValidationResult } from "./commands";
import { EventLog, type LogEvent } from "./event-log";
import type { PrinterProvider } from "./providers/PrinterProvider";
import type { SimulationStatus } from "./providers/SimulatedPrinterProvider";
import { systemClock, type Clock } from "./simulation/clock";
import { DEFAULT_STALE_AFTER_MS } from "./state";
import type { PrinterState } from "./types";
import { changedPaths, replaceEqualDeep } from "@/lib/structural-sharing";

export interface TelemetryRecord {
  id: number;
  at: number;
  changed: string[];
}

export interface RuntimeSnapshot {
  state: PrinterState;
  requests: readonly CommandRequest[];
  events: readonly LogEvent[];
  telemetry: readonly TelemetryRecord[];
  simulation: SimulationStatus | null;
}

export interface RuntimeOptions {
  clock?: Clock;
  staleAfterMs?: number;
  commandTimeoutMs?: number;
  telemetryHistory?: number;
}

/**
 * Framework-independent composition root: provider + command manager + event log.
 * React binds to it through a store (src/hooks/usePrinter.tsx); firmware would mirror it as the
 * main task that owns the state struct.
 */
export class PrinterRuntime {
  readonly log: EventLog;
  readonly commands: CommandManager;
  readonly clock: Clock;
  readonly staleAfterMs: number;

  private snapshot: RuntimeSnapshot;
  private listeners = new Set<(snapshot: RuntimeSnapshot) => void>();
  private unsubscribers: (() => void)[] = [];
  private telemetrySeq = 0;
  private readonly telemetryHistory: number;

  constructor(
    readonly provider: PrinterProvider,
    options: RuntimeOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.telemetryHistory = options.telemetryHistory ?? 40;
    this.log = new EventLog(() => this.clock.now());
    this.commands = new CommandManager(provider, this.clock, this.log, {
      staleAfterMs: this.staleAfterMs,
      timeoutMs: options.commandTimeoutMs,
    });
    this.snapshot = {
      state: provider.getState(),
      requests: [],
      events: [],
      telemetry: [],
      simulation: provider.simulation?.getStatus() ?? null,
    };

    this.unsubscribers.push(
      provider.subscribe((state) => this.onState(state)),
      provider.onEvent((e) => this.log.push(e)),
      this.commands.subscribe((requests) => this.set({ requests })),
      this.log.subscribe((events) => this.set({ events })),
    );
    if (provider.simulation) {
      this.unsubscribers.push(
        provider.simulation.subscribeStatus((simulation) => this.set({ simulation })),
      );
    }
  }

  start(): Promise<void> {
    this.log.push({
      category: "connection",
      level: "info",
      message: `Provider: ${this.provider.kind}`,
    });
    return this.provider.connect();
  }

  /** Disconnects and halts timers; `start()` may be called again afterwards. */
  stop(): Promise<void> {
    return this.provider.disconnect();
  }

  getSnapshot = (): RuntimeSnapshot => this.snapshot;

  subscribe = (listener: (snapshot: RuntimeSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  execute(command: PrinterCommand): Promise<CommandRequest> {
    return this.commands.execute(command);
  }

  validate(command: PrinterCommand): ValidationResult {
    return this.commands.validate(command);
  }

  dispose(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    this.listeners.clear();
    this.provider.dispose();
  }

  private onState(incoming: PrinterState): void {
    const prev = this.snapshot.state;
    const next = replaceEqualDeep(prev, incoming);
    if (next === prev) return;
    this.logTransitions(prev, next);

    const changed = changedPaths(prev, next).filter((p) => p !== "connection.lastTelemetryAt");
    const telemetry =
      changed.length > 0
        ? [
            ...this.snapshot.telemetry,
            { id: ++this.telemetrySeq, at: this.clock.now(), changed },
          ].slice(-this.telemetryHistory)
        : this.snapshot.telemetry;
    this.set({ state: next, telemetry });
  }

  private logTransitions(prev: PrinterState, next: PrinterState): void {
    if (prev.connection.status !== next.connection.status) {
      this.log.push({
        category: "connection",
        level: next.connection.status === "disconnected" ? "warn" : "info",
        message: `Connection ${prev.connection.status} → ${next.connection.status}${
          next.connection.lastError ? ` (${next.connection.lastError})` : ""
        }`,
      });
    }
    if (prev.status !== next.status) {
      this.log.push({
        category: "state",
        level: "info",
        message: `Print status ${prev.status} → ${next.status}`,
      });
    }
    for (const alert of next.alerts) {
      if (!prev.alerts.some((a) => a.code === alert.code)) {
        this.log.push({
          category: "alert",
          level:
            alert.severity === "error" ? "error" : alert.severity === "warning" ? "warn" : "info",
          message: `${alert.code}: ${alert.message}`,
        });
      }
    }
    for (const alert of prev.alerts) {
      if (!next.alerts.some((a) => a.code === alert.code)) {
        this.log.push({ category: "alert", level: "info", message: `Cleared ${alert.code}` });
      }
    }
  }

  private set(patch: Partial<RuntimeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l(this.snapshot);
  }
}
