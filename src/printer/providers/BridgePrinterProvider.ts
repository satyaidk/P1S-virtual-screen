import type { CommandResult, CommandType, PrinterCommand } from "../commands";
import { ConnectionManager, type ManagerStatus, type SocketFactory } from "../connection-manager";
import { bridgeServerMessageSchema, type BridgeCommandMessage } from "../protocol/bridge-protocol";
import { mergeTelemetry } from "../protocol/state-merge";
import { parseReport } from "../protocol/telemetry-parser";
import { systemClock, type Clock, type TimerHandle } from "../simulation/clock";
import { sseSocketFactory } from "../sse-socket";
import { createUnknownState } from "../state";
import type { ConnectionStatus, PrinterState } from "../types";
import { deepFreeze } from "@/lib/structural-sharing";
import {
  Emitter,
  type PrinterProvider,
  type ProviderCapabilities,
  type ProviderEvent,
} from "./PrinterProvider";

export interface BridgeProviderOptions {
  /** Base URL of the bridge endpoints (default: this app's own `/api/bridge`). Not a secret. */
  bridgeUrl: string;
  clock?: Clock;
  /** Transport; defaults to Server-Sent Events + HTTP POST. Tests inject a fake socket. */
  socketFactory?: SocketFactory;
  /** How long to wait for the bridge's command_result. */
  commandTimeoutMs?: number;
}

/**
 * Real printer data. The browser never talks MQTT to the printer and never holds credentials:
 * this app's server (src/server) owns the Bambu Cloud / LAN MQTT session and forwards reports.
 * Reports are parsed and merged here with the same protocol modules the tests cover.
 */
export class BridgePrinterProvider implements PrinterProvider {
  readonly kind = "live" as const;

  private readonly clock: Clock;
  private readonly manager: ConnectionManager;
  private readonly commandTimeoutMs: number;
  private caps: ProviderCapabilities = {
    commands: new Set(),
    unsupportedReason: "Printer not set up",
  };
  private state: PrinterState;
  private socketStatus: ManagerStatus = "idle";
  private printerLink: "connected" | "connecting" | "disconnected" = "disconnected";
  private printerError: string | null = null;
  private requestSeq = 0;
  private pending = new Map<string, { resolve: (r: CommandResult) => void; timer: TimerHandle }>();
  private readonly stateEmitter = new Emitter<PrinterState>();
  private readonly eventEmitter = new Emitter<ProviderEvent>();

  constructor(private readonly options: BridgeProviderOptions) {
    this.clock = options.clock ?? systemClock;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 12_000;
    this.state = deepFreeze(createUnknownState("live"));
    this.manager = new ConnectionManager(
      options.bridgeUrl,
      options.socketFactory ?? sseSocketFactory,
      this.clock,
      {
        onStatus: (status, detail) => this.onSocketStatus(status, detail),
        onMessage: (data) => this.onMessage(data),
      },
    );
  }

  get capabilities(): ProviderCapabilities {
    return this.caps;
  }

  async connect(): Promise<void> {
    this.event("connection", "info", "Connecting to printer bridge");
    this.manager.start();
  }

  async disconnect(): Promise<void> {
    this.manager.stop();
    this.failAllPending("Disconnected");
  }

  getState(): PrinterState {
    return this.state;
  }

  subscribe(listener: (state: PrinterState) => void): () => void {
    return this.stateEmitter.on(listener);
  }

  onEvent(listener: (event: ProviderEvent) => void): () => void {
    return this.eventEmitter.on(listener);
  }

