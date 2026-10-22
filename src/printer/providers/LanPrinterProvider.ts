import type { CommandResult, PrinterCommand } from "../commands";
import { ConnectionManager, type ManagerStatus, type SocketFactory } from "../connection-manager";
import { LAN_SUPPORTED_COMMANDS } from "../protocol/command-builders";
import { bridgeServerMessageSchema, type BridgeCommandMessage } from "../protocol/bridge-protocol";
import { mergeTelemetry } from "../protocol/state-merge";
import { parseReport } from "../protocol/telemetry-parser";
import { systemClock, type Clock, type TimerHandle } from "../simulation/clock";
import { createUnknownState } from "../state";
import type { ConnectionStatus, PrinterState } from "../types";
import { deepFreeze } from "@/lib/structural-sharing";
import {
  Emitter,
  type PrinterProvider,
  type ProviderCapabilities,
  type ProviderEvent,
} from "./PrinterProvider";

export interface LanProviderOptions {
  /** WebSocket URL of the local bridge, e.g. ws://127.0.0.1:8787/v1/stream. Not a secret. */
  bridgeUrl: string;
  clock?: Clock;
  socketFactory?: SocketFactory;
  /** How long to wait for the bridge's command_result. */
  commandTimeoutMs?: number;
}

/**
 * Adapter for a real P1S reached through a local bridge (docs/bridge-api.md).
 *
 * The browser never talks MQTT/TLS to the printer and never holds the LAN access code. The bridge
 * forwards raw reports; this provider parses and merges them with the same protocol modules the
 * tests cover.
 *
 * STATUS: implemented against the documented contract and unit-tested with a fake socket. It has
 * NOT been verified against a physical P1S.
 */
export class LanPrinterProvider implements PrinterProvider {
  readonly kind = "lan-bridge" as const;
  readonly capabilities: ProviderCapabilities = { commands: LAN_SUPPORTED_COMMANDS };

  private readonly clock: Clock;
  private readonly manager: ConnectionManager;
  private readonly commandTimeoutMs: number;
  private state: PrinterState;
  private socketStatus: ManagerStatus = "idle";
  private printerLink: "connected" | "connecting" | "disconnected" = "disconnected";
  private requestSeq = 0;
  private pending = new Map<string, { resolve: (r: CommandResult) => void; timer: TimerHandle }>();
  private readonly stateEmitter = new Emitter<PrinterState>();
  private readonly eventEmitter = new Emitter<ProviderEvent>();

  constructor(private readonly options: LanProviderOptions) {
    this.clock = options.clock ?? systemClock;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 8000;
    this.state = deepFreeze(createUnknownState("lan-bridge"));
    const factory: SocketFactory =
      options.socketFactory ??
      ((url) => new WebSocket(url) as unknown as ReturnType<SocketFactory>);
    this.manager = new ConnectionManager(options.bridgeUrl, factory, this.clock, {
      onStatus: (status, detail) => this.onSocketStatus(status, detail),
      onMessage: (data) => this.onMessage(data),
    });
  }

  async connect(): Promise<void> {
    this.event("connection", "info", `Connecting to bridge ${this.options.bridgeUrl}`);
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
    if (!LAN_SUPPORTED_COMMANDS.has(command.type)) {
      return Promise.resolve({ ok: false, message: "Command not supported over LAN" });
    }
    const requestId = `req-${++this.requestSeq}`;
    const message: BridgeCommandMessage = { type: "command", requestId, command };
    if (!this.manager.send(JSON.stringify(message))) {
      return Promise.resolve({ ok: false, message: "Bridge not connected" });
    }
    return new Promise((resolve) => {
      const timer = this.clock.setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, message: "No response from bridge" });
      }, this.commandTimeoutMs);
      this.pending.set(requestId, { resolve, timer });
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
    this.updateConnection(status === "waiting" ? (detail ?? "Bridge unavailable") : null);
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
      case "hello":
        this.setState({
          ...this.state,
          info: {
            ...this.state.info,
            model: msg.printer.model,
            name: msg.printer.name,
            serial: msg.printer.serial,
          },
        });
        break;
      case "printer_link": {
        const wasConnected = this.printerLink === "connected";
        this.printerLink = msg.status;
        this.event(
          "connection",
          msg.status === "connected" ? "info" : "warn",
          `Printer MQTT ${msg.status}`,
        );
        this.updateConnection(msg.error ?? null);
        // P1 printers send partial reports; ask once for a full snapshot after (re)connecting.
        if (msg.status === "connected" && !wasConnected)
          void this.sendCommand({ type: "request_full_status" });
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
