import type { CommandResult, CommandType, PrinterCommand } from "../commands";
import { DEFAULT_SCENARIO_ID } from "../simulation/scenarios";
import { SimulationEngine, type SimFault } from "../simulation/simulation-engine";
import { systemClock, type Clock, type TimerHandle } from "../simulation/clock";
import { createUnknownState } from "../state";
import type { PrinterState } from "../types";
import { deepFreeze } from "@/lib/structural-sharing";
import {
  Emitter,
  type PrinterProvider,
  type ProviderCapabilities,
  type ProviderEvent,
} from "./PrinterProvider";

export interface SimulationStatus {
  scenarioId: string;
  running: boolean;
  speedMultiplier: number;
  simulatedTimeMs: number;
  wifiUp: boolean;
  mqttUp: boolean;
  telemetryFrozen: boolean;
}

/** Development controls; they drive the same engine whose state the display renders. */
export interface SimulationControls {
  getStatus(): SimulationStatus;
  subscribeStatus(listener: (status: SimulationStatus) => void): () => void;
  loadScenario(id: string): void;
  reset(): void;
  setRunning(running: boolean): void;
  setSpeedMultiplier(multiplier: number): void;
  /** Advance by a fixed amount of simulated time, regardless of `running`. */
  stepBy(simulatedMs: number): void;
  completeJob(): boolean;
  injectFault(fault: SimFault): boolean;
  clearAlerts(): void;
  setWifi(up: boolean): void;
  setMqtt(up: boolean): void;
  setTelemetryFrozen(frozen: boolean): void;
  restoreConnectivity(): void;
}

export interface SimulatedProviderOptions {
  clock?: Clock;
  scenarioId?: string;
  /** Real-time interval of the update loop. */
  tickMs?: number;
  speedMultiplier?: number;
  /** Simulated command round-trip latency (real ms). */
  commandLatencyMs?: number;
  /** Time spent in "connecting" before the link is up (real ms). */
  connectDelayMs?: number;
  /** Start the update loop automatically on connect (disable for step-driven tests). */
  autoRun?: boolean;
}

const SIM_COMMANDS: ReadonlySet<CommandType> = new Set<CommandType>([
  "pause",
  "resume",
  "stop",
  "set_speed",
  "set_nozzle_target",
  "set_bed_target",
  "set_chamber_light",
  "set_fan",
  "move_axis",
  "home_axes",
  "extrude",
  "request_full_status",
  "start_sample_job",
]);

export class SimulatedPrinterProvider implements PrinterProvider {
  readonly kind = "simulated" as const;
  readonly capabilities: ProviderCapabilities = { commands: SIM_COMMANDS };
  readonly simulation: SimulationControls;

  private readonly clock: Clock;
  private readonly engine: SimulationEngine;
  private readonly tickMs: number;
  private readonly commandLatencyMs: number;
  private readonly connectDelayMs: number;
  private readonly autoRun: boolean;

  private state: PrinterState;
  private wanted = false;
  private linkStatus: "down" | "connecting" | "up" = "down";
  private wifiUp = true;
  private mqttUp = true;
  private telemetryFrozen = false;
  private running: boolean;
  private speedMultiplier: number;
  private ticker: TimerHandle | null = null;
  private connectTimer: TimerHandle | null = null;
  private disposed = false;

  private readonly stateEmitter = new Emitter<PrinterState>();
  private readonly eventEmitter = new Emitter<ProviderEvent>();
  private readonly statusEmitter = new Emitter<SimulationStatus>();

  constructor(options: SimulatedProviderOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.engine = new SimulationEngine(options.scenarioId ?? DEFAULT_SCENARIO_ID);
    this.tickMs = options.tickMs ?? 250;
    this.commandLatencyMs = options.commandLatencyMs ?? 350;
    this.connectDelayMs = options.connectDelayMs ?? 900;
    this.autoRun = options.autoRun ?? true;
    this.running = this.autoRun;
    this.speedMultiplier = options.speedMultiplier ?? 10;
    this.state = deepFreeze(createUnknownState("simulated"));
    this.simulation = this.createControls();
  }

  async connect(): Promise<void> {
    this.wanted = true;
    this.event("connection", "info", "Connecting to simulated printer");
    this.startLink();
    if (this.ticker === null) this.ticker = this.clock.setInterval(() => this.tick(), this.tickMs);
  }

