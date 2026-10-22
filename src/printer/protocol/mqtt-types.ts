/**
 * Bambu Lab local MQTT conventions (verified against OpenBambuAPI mqtt.md):
 * - Broker: printer IP, port 8883, TLS, username "bblp", password = LAN access code.
 * - Printer -> client: device/{SERIAL}/report
 * - Client -> printer: device/{SERIAL}/request
 * - Every request carries a string `sequence_id`; the matching report echoes it with `result`.
 * - P1 series sends *partial* push_status reports; `pushing.pushall` requests a full one.
 *
 * Only the browser-safe parts live here. Credentials are owned by the bridge (docs/bridge-api.md).
 */

export const BAMBU_MQTT_PORT = 8883;
export const BAMBU_MQTT_USERNAME = "bblp";

export function reportTopic(serial: string): string {
  return `device/${serial}/report`;
}

export function requestTopic(serial: string): string {
  return `device/${serial}/request`;
}

/** Top-level keys of a request/report envelope. */
export type BambuEnvelopeKey = "print" | "pushing" | "system" | "info";

/** A request ready to be published on the request topic. */
export interface BambuRequest {
  /** QoS 1 for print control commands, as documented by OpenBambuAPI. */
  qos: 0 | 1;
  payload: Partial<Record<BambuEnvelopeKey, Record<string, unknown>>>;
}

/** `gcode_state` values observed on Bambu printers (ha-bambulab GCODE_STATE_OPTIONS). */
export type BambuGcodeState =
  | "IDLE"
  | "INIT"
  | "OFFLINE"
  | "PREPARE"
  | "SLICING"
  | "RUNNING"
  | "PAUSE"
  | "FINISH"
  | "FAILED"
  | "UNKNOWN";

/** tray_now sentinels. */
export const TRAY_NOW_NONE = 255;
export const TRAY_NOW_EXTERNAL = 254;

/** print_error value observed when a user cancels a print (ha-bambulab). */
export const PRINT_ERROR_USER_CANCELLED = 50348044;

/**
 * Human labels for `stg_cur` stage ids. Subset copied from ha-bambulab CURRENT_STAGE_IDS;
 * unknown ids are shown as "Stage N" rather than guessed.
 */
export const STAGE_LABELS: Readonly<Record<number, string>> = {
  0: "Printing",
  1: "Auto bed leveling",
  2: "Heatbed preheating",
  3: "Vibration compensation",
  4: "Changing filament",
  5: "M400 pause",
  6: "Filament runout",
  7: "Heating hotend",
  8: "Calibrating extrusion",
  9: "Scanning bed surface",
  10: "Inspecting first layer",
  11: "Identifying build plate",
  12: "Calibrating micro lidar",
  13: "Homing toolhead",
  14: "Cleaning nozzle tip",
  15: "Checking extruder temp",
  16: "Paused by user",
  17: "Front cover falling",
  18: "Calibrating micro lidar",
  19: "Calibrating extrusion flow",
  20: "Nozzle temp malfunction",
  21: "Heatbed temp malfunction",
  22: "Unloading filament",
  23: "Skipped step",
  24: "Loading filament",
  25: "Calibrating motor noise",
  26: "AMS lost",
  27: "Heatbreak fan speed low",
  28: "Chamber temp control error",
};
