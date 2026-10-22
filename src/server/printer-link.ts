import "server-only";
import { randomBytes } from "node:crypto";
import type { CommandType, PrinterCommand } from "@/printer/commands";
import { buildBambuRequest, LAN_SUPPORTED_COMMANDS } from "@/printer/protocol/command-builders";
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeServerMessage,
  type LinkMode,
} from "@/printer/protocol/bridge-protocol";
import { reportTopic, requestTopic } from "@/printer/protocol/mqtt-types";
import { mergeTelemetry } from "@/printer/protocol/state-merge";
import { parseReport } from "@/printer/protocol/telemetry-parser";
import { createUnknownState } from "@/printer/state";
import type { PrinterState } from "@/printer/types";

/**
 * Owns one MQTT session with one printer (cloud broker or the printer's own broker on the LAN),
 * keeps the merged state, and fans messages out to browser subscribers.
 */

export interface LinkConfig {
  mode: LinkMode;
  serial: string;
  name: string;
  model: string;
  url: string;
  username: string;
  password: string;
  tls: { ca?: string; servername?: string; rejectUnauthorized: boolean };
}

/** The subset of mqtt.js's client used here (lets tests inject a fake). */
export interface MqttClientLike {
  on(event: "connect", cb: () => void): unknown;
  on(event: "message", cb: (topic: string, payload: Buffer) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  on(event: "close" | "offline" | "reconnect", cb: () => void): unknown;
  subscribe(topic: string, opts: { qos: 0 | 1 }, cb?: (err?: Error | null) => void): unknown;
  publish(
    topic: string,
    payload: string,
    opts: { qos: 0 | 1 },
    cb?: (err?: Error) => void,
  ): unknown;
  end(force?: boolean, cb?: () => void): unknown;
}

export type MqttConnect = (url: string, options: Record<string, unknown>) => MqttClientLike;

export type LinkStatus = "connected" | "connecting" | "disconnected";

export const CLOUD_READ_ONLY_REASON =
  "Read-only via Bambu Cloud — use LAN + Developer Mode to control";

/** Over the cloud, only status requests are accepted without Bambu's signed-command scheme. */
const CLOUD_COMMANDS: ReadonlySet<CommandType> = new Set<CommandType>(["request_full_status"]);

/** P1 firmware lags when `pushall` is sent too often (OpenBambuAPI). */
const PUSHALL_MIN_INTERVAL_MS = 60_000;

export interface PrinterLinkOptions {
  connect: MqttConnect;
  now?: () => number;
  ackTimeoutMs?: number;
}

type Listener = (msg: BridgeServerMessage) => void;

export class PrinterLink {
  private client: MqttClientLike | null = null;
  private config: LinkConfig | null = null;
  private status: LinkStatus = "disconnected";
  private error: string | null = "Not connected yet — enter the access code on the console";
  private state: PrinterState = createUnknownState("live");
  private listeners = new Set<Listener>();
  private seq = Math.floor(Math.random() * 10_000);
  private pending = new Map<
    string,
    { resolve: (r: { ok: boolean; message: string | null }) => void; timer: NodeJS.Timeout }
  >();
  private lastPushAll = 0;
  private readonly now: () => number;
  private readonly ackTimeoutMs: number;

  constructor(private readonly options: PrinterLinkOptions) {
    this.now = options.now ?? Date.now;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 4000;
  }

  get current(): {
    config: Omit<LinkConfig, "password" | "username"> | null;
    status: LinkStatus;
    error: string | null;
  } {
    if (!this.config) return { config: null, status: this.status, error: this.error };
    const { password: _p, username: _u, ...rest } = this.config;
    void _p;
    void _u;
    return { config: rest, status: this.status, error: this.error };
  }

  supportedCommands(): ReadonlySet<CommandType> {
    if (!this.config) return new Set();
    return this.config.mode === "cloud" ? CLOUD_COMMANDS : LAN_SUPPORTED_COMMANDS;
  }

  start(config: LinkConfig, options: { requestFullStatus?: boolean } = {}): void {
    this.stop(null);
    this.config = config;
    this.state = createUnknownState("live", config.name);
    this.setStatus("connecting", null);
    this.broadcast(this.hello());

    const client = this.options.connect(config.url, {
      username: config.username,
      password: config.password,
      clientId: `p1s-vs-${randomBytes(4).toString("hex")}`,
      protocolVersion: 4,
      keepalive: 60,
      reconnectPeriod: 5000,
      connectTimeout: 15_000,
      clean: true,
      ...config.tls,
    });
    this.client = client;

    client.on("connect", () => {
      if (this.client !== client) return;
      this.setStatus("connected", null);
      client.subscribe(reportTopic(config.serial), { qos: 0 }, (err) => {
        if (err) this.setStatus("disconnected", `Subscribe failed: ${err.message}`);
      });
      this.publishRaw({ info: { sequence_id: this.nextSeq(), command: "get_version" } });
      if (options.requestFullStatus !== false) this.requestFullStatus(true);
    });
    client.on("message", (_topic, payload) => {
      if (this.client === client) this.onReport(payload);
    });
    client.on("error", (err) => {
      if (this.client === client)
        this.setStatus("disconnected", describeMqttError(err, config.mode));
    });
    client.on("close", () => {
      if (this.client === client && this.status !== "disconnected")
        this.setStatus("disconnected", this.error ?? "Connection closed");
    });
    client.on("reconnect", () => {
      if (this.client === client) this.setStatus("connecting", this.error);
    });
  }