  async disconnect(): Promise<void> {
    this.wanted = false;
    this.cancelConnect();
    if (this.ticker !== null) this.clock.clearInterval(this.ticker);
    this.ticker = null;
    this.linkStatus = "down";
    this.publishConnectionOnly("Disconnected by user");
    this.event("connection", "info", "Disconnected");
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
    if (this.linkStatus !== "up")
      return Promise.resolve({ ok: false, message: "Printer is offline" });
    return new Promise((resolve) => {
      this.clock.setTimeout(() => {
        if (this.linkStatus !== "up") {
          // The link dropped in flight: no acknowledgement will arrive.
          return;
        }
        const result = this.engine.apply(command);
        this.publish();
        resolve(result);
      }, this.commandLatencyMs);
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.ticker !== null) this.clock.clearInterval(this.ticker);
    this.ticker = null;
    this.cancelConnect();
    this.stateEmitter.clear();
    this.eventEmitter.clear();
    this.statusEmitter.clear();
  }

  // --- internals -------------------------------------------------------------------------

  private tick(): void {
    if (this.disposed) return;
    if (this.running && this.speedMultiplier > 0) {
      this.engine.step(this.tickMs * this.speedMultiplier);
      this.emitStatus();
    }
    this.publish();
  }

  private startLink(): void {
    this.cancelConnect();
    if (!this.wanted) return;
    if (!this.wifiUp || !this.mqttUp) {
      this.linkStatus = "down";
      this.publishConnectionOnly(this.linkError());
      return;
    }
    this.linkStatus = "connecting";
    this.publishConnectionOnly(null);
    this.connectTimer = this.clock.setTimeout(() => {
      this.connectTimer = null;
      this.linkStatus = "up";
      this.event("connection", "info", "Connected (simulated MQTT)");
      this.publish(true);
    }, this.connectDelayMs);
  }

  private cancelConnect(): void {
    if (this.connectTimer !== null) this.clock.clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private linkError(): string {
    if (!this.wifiUp) return "Wi-Fi unavailable";
    if (!this.mqttUp) return "MQTT broker unreachable";
    return "Disconnected";
  }

  /** Publish a full telemetry snapshot, unless the link is down or telemetry is frozen. */
  private publish(force = false): void {
    if (this.linkStatus !== "up") return;
    if (this.telemetryFrozen && !force) return;
    const snap = this.engine.snapshot();
    const { wifiSignalDbm, ...rest } = snap;
    this.setState({
      ...rest,
      source: "simulated",
      connection: {
        status: "connected",
        wifiSignalDbm,
        lastTelemetryAt: this.clock.now(),
        lastError: null,
      },
    });
  }

  private publishConnectionOnly(error: string | null): void {
    const status = this.linkStatus === "connecting" ? "connecting" : "disconnected";
    this.setState({
      ...this.state,
      connection: { ...this.state.connection, status, lastError: error },
    });
  }

  private setState(next: PrinterState): void {
    this.state = deepFreeze(next);
    this.stateEmitter.emit(this.state);
  }

  private event(
    category: ProviderEvent["category"],
    level: ProviderEvent["level"],
    message: string,
  ): void {
    this.eventEmitter.emit({ category, level, message });
  }

  private status(): SimulationStatus {
    return {
      scenarioId: this.engine.scenarioId,
      running: this.running,
      speedMultiplier: this.speedMultiplier,
      simulatedTimeMs: this.engine.simulatedTimeMs,
      wifiUp: this.wifiUp,
      mqttUp: this.mqttUp,
      telemetryFrozen: this.telemetryFrozen,
    };
  }

  private emitStatus(): void {
    this.statusEmitter.emit(this.status());
  }

  private setLink(kind: "wifi" | "mqtt", up: boolean): void {
    const before = kind === "wifi" ? this.wifiUp : this.mqttUp;
    if (before === up) return;
    if (kind === "wifi") this.wifiUp = up;
    else this.mqttUp = up;
    const label = kind === "wifi" ? "Wi-Fi" : "MQTT";
    this.event(
      "simulation",
      up ? "info" : "warn",
      `${label} ${up ? "restored" : "dropped"} (simulated)`,
    );
    if (!up) {
      this.cancelConnect();
      this.linkStatus = "down";
      if (this.wanted) this.publishConnectionOnly(this.linkError());
    } else if (this.wanted && this.wifiUp && this.mqttUp && this.linkStatus !== "up") {
      this.startLink();
    }
    this.emitStatus();
  }

  private createControls(): SimulationControls {
    return {
      getStatus: () => this.status(),
      subscribeStatus: (listener) => this.statusEmitter.on(listener),
      loadScenario: (id) => {
        this.engine.load(id);
        this.event("simulation", "info", `Scenario loaded: ${id}`);
        this.publish(true);
        this.emitStatus();
      },
      reset: () => {
        this.engine.load(this.engine.scenarioId);
        this.wifiUp = true;
        this.mqttUp = true;
        this.telemetryFrozen = false;
        this.event("simulation", "info", "Simulation reset");
        if (this.wanted && this.linkStatus !== "up") this.startLink();
        this.publish(true);
        this.emitStatus();
      },
      setRunning: (running) => {
        this.running = running;
        this.event("simulation", "info", running ? "Simulation running" : "Simulation paused");
        this.emitStatus();
      },
      setSpeedMultiplier: (multiplier) => {
        this.speedMultiplier = Math.max(0, multiplier);
        this.emitStatus();
      },
      stepBy: (ms) => {
        this.engine.step(ms);
        this.publish();
        this.emitStatus();
      },
      completeJob: () => {
        const done = this.engine.completeJob();
        if (done) this.event("simulation", "info", "Job forced to completion");
        this.publish(true);
        return done;
      },
      injectFault: (fault) => {
        const applied = this.engine.injectFault(fault, this.clock.now());
        this.event(
          "simulation",
          applied ? "warn" : "info",
          applied ? `Fault injected: ${fault}` : `Fault not applicable now: ${fault}`,
        );
        this.publish(true);
        return applied;
      },
      clearAlerts: () => {
        this.engine.clearAlerts();
        this.publish(true);
      },
      setWifi: (up) => this.setLink("wifi", up),
      setMqtt: (up) => this.setLink("mqtt", up),
      setTelemetryFrozen: (frozen) => {
        this.telemetryFrozen = frozen;
        this.event(
          "simulation",
          frozen ? "warn" : "info",
          frozen ? "Telemetry frozen (simulated)" : "Telemetry resumed",
        );
        if (!frozen) this.publish(true);
        this.emitStatus();
      },
      restoreConnectivity: () => {
        this.setLink("wifi", true);
        this.setLink("mqtt", true);
        if (this.telemetryFrozen) this.simulation.setTelemetryFrozen(false);
      },
    };
  }
}
