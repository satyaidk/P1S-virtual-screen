import type { CommandResult, PrinterCommand } from "../commands";
import { PRINT_ERROR_USER_CANCELLED, STAGE_LABELS } from "../protocol/mqtt-types";
import { speedPreset } from "../state";
import { MIN_EXTRUDE_C } from "../state";
import type {
  ActiveFilament,
  ControllableFan,
  FanState,
  AmsState,
  AlertSeverity,
  PrinterAlert,
  PrinterState,
  PrintStatus,
  SpeedLevel,
  Temperature,
} from "../types";
import { getScenario, type Scenario, type SimJobDefinition } from "./scenarios";

/**
 * Deterministic model of a P1S + AMS.
 *
 * The engine has no timers of its own: callers advance it with `step(dtMs)`. It models the
 * *printer*, which keeps printing when the network drops; whether telemetry reaches the display is
 * the provider's concern. No randomness is used, so identical step sequences give identical states.
 */

export type SimFault =
  | "filament_runout"
  | "nozzle_heater_fault"
  | "ams_humidity_warning"
  | "reject_next_command"
  | "ignore_next_command";

export const SIM_FAULTS: readonly { id: SimFault; label: string }[] = [
  { id: "filament_runout", label: "Filament runout (pauses print)" },
  { id: "nozzle_heater_fault", label: "Nozzle heater fault (fails print)" },
  { id: "ams_humidity_warning", label: "AMS humidity warning" },
  { id: "reject_next_command", label: "Printer rejects next command" },
  { id: "ignore_next_command", label: "Printer ignores next command" },
];

const AT_TEMP_TOLERANCE_C = 2;
const STAGE_BED_PREHEAT = 2;
const STAGE_LEVELING = 1;
const STAGE_HOTEND = 7;
const STAGE_PRINTING = 0;
const STAGE_FILAMENT_RUNOUT = 6;
const STAGE_PAUSED_USER = 16;

interface ThermalModel {
  heatTauS: number;
  coolTauS: number;
}

const NOZZLE_THERMAL: ThermalModel = { heatTauS: 10, coolTauS: 45 };
const BED_THERMAL: ThermalModel = { heatTauS: 45, coolTauS: 240 };

interface ActiveJob {
  def: SimJobDefinition;
  /** Seconds of work done, measured at 100% speed. */
  workSeconds: number;
  /** Seconds spent in the printing state (excludes pauses and preparation). */
  printSeconds: number;
  levelingSeconds: number;
  startedAtSim: number;
}

export interface EngineSnapshotOptions {
  /** Wall-clock time used for alert timestamps and telemetry freshness. */
  now: number;
}

export class SimulationEngine {
  private scenario!: Scenario;
  private simTimeMs = 0;
  private status: PrintStatus = "idle";
  private stageId: number | null = null;
  private job: ActiveJob | null = null;
  private lastJobName: string | null = null;
  private nozzle: Temperature = { current: 0, target: 0 };
  private bed: Temperature = { current: 0, target: 0 };
  private speedLevel: SpeedLevel = 2;
  private chamberLight = true;
  /** Manual fan overrides (percent); null = firmware/G-code controls the fan. */
  private fanOverride: Record<ControllableFan, number | null> = {
    part: null,
    aux: null,
    chamber: null,
  };
  private ams!: AmsState;
  private alerts: PrinterAlert[] = [];
  private printErrorCode = 0;
  private pendingCommandFault: "reject" | "ignore" | null = null;
  private alertSeq = 0;

  constructor(scenarioId = "standard") {
    this.load(scenarioId);
  }

  get scenarioId(): string {
    return this.scenario.id;
  }

  get simulatedTimeMs(): number {
    return this.simTimeMs;
  }

