import { BED_MAX_C, NOZZLE_MAX_C, isTelemetryStale } from "./state";
import type { PrinterState, SpeedLevel } from "./types";

/**
 * UI-level intents. These are transport independent; protocol/command-builders.ts maps the
 * verified subset to Bambu MQTT payloads.
 */
export type PrinterCommand =
  | { type: "pause" }
  | { type: "resume" }
  /** Destructive: must carry an explicit confirmation flag set by a confirmation dialog. */
  | { type: "stop"; confirmed: true }
  | { type: "set_speed"; level: SpeedLevel }
  | { type: "set_nozzle_target"; celsius: number }
  | { type: "set_bed_target"; celsius: number }
  | { type: "set_chamber_light"; on: boolean }
  | { type: "request_full_status" }
  /** Simulation only: there is no verified "start a print" command for this UI yet. */
  | { type: "start_sample_job" };

export type CommandType = PrinterCommand["type"];

export interface CommandResult {
  ok: boolean;
  /** Printer/bridge-provided reason or a local explanation. */
  message?: string;
}

export interface CommandSpec {
  label: string;
  /** Destructive commands are never retried automatically. */
  destructive: boolean;
  /** Safe to re-send on timeout without side effects beyond the intended one. */
  idempotent: boolean;
  /** Pending label shown while waiting, e.g. "Pausing…". */
  pendingLabel: string;
  successLabel: string;
}

export const COMMAND_SPECS: Record<CommandType, CommandSpec> = {
  pause: {
    label: "Pause",
    destructive: false,
    idempotent: false,
    pendingLabel: "Pausing…",
    successLabel: "Paused",
  },
  resume: {
    label: "Resume",
    destructive: false,
    idempotent: false,
    pendingLabel: "Resuming…",
    successLabel: "Resumed",
  },
  stop: {
    label: "Stop print",
    destructive: true,
    idempotent: false,
    pendingLabel: "Stopping…",
    successLabel: "Print stopped",
  },
  set_speed: {
    label: "Set speed",
    destructive: false,
    idempotent: true,
    pendingLabel: "Changing speed…",
    successLabel: "Speed changed",
  },
  set_nozzle_target: {
    label: "Set nozzle",
    destructive: false,
    idempotent: true,
    pendingLabel: "Setting nozzle…",
    successLabel: "Nozzle target set",
  },
  set_bed_target: {
    label: "Set bed",
    destructive: false,
    idempotent: true,
    pendingLabel: "Setting bed…",
    successLabel: "Bed target set",
  },
  set_chamber_light: {
    label: "Chamber light",
    destructive: false,
    idempotent: true,
    pendingLabel: "Switching light…",
    successLabel: "Light switched",
  },
  request_full_status: {
    label: "Refresh status",
    destructive: false,
    idempotent: true,
    pendingLabel: "Refreshing…",
    successLabel: "Status refreshed",
  },
  start_sample_job: {
    label: "Start sample print",
    destructive: false,
    idempotent: false,
    pendingLabel: "Starting…",
    successLabel: "Print started",
  },
};

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const ok: ValidationResult = { ok: true };
const fail = (reason: string): ValidationResult => ({ ok: false, reason });

export interface ValidationContext {
  supported: ReadonlySet<CommandType>;
  unsupportedReason?: string | null;
  now: number;
  staleAfterMs?: number;
}

function validateTarget(celsius: number, max: number, label: string): ValidationResult {
  if (!Number.isFinite(celsius) || !Number.isInteger(celsius))
    return fail(`${label} target must be a whole number`);
  if (celsius < 0 || celsius > max) return fail(`${label} target must be 0–${max} °C`);
  return ok;
}

/**
 * Pure validation of a command against provider capabilities and the current state.
 * The UI uses the same function to decide which controls are enabled.
 */
export function validateCommand(
  command: PrinterCommand,
  state: PrinterState,
  ctx: ValidationContext,
): ValidationResult {
  if (!ctx.supported.has(command.type)) {
    return fail(ctx.unsupportedReason ?? "Not supported by this connection");
  }
  if (state.connection.status !== "connected") return fail("Printer is offline");
  if (
    command.type !== "request_full_status" &&
    isTelemetryStale(state, ctx.now, ctx.staleAfterMs)
  ) {
    return fail("Printer state is stale");
  }

  switch (command.type) {
    case "pause":
      return state.status === "printing" ? ok : fail("Only a running print can be paused");
    case "resume":
      return state.status === "paused" ? ok : fail("Only a paused print can be resumed");
    case "stop":
      if (command.confirmed !== true) return fail("Stopping requires confirmation");
      return state.status === "printing" ||
        state.status === "paused" ||
        state.status === "preparing"
        ? ok
        : fail("No active print to stop");
    case "set_speed":
      if (![1, 2, 3, 4].includes(command.level)) return fail("Unknown speed preset");
      return state.status === "printing" || state.status === "paused"
        ? ok
        : fail("Speed can only change during a print");
    case "set_nozzle_target":
      return validateTarget(command.celsius, NOZZLE_MAX_C, "Nozzle");
    case "set_bed_target":
      return validateTarget(command.celsius, BED_MAX_C, "Bed");
    case "set_chamber_light":
      return ok;
    case "request_full_status":
      return ok;
    case "start_sample_job":
      return state.status === "idle" || state.status === "finished" || state.status === "failed"
        ? ok
        : fail("Printer is busy");
  }
}

/**
 * Predicate that proves the printer actually executed a command. A transport-level ack is not
 * enough: the command manager waits until telemetry satisfies this (or times out).
 */
export function commandEffectObserved(command: PrinterCommand, state: PrinterState): boolean {
  switch (command.type) {
    case "pause":
      return state.status === "paused";
    case "resume":
      return state.status === "printing" || state.status === "preparing";
    case "stop":
      return state.status === "failed" || state.status === "idle";
    case "set_speed":
      return state.speedLevel === command.level;
    case "set_nozzle_target":
      return state.nozzle.target === command.celsius;
    case "set_bed_target":
      return state.bed.target === command.celsius;
    case "set_chamber_light":
      return state.chamberLight === command.on;
    case "request_full_status":
      return true;
    case "start_sample_job":
      return state.status === "preparing" || state.status === "printing";
  }
}