  sendCommand(command: PrinterCommand): Promise<CommandResult> {
    if (!this.caps.commands.has(command.type)) {
      return Promise.resolve({
        ok: false,
        message: this.caps.unsupportedReason ?? "Command not supported",
      });
    }
    const requestId = `req-${++this.requestSeq}`;
    const message: BridgeCommandMessage = { type: "command", requestId, command };
    return new Promise((resolve) => {
      const timer = this.clock.setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, message: "No response from bridge" });
      }, this.commandTimeoutMs);
      this.pending.set(requestId, { resolve, timer });
      if (!this.manager.send(JSON.stringify(message))) {
        this.clock.clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({ ok: false, message: "Bridge not connected" });
      }
    });
  }

  dispose(): void {
    this.manager.stop();
    this.failAllPending("Disposed");
    this.stateEmitter.clear();
    this.eventEmitter.clear();
  }

  // --- internals -------------------------------------------------------------------------

  private onSocketStatus(status: ManagerStatus, detail?: string): void {
    this.socketStatus = status;
    if (status !== "open") {
      this.printerLink = "disconnected";
      this.failAllPending("Bridge connection lost");
    }
    if (status === "waiting")
      this.event("connection", "warn", `Bridge unavailable: ${detail ?? ""}`);
    if (status === "open") this.event("connection", "info", "Bridge connected");
    this.updateConnection(status === "waiting" ? "App server unreachable" : this.printerError);
  }

  private onMessage(raw: unknown): void {
    let json: unknown;
    try {
      json = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      this.event("protocol", "warn", "Bridge sent invalid JSON");
      return;
    }
    const parsed = bridgeServerMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.event(
        "protocol",
        "warn",
        "Unrecognized bridge message",
        parsed.error.issues.slice(0, 3),
      );
      return;
    }
    const msg = parsed.data;
    switch (msg.type) {
      case "hello": {
        this.caps = {
          commands: new Set((msg.commands ?? []) as CommandType[]),
          unsupportedReason:
            msg.readOnlyReason ??
            (msg.printer ? "Not supported by this connection" : "Printer not set up"),
        };
        const info = msg.printer
          ? {
              ...this.state.info,
              model: msg.printer.model,
              name: msg.printer.name,
              serial: msg.printer.serial,
            }
          : this.state.info;
        this.setState({ ...this.state, info: { ...info, connectionMode: msg.mode ?? null } });
        break;
      }
      case "printer_link":
        if (msg.status !== this.printerLink) {
          this.event(
            "connection",
            msg.status === "connected" ? "info" : "warn",
            `Printer ${msg.status}${msg.error ? `: ${msg.error}` : ""}`,
          );
        }
        this.printerLink = msg.status;
        this.printerError = msg.error ?? null;
        this.updateConnection(this.printerError);
        break;
      case "snapshot": {
        // Accumulated server-side state (the printer only sends changes): adopt the printer data,
        // keep this client's connection view.
        const snap = msg.state as unknown as PrinterState;
        this.setState({
          ...snap,
          source: "live",
          info: {
            ...snap.info,
            connectionMode: this.state.info.connectionMode,
            serial: this.state.info.serial,
          },
          connection: {
            ...this.state.connection,
            wifiSignalDbm: snap.connection.wifiSignalDbm,
            lastTelemetryAt: snap.connection.lastTelemetryAt,
          },
        });
        break;
      }
      case "report": {
        const result = parseReport(msg.payload);
        if (result.issues.length > 0) {
          this.event(
            "protocol",
            "warn",
            `Rejected ${result.issues.length} invalid field(s)`,
            result.issues,
          );
        }
        if (result.ack) {
          this.event(
            "command",
            result.ack.result === "success" ? "info" : "warn",
            `Printer ack ${result.ack.command}: ${result.ack.result}${result.ack.reason ? ` (${result.ack.reason})` : ""}`,
          );
        }
        if (Object.keys(result.patch).length > 0) {
          this.setState(mergeTelemetry(this.state, result.patch, this.clock.now()));
        }
        break;
      }
      case "command_result": {
        const entry = this.pending.get(msg.requestId);
        if (!entry) return;
        this.clock.clearTimeout(entry.timer);
        this.pending.delete(msg.requestId);
        entry.resolve({ ok: msg.ok, message: msg.message ?? undefined });
        break;
      }
    }
  }

  private updateConnection(error: string | null): void {
    let status: ConnectionStatus = "disconnected";
    if (this.socketStatus === "open" && this.printerLink === "connected") status = "connected";
    else if (
      this.socketStatus === "connecting" ||
      (this.socketStatus === "open" && this.printerLink === "connecting")
    ) {
      status = "connecting";
    }
    this.setState({
      ...this.state,
      connection: { ...this.state.connection, status, lastError: error },
    });
  }

  private failAllPending(reason: string): void {
    for (const [id, entry] of this.pending) {
      this.clock.clearTimeout(entry.timer);
      entry.resolve({ ok: false, message: reason });
      this.pending.delete(id);
    }
  }

  private setState(next: PrinterState): void {
    this.state = deepFreeze(next);
    this.stateEmitter.emit(this.state);
  }

  private event(
    category: ProviderEvent["category"],
    level: ProviderEvent["level"],
    message: string,
    data?: unknown,
  ): void {
    this.eventEmitter.emit({ category, level, message, data });
  }
}
