/**
 * Normalized, transport-independent printer state.
 *
 * This model is deliberately free of React and of Bambu wire-format details so it can be
 * reproduced 1:1 as C structs in the future ESP32/LVGL firmware (see docs/hardware-porting.md).
 *
 * Convention: `null` always means "not reported / unknown". Never substitute a fake default
 * for a value the printer did not send.
 */

/** "live" = real printer data delivered by the server bridge (Bambu Cloud or LAN MQTT). */
export type DataSource = "simulated" | "live";

/** How the bridge reaches the printer. */
export type ConnectionMode = "cloud" | "lan" | "simulation";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

/** Mirrors Bambu `gcode_state` (IDLE, PREPARE, RUNNING, PAUSE, FINISH, FAILED, ...). */
export type PrintStatus =
  "idle" | "preparing" | "printing" | "paused" | "finished" | "failed" | "unknown";

/** Bambu `spd_lvl`: 1 silent, 2 standard, 3 sport, 4 ludicrous. */
export type SpeedLevel = 1 | 2 | 3 | 4;

export interface Temperature {
  current: number | null;
  target: number | null;
}

export type TrayState = "loaded" | "empty" | "unknown";

export interface AmsTray {
  /** Slot index inside its AMS unit, 0..3. */
  slot: number;
  state: TrayState;
  /** Filament material, e.g. "PLA". */
  material: string | null;
  /** CSS hex colour (#RRGGBB) or null when unknown/unset. */
  color: string | null;
  /** 0..100, null when the printer cannot measure it (e.g. non-RFID spool). */
  remainPercent: number | null;
  /** Bambu filament preset id, e.g. "GFA00". */
  presetId: string | null;
  nozzleTempMin: number | null;
  nozzleTempMax: number | null;
}

export interface AmsUnit {
  id: number;
  /** Raw Bambu humidity index as reported (see docs/research.md for open questions). */
  humidityIndex: number | null;
  temperature: number | null;
  trays: AmsTray[];
}

/** Which filament feeds the toolhead. */
export type ActiveFilament =
  | { kind: "none" }
  | { kind: "ams"; unit: number; slot: number }
  | { kind: "external" }
  | { kind: "unknown" };

export interface AmsState {
  /** null = AMS presence not reported yet; [] = reported, no AMS attached. */
  units: AmsUnit[] | null;
  externalSpool: AmsTray | null;
  active: ActiveFilament;
}

export interface PrintJob {
  name: string | null;
  /** 0..100 */
  progress: number | null;
  /** Seconds actually spent printing (excludes paused time where the source can tell). */
  elapsedSeconds: number | null;
  remainingSeconds: number | null;
  /** Epoch ms when the job started, if reported. */
  startedAt: number | null;
  layer: number | null;
  totalLayers: number | null;
  /** Human readable sub-stage (e.g. "Auto bed leveling"), null when not applicable. */
  stage: string | null;
}

export type AlertSeverity = "info" | "warning" | "error";

export interface PrinterAlert {
  id: string;
  severity: AlertSeverity;
  /** Stable code, e.g. "HMS_0300_0100_0001_0007" or "SIM_FILAMENT_RUNOUT". */
  code: string;
  message: string;
  /** Epoch ms when first observed. */
  at: number;
}

export interface PrinterInfo {
  model: string;
  name: string;
  serial: string | null;
  firmware: string | null;
  nozzleDiameter: string | null;
  connectionMode: ConnectionMode | null;
}

export interface ConnectionInfo {
  status: ConnectionStatus;
  /** Transport-level reachability of the network the printer is on. */
  wifiSignalDbm: number | null;
  /** Epoch ms of the last telemetry message that was applied. */
  lastTelemetryAt: number | null;
  lastError: string | null;
}

export interface PrinterState {
  source: DataSource;
  info: PrinterInfo;
  connection: ConnectionInfo;
  status: PrintStatus;
  job: PrintJob;
  nozzle: Temperature;
  bed: Temperature;
  speedLevel: SpeedLevel | null;
  chamberLight: boolean | null;
  ams: AmsState;
  /** Raw Bambu `print_error` code (0 = none). */
  printErrorCode: number | null;
  alerts: PrinterAlert[];
}

/** Status shown to the user, derived from connection + freshness + print status. */
export type DisplayStatus = "disconnected" | "connecting" | "stale" | "error" | PrintStatus;
