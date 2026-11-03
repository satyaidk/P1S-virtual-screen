import type { DataSource, DisplayStatus, PrinterState, SpeedLevel } from "./types";

/** Telemetry older than this is considered stale while connected. */
export const DEFAULT_STALE_AFTER_MS = 15_000;

/** Verified P1S hardware limits (Bambu Lab P1S spec sheet). */
export const NOZZLE_MAX_C = 300;
export const BED_MAX_C = 100;

export interface SpeedPreset {
  level: SpeedLevel;
  label: string;
  shortLabel: string;
  /** Bambu `spd_mag` percentage for this preset. */
  percent: number;
}

export const SPEED_PRESETS: readonly SpeedPreset[] = [
  { level: 1, label: "Silent", shortLabel: "Silent", percent: 50 },
  { level: 2, label: "Standard", shortLabel: "Std", percent: 100 },
  { level: 3, label: "Sport", shortLabel: "Sport", percent: 124 },
  { level: 4, label: "Ludicrous", shortLabel: "Ludi", percent: 166 },
];

/** Fan presets offered on the fan screen (percent). */
export const FAN_PRESETS: readonly number[] = [0, 30, 50, 70, 100];

/** Below this the hotend refuses to extrude (cold-extrusion protection). */
export const MIN_EXTRUDE_C = 170;

/** Jog distances (mm) offered on the move screen. */
export const JOG_STEPS_MM: readonly number[] = [1, 10];

export function speedPreset(level: SpeedLevel | null): SpeedPreset | null {
  return SPEED_PRESETS.find((p) => p.level === level) ?? null;
}

export function createUnknownState(source: DataSource, name = "P1S"): PrinterState {
  return {
    source,
    info: {
      model: "P1S",
      name,
      serial: null,
      firmware: null,
      nozzleDiameter: null,
      connectionMode: null,
    },
    connection: {
      status: "disconnected",
      wifiSignalDbm: null,
      lastTelemetryAt: null,
      lastError: null,
    },
    status: "unknown",
    job: {
      name: null,
      progress: null,
      elapsedSeconds: null,
      remainingSeconds: null,
      startedAt: null,
      layer: null,
      totalLayers: null,
      stage: null,
    },
    nozzle: { current: null, target: null },
    bed: { current: null, target: null },
    speedLevel: null,
    chamberLight: null,
    fans: { part: null, aux: null, chamber: null, heatbreak: null },
    ams: { units: null, externalSpool: null, active: { kind: "unknown" } },
    printErrorCode: null,
    alerts: [],
  };
}

export function telemetryAgeMs(state: PrinterState, now: number): number | null {
  const last = state.connection.lastTelemetryAt;
  return last === null ? null : Math.max(0, now - last);
}

export function isTelemetryStale(
  state: PrinterState,
  now: number,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
): boolean {
  if (state.connection.status !== "connected") return false;
  const age = telemetryAgeMs(state, now);
  return age === null || age > staleAfterMs;
}

export function hasActiveError(state: PrinterState): boolean {
  return state.alerts.some((a) => a.severity === "error");
}

/**
 * Single source of truth for what the screen should communicate.
 * Priority: connectivity > freshness > errors > print status.
 */
export function deriveDisplayStatus(
  state: PrinterState,
  now: number,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
): DisplayStatus {
  if (state.connection.status === "disconnected") return "disconnected";
  if (state.connection.status === "connecting") return "connecting";
  if (isTelemetryStale(state, now, staleAfterMs)) return "stale";
  if (hasActiveError(state) && state.status !== "paused") return "error";
  return state.status;
}

export function isJobActive(state: Pick<PrinterState, "status">): boolean {
  return state.status === "preparing" || state.status === "printing" || state.status === "paused";
}