  load(scenarioId: string): void {
    const scenario = getScenario(scenarioId);
    this.scenario = scenario;
    this.simTimeMs = 0;
    this.status = "idle";
    this.stageId = null;
    this.job = null;
    this.lastJobName = null;
    this.nozzle = { current: scenario.ambientC, target: 0 };
    this.bed = { current: scenario.ambientC, target: 0 };
    this.speedLevel = 2;
    this.chamberLight = true;
    this.fanOverride = { part: null, aux: null, chamber: null };
    this.ams = structuredClone({
      units: scenario.amsUnits,
      externalSpool: scenario.externalSpool,
      active: scenario.initialFilament,
    });
    this.alerts = [];
    this.printErrorCode = 0;
    this.pendingCommandFault = null;

    if (scenario.startPrintingAt !== undefined) {
      this.beginJob();
      const job = this.job as ActiveJob | null;
      if (job) {
        job.workSeconds = job.def.durationSeconds * scenario.startPrintingAt;
        job.printSeconds = job.workSeconds;
      }
      this.nozzle.current = scenario.job.nozzleTarget;
      this.bed.current = scenario.job.bedTarget;
      this.status = "printing";
      this.stageId = STAGE_PRINTING;
    }
  }

  /** Advance the model by `dtMs` of simulated time. */
  step(dtMs: number): void {
    if (dtMs <= 0) return;
    // Integrate in bounded sub-steps so large simulation speeds stay stable and deterministic.
    const maxSub = 1000;
    let remaining = dtMs;
    while (remaining > 0) {
      const sub = Math.min(maxSub, remaining);
      this.integrate(sub / 1000);
      remaining -= sub;
    }
  }

  private integrate(dt: number): void {
    this.simTimeMs += dt * 1000;
    this.nozzle.current = approach(this.nozzle, this.scenario.ambientC, NOZZLE_THERMAL, dt);
    this.bed.current = approach(this.bed, this.scenario.ambientC, BED_THERMAL, dt);

    const job = this.job;
    if (!job) return;

    if (this.status === "preparing") {
      if (this.stageId === STAGE_BED_PREHEAT && atTarget(this.bed)) {
        this.stageId = STAGE_LEVELING;
      } else if (this.stageId === STAGE_LEVELING) {
        job.levelingSeconds += dt;
        if (job.levelingSeconds >= job.def.levelingSeconds) this.stageId = STAGE_HOTEND;
      } else if (this.stageId === STAGE_HOTEND && atTarget(this.nozzle)) {
        this.status = "printing";
        this.stageId = STAGE_PRINTING;
      }
      return;
    }

    if (this.status !== "printing") return;

    const rate = (speedPreset(this.speedLevel)?.percent ?? 100) / 100;
    const before = job.workSeconds;
    job.workSeconds = Math.min(job.def.durationSeconds, job.workSeconds + dt * rate);
    job.printSeconds += dt;
    this.consumeFilament(job, (job.workSeconds - before) / job.def.durationSeconds);

    if (job.workSeconds >= job.def.durationSeconds) {
      this.status = "finished";
      this.stageId = null;
      this.nozzle.target = 0;
      this.bed.target = 0;
    }
  }

  private consumeFilament(job: ActiveJob, fraction: number): void {
    const tray = this.trayFor(job.def.filament);
    if (!tray || tray.remainPercent === null) return;
    tray.remainPercent = Math.max(0, tray.remainPercent - fraction * job.def.filamentUsagePercent);
  }

  private trayFor(filament: ActiveFilament) {
    if (filament.kind === "external") return this.ams.externalSpool;
    if (filament.kind !== "ams") return null;
    return (
      this.ams.units
        ?.find((u) => u.id === filament.unit)
        ?.trays.find((t) => t.slot === filament.slot) ?? null
    );
  }

  private beginJob(): void {
    const def = this.scenario.job;
    this.job = {
      def,
      workSeconds: 0,
      printSeconds: 0,
      levelingSeconds: 0,
      startedAtSim: this.simTimeMs,
    };
    this.lastJobName = def.name;
    this.status = "preparing";
    this.stageId = STAGE_BED_PREHEAT;
    this.nozzle.target = def.nozzleTarget;
    this.bed.target = def.bedTarget;
    this.ams.active = def.filament;
    this.printErrorCode = 0;
    this.alerts = this.alerts.filter((a) => a.severity !== "error");
  }