  stop(reason: string | null = "Disconnected"): void {
    const client = this.client;
    this.client = null;
    if (client) client.end(true);
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, message: "Connection closed" });
      this.pending.delete(id);
    }
    if (reason !== null) {
      this.config = null;
      this.setStatus("disconnected", reason);
      this.broadcast(this.hello());
    }
  }

  /** Subscribe a browser stream. It immediately receives hello, link status and a snapshot. */
  subscribe(listener: Listener): () => void {
    listener(this.hello());
    listener({ type: "printer_link", status: this.status, error: this.error });
    if (this.state.connection.lastTelemetryAt !== null)
      listener({ type: "snapshot", state: this.state });
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async command(command: PrinterCommand): Promise<{ ok: boolean; message: string | null }> {
    if (!this.config || !this.client || this.status !== "connected") {
      return { ok: false, message: "Printer is not connected" };
    }
    if (!this.supportedCommands().has(command.type)) {
      return {
        ok: false,
        message: this.config.mode === "cloud" ? CLOUD_READ_ONLY_REASON : "Command not supported",
      };
    }
    if (command.type === "stop" && (command as { confirmed?: unknown }).confirmed !== true) {
      return { ok: false, message: "Stop requires confirmation" };
    }
    if (command.type === "request_full_status") {
      return this.requestFullStatus(false)
        ? { ok: true, message: null }
        : { ok: true, message: "Full status was requested recently; using live updates" };
    }

    const seq = this.nextSeq();
    let request;
    try {
      request = buildBambuRequest(command, seq);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Invalid command" };
    }
    return new Promise((resolve) => {
      // No explicit reply within the window is not a failure: the command manager still waits for
      // the state change before reporting success.
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        resolve({ ok: true, message: "Sent; no acknowledgement from printer" });
      }, this.ackTimeoutMs);
      this.pending.set(seq, { resolve, timer });
      this.client?.publish(
        requestTopic(this.config!.serial),
        JSON.stringify(request.payload),
        { qos: request.qos },
        (err) => {
          if (!err) return;
          clearTimeout(timer);
          this.pending.delete(seq);
          resolve({ ok: false, message: `Publish failed: ${err.message}` });
        },
      );
    });
  }

  // --- internals -------------------------------------------------------------------------

  private requestFullStatus(force: boolean): boolean {
    const now = this.now();
    if (!force && now - this.lastPushAll < PUSHALL_MIN_INTERVAL_MS) return false;
    this.lastPushAll = now;
    this.publishRaw({
      pushing: { sequence_id: this.nextSeq(), command: "pushall", version: 1, push_target: 1 },
    });
    return true;
  }

  private publishRaw(payload: unknown): void {
    if (!this.client || !this.config) return;
    this.client.publish(requestTopic(this.config.serial), JSON.stringify(payload), { qos: 0 });
  }

  private onReport(buffer: Buffer): void {
    let json: unknown;
    try {
      json = JSON.parse(buffer.toString("utf8"));
    } catch {
      return;
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) return;
    const result = parseReport(json);

    if (result.ack?.sequenceId) {
      const pending = this.pending.get(result.ack.sequenceId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(result.ack.sequenceId);
        const ok = result.ack.result === "success";
        pending.resolve({
          ok,
          message: ok ? null : (result.ack.reason ?? `Printer replied "${result.ack.result}"`),
        });
      }
    }
    if (Object.keys(result.patch).length > 0) {
      this.state = mergeTelemetry(this.state, result.patch, this.now());
    }
    this.broadcast({ type: "report", payload: json as Record<string, unknown> });
  }

  private hello(): BridgeServerMessage {
    const c = this.config;
    return {
      type: "hello",
      protocol: BRIDGE_PROTOCOL_VERSION,
      printer: c ? { model: c.model, name: c.name, serial: maskSerial(c.serial) } : null,
      mode: c?.mode ?? null,
      commands: [...this.supportedCommands()],
      readOnlyReason: c?.mode === "cloud" ? CLOUD_READ_ONLY_REASON : null,
    };
  }

  private setStatus(status: LinkStatus, error: string | null): void {
    const changed = status !== this.status || error !== this.error;
    this.status = status;
    this.error = error;
    if (changed) this.broadcast({ type: "printer_link", status, error });
  }

  private broadcast(msg: BridgeServerMessage): void {
    for (const l of [...this.listeners]) {
      try {
        l(msg);
      } catch {
        this.listeners.delete(l);
      }
    }
  }

  private nextSeq(): string {
    this.seq = (this.seq + 1) % 1_000_000_000;
    return String(this.seq);
  }
}

function maskSerial(serial: string): string {
  return `${"•".repeat(Math.max(0, serial.length - 4))}${serial.slice(-4)}`;
}

export function describeMqttError(err: Error, mode: LinkMode): string {
  const msg = err.message || String(err);
  if (/not authorized|bad user name or password|connack.*(4|5)/i.test(msg)) {
    return mode === "cloud"
      ? "Bambu Cloud rejected the login — sign in again"
      : "Printer rejected the access code — check it on the printer screen (Settings → Network)";
  }
  if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|timeout/i.test(msg)) {
    return mode === "cloud"
      ? "Cannot reach Bambu Cloud MQTT"
      : "Cannot reach the printer on the LAN — check the IP address";
  }
  if (/certificate|self.signed|altname/i.test(msg)) return `TLS verification failed: ${msg}`;
  return msg;
}