  /** Apply a command as the printer firmware would. */
  apply(command: PrinterCommand): CommandResult {
    if (this.pendingCommandFault) {
      const fault = this.pendingCommandFault;
      this.pendingCommandFault = null;
      if (fault === "reject")
        return { ok: false, message: "Printer rejected the command (simulated)" };
      return { ok: true, message: "Acknowledged, but the printer did not act (simulated)" };
    }

    switch (command.type) {
      case "start_sample_job":
        if (this.status === "preparing" || this.status === "printing" || this.status === "paused") {
          return { ok: false, message: "Printer is busy" };
        }
        this.beginJob();
        return { ok: true };
      case "pause":
        if (this.status !== "printing") return { ok: false, message: "Not printing" };
        this.status = "paused";
        this.stageId = STAGE_PAUSED_USER;
        return { ok: true };
      case "resume":
        if (this.status !== "paused") return { ok: false, message: "Not paused" };
        this.status = "printing";
        this.stageId = STAGE_PRINTING;
        this.alerts = this.alerts.filter((a) => a.code !== "SIM_FILAMENT_RUNOUT");
        return { ok: true };
      case "stop":
        if (command.confirmed !== true) return { ok: false, message: "Unconfirmed stop ignored" };
        if (
          !this.job ||
          this.status === "finished" ||
          this.status === "failed" ||
          this.status === "idle"
        ) {
          return { ok: false, message: "No active print" };
        }
        this.endJob("failed");
        // The real printer reports this print_error value after a user cancel.
        this.printErrorCode = PRINT_ERROR_USER_CANCELLED;
        return { ok: true };
      case "set_speed":
        this.speedLevel = command.level;
        return { ok: true };
      case "set_nozzle_target":
        this.nozzle.target = command.celsius;
        return { ok: true };
      case "set_bed_target":
        this.bed.target = command.celsius;
        return { ok: true };
      case "set_chamber_light":
        this.chamberLight = command.on;
        return { ok: true };
      case "set_fan":
        this.fanOverride[command.fan] = command.percent;
        return { ok: true };
      case "move_axis":
      case "home_axes":
        if (this.status === "preparing" || this.status === "printing" || this.status === "paused")
          return { ok: false, message: "Printer is busy" };
        return { ok: true };
      case "extrude":
        if ((this.nozzle.current ?? 0) < MIN_EXTRUDE_C)
          return { ok: false, message: "Nozzle too cold to extrude" };
        return { ok: true };
      case "request_full_status":
        return { ok: true };
    }
  }

  private endJob(status: "failed" | "finished"): void {
    this.status = status;
    this.stageId = null;
    this.nozzle.target = 0;
    this.bed.target = 0;
  }

  /** Development-console control: jump the current print to completion. */
  completeJob(): boolean {
    const job = this.job;
    if (
      !job ||
      (this.status !== "printing" && this.status !== "paused" && this.status !== "preparing")
    ) {
      return false;
    }
    job.printSeconds += Math.max(
      0,
      (job.def.durationSeconds - job.workSeconds) /
        ((speedPreset(this.speedLevel)?.percent ?? 100) / 100),
    );
    this.consumeFilament(
      job,
      (job.def.durationSeconds - job.workSeconds) / job.def.durationSeconds,
    );
    job.workSeconds = job.def.durationSeconds;
    this.endJob("finished");
    return true;
  }

  injectFault(fault: SimFault, now: number): boolean {
    switch (fault) {
      case "filament_runout":
        if (this.status !== "printing") return false;
        this.status = "paused";
        this.stageId = STAGE_FILAMENT_RUNOUT;
        this.raise(
          "warning",
          "SIM_FILAMENT_RUNOUT",
          "Filament ran out. Load filament, then resume.",
          now,
        );
        return true;
      case "nozzle_heater_fault":
        this.raise("error", "SIM_NOZZLE_HEATER", "Nozzle heater malfunction. Print stopped.", now);
        if (
          this.job &&
          (this.status === "printing" || this.status === "paused" || this.status === "preparing")
        ) {
          this.endJob("failed");
        } else {
          this.nozzle.target = 0;
        }
        return true;
      case "ams_humidity_warning":
        if (!this.ams.units?.length) return false;
        this.raise("warning", "SIM_AMS_HUMIDITY", "AMS humidity is high. Replace desiccant.", now);
        return true;
      case "reject_next_command":
        this.pendingCommandFault = "reject";
        return true;
      case "ignore_next_command":
        this.pendingCommandFault = "ignore";
        return true;
    }
  }

  clearAlerts(): void {
    this.alerts = [];
  }

  private raise(severity: AlertSeverity, code: string, message: string, now: number): void {
    if (this.alerts.some((a) => a.code === code)) return;
    this.alerts = [
      ...this.alerts,
      { id: `sim-${++this.alertSeq}`, severity, code, message, at: now },
    ];
  }

  /** What the sliced G-code would do with the fans, unless the user overrode them. */
  private fans(): FanState {
    const printing = this.status === "printing";
    const auto: Record<ControllableFan, number> = {
      part: printing ? 100 : 0,
      aux: printing ? 30 : 0,
      chamber: printing ? 50 : 0,
    };
    // Quantize like the real printer's 0..15 levels reported back in 10 % steps.
    const q = (pct: number) => Math.round(Math.round((pct / 100) * 15) / 1.5) * 10;
    return {
      part: q(this.fanOverride.part ?? auto.part),
      aux: q(this.fanOverride.aux ?? auto.aux),
      chamber: q(this.fanOverride.chamber ?? auto.chamber),
      heatbreak: (this.nozzle.current ?? 0) > 50 ? 100 : 0,
    };
  }

  /** Normalized state as the provider would publish it (without connection info). */
  snapshot(): Omit<PrinterState, "connection" | "source"> & { wifiSignalDbm: number | null } {
    const job = this.job;
    const def = job?.def;
    const jobVisible = job !== null;
    const rate = (speedPreset(this.speedLevel)?.percent ?? 100) / 100;
    const remaining =
      job && def && def.reportsRemainingTime && this.status !== "failed"
        ? Math.round((def.durationSeconds - job.workSeconds) / rate)
        : null;
    const progressFraction = job && def ? job.workSeconds / def.durationSeconds : null;

    return {
      info: { ...this.scenario.info },
      wifiSignalDbm: this.scenario.wifiSignalDbm,
      status: this.status,
      job: {
        name: jobVisible ? this.lastJobName : null,
        progress: progressFraction === null ? null : Math.floor(progressFraction * 100),
        elapsedSeconds: job ? Math.round(job.printSeconds) : null,
        remainingSeconds: remaining,
        startedAt: null,
        layer:
          job && def?.totalLayers
            ? this.status === "preparing"
              ? 0
              : Math.max(1, Math.ceil((progressFraction ?? 0) * def.totalLayers))
            : null,
        totalLayers: def?.totalLayers ?? null,
        stage: this.stageId === null ? null : (STAGE_LABELS[this.stageId] ?? null),
      },
      nozzle: { current: round1(this.nozzle.current), target: this.nozzle.target },
      bed: { current: round1(this.bed.current), target: this.bed.target },
      speedLevel: this.speedLevel,
      chamberLight: this.chamberLight,
      fans: this.fans(),
      ams: structuredClone(this.ams),
      printErrorCode: this.printErrorCode,
      alerts: [...this.alerts],
    };
  }
}

function atTarget(t: Temperature): boolean {
  return (
    t.target !== null && t.current !== null && Math.abs(t.current - t.target) <= AT_TEMP_TOLERANCE_C
  );
}

function approach(t: Temperature, ambient: number, model: ThermalModel, dt: number): number {
  const current = t.current ?? ambient;
  const goal = t.target && t.target > ambient ? t.target : ambient;
  const tau = goal > current ? model.heatTauS : model.coolTauS;
  return current + (goal - current) * (1 - Math.exp(-dt / tau));
}

function round1(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10;
}
