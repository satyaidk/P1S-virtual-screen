import {
  ackSchema,
  amsSchema,
  printFieldSchemas,
  traySchema,
  versionInfoSchema,
  type PrintFieldName,
  type RawTray,
} from "../schemas";
import type { PrintStatus, SpeedLevel } from "../types";

/** A normalized, partial update. Absent keys mean "not in this report" — never "unknown". */
export interface TelemetryPatch {
  status?: PrintStatus;
  jobName?: string | null;
  progress?: number;
  remainingSeconds?: number;
  startedAt?: number | null;
  layer?: number;
  totalLayers?: number;
  stageId?: number | null;
  nozzleCurrent?: number;
  nozzleTarget?: number;
  bedCurrent?: number;
  bedTarget?: number;
  speedLevel?: SpeedLevel;
  printErrorCode?: number;
  wifiSignalDbm?: number;
  nozzleDiameter?: string;
  chamberLight?: boolean;
  firmware?: string;
  hms?: { attr: number; code: number }[];
  ams?: AmsPatch;
  externalSpool?: TrayPatch;
}

export interface TrayPatch {
  slot: number;
  /** Bambu sends `{ "id": "N" }` alone for an empty tray. */
  empty: boolean;
  material?: string | null;
  color?: string | null;
  remainPercent?: number | null;
  presetId?: string | null;
  nozzleTempMin?: number;
  nozzleTempMax?: number;
}

export interface AmsUnitPatch {
  id: number;
  humidityIndex?: number;
  temperature?: number;
  trays?: TrayPatch[];
}

export interface AmsPatch {
  units?: AmsUnitPatch[];
  amsExistBits?: number;
  trayExistBits?: number;
  trayNow?: number;
}

export interface CommandAck {
  envelope: string;
  command: string;
  sequenceId: string | null;
  /** Lower-cased; Bambu documents the value as case-insensitive. */
  result: string;
  reason: string | null;
}

export interface ParseIssue {
  path: string;
  message: string;
}

export interface ParseResult {
  ok: boolean;
  patch: TelemetryPatch;
  ack: CommandAck | null;
  issues: ParseIssue[];
  /** Keys inside `print` that this app does not consume (useful when exploring firmware). */
  ignoredKeys: string[];
}

const GCODE_STATE_MAP: Record<string, PrintStatus> = {
  IDLE: "idle",
  INIT: "idle",
  PREPARE: "preparing",
  SLICING: "preparing",
  RUNNING: "printing",
  PAUSE: "paused",
  FINISH: "finished",
  FAILED: "failed",
};

export function mapGcodeState(raw: string): PrintStatus {
  return GCODE_STATE_MAP[raw.toUpperCase()] ?? "unknown";
}

/** "RRGGBBAA" -> "#RRGGBB"; fully transparent "00000000" means "no colour set". */
export function normalizeTrayColor(raw: string): string | null {
  if (/^0{8}$/.test(raw)) return null;
  return `#${raw.slice(0, 6).toUpperCase()}`;
}

/** "-45dBm" -> -45 */
export function parseWifiSignal(raw: string): number | null {
  const match = /^(-?\d+)\s*dBm$/i.exec(raw.trim());
  return match ? Number(match[1]) : null;
}

export function normalizeTray(raw: RawTray): TrayPatch {
  const keys = Object.keys(raw).filter((k) => k !== "id");
  if (keys.length === 0) return { slot: raw.id, empty: true };
  const patch: TrayPatch = { slot: raw.id, empty: false };
  if (raw.tray_type !== undefined) patch.material = raw.tray_type === "" ? null : raw.tray_type;
  if (raw.tray_color !== undefined) patch.color = normalizeTrayColor(raw.tray_color);
  // Bambu reports -1 when the remaining amount cannot be measured (non-RFID spool).
  if (raw.remain !== undefined)
    patch.remainPercent = raw.remain < 0 ? null : Math.min(100, raw.remain);
  if (raw.tray_info_idx !== undefined)
    patch.presetId = raw.tray_info_idx === "" ? null : raw.tray_info_idx;
  if (raw.nozzle_temp_min !== undefined) patch.nozzleTempMin = raw.nozzle_temp_min;
  if (raw.nozzle_temp_max !== undefined) patch.nozzleTempMax = raw.nozzle_temp_max;
  // An external spool with an empty type is effectively "nothing loaded".
  if (patch.material === null && raw.tray_type === "") patch.empty = true;
  return patch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyPrintField(
  patch: TelemetryPatch,
  name: PrintFieldName,
  value: unknown,
  issues: ParseIssue[],
): void {
  const result = printFieldSchemas[name].safeParse(value);
  if (!result.success) {
    issues.push({ path: `print.${name}`, message: result.error.issues[0]?.message ?? "invalid" });
    return;
  }
  const v = result.data as never;
  switch (name) {
    case "gcode_state":
      patch.status = mapGcodeState(v);
      break;
    case "mc_percent":
      patch.progress = Math.max(0, Math.min(100, v));
      break;
    case "mc_remaining_time":
      // Reported in minutes.
      patch.remainingSeconds = Math.max(0, (v as number) * 60);
      break;
    case "gcode_start_time":
      // Unix seconds; "0" means no job.
      patch.startedAt = (v as number) > 0 ? (v as number) * 1000 : null;
      break;
    case "subtask_name":
      patch.jobName = (v as string).trim() === "" ? null : v;
      break;
    case "layer_num":
      patch.layer = v;
      break;
    case "total_layer_num":
      patch.totalLayers = v;
      break;
    case "stg_cur":
      patch.stageId = (v as number) < 0 || (v as number) === 255 ? null : v;
      break;
    case "nozzle_temper":
      patch.nozzleCurrent = v;
      break;
    case "nozzle_target_temper":
      patch.nozzleTarget = v;
      break;
    case "bed_temper":
      patch.bedCurrent = v;
      break;
    case "bed_target_temper":
      patch.bedTarget = v;
      break;
    case "spd_lvl":
      if ([1, 2, 3, 4].includes(v)) patch.speedLevel = v;
      else issues.push({ path: "print.spd_lvl", message: `unknown speed level ${String(v)}` });
      break;
    case "print_error":
      patch.printErrorCode = v;
      break;
    case "wifi_signal": {
      const dbm = parseWifiSignal(v);
      if (dbm === null) issues.push({ path: "print.wifi_signal", message: "unrecognized format" });
      else patch.wifiSignalDbm = dbm;
      break;
    }
    case "nozzle_diameter":
      patch.nozzleDiameter = v;
      break;
    case "hms":
      patch.hms = v;
      break;
    case "lights_report": {
      const chamber = (v as { node: string; mode: string }[]).find(
        (l) => l.node === "chamber_light",
      );
      if (chamber) patch.chamberLight = chamber.mode !== "off";
      break;
    }
    case "ams": {
      const raw = v as ReturnType<typeof amsSchema.parse>;
      const ams: AmsPatch = {};
      if (raw.ams) {
        ams.units = raw.ams.map((u) => {
          const unit: AmsUnitPatch = { id: u.id };
          if (u.humidity !== undefined) unit.humidityIndex = u.humidity;
          if (u.temp !== undefined) unit.temperature = u.temp;
          if (u.tray) unit.trays = u.tray.map(normalizeTray);
          return unit;
        });
      }
      if (raw.ams_exist_bits !== undefined) ams.amsExistBits = parseInt(raw.ams_exist_bits, 16);
      if (raw.tray_exist_bits !== undefined) ams.trayExistBits = parseInt(raw.tray_exist_bits, 16);
      if (raw.tray_now !== undefined) ams.trayNow = raw.tray_now;
      patch.ams = ams;
      break;
    }
    case "vt_tray":
      patch.externalSpool = normalizeTray(v as ReturnType<typeof traySchema.parse>);
      break;
  }
}

/**
 * Parse one MQTT report payload (string or already-decoded JSON) into a normalized patch.
 * Invalid fields are dropped individually and reported as issues.
 */
export function parseReport(input: unknown): ParseResult {
  const issues: ParseIssue[] = [];
  const patch: TelemetryPatch = {};
  const ignoredKeys: string[] = [];
  let ack: CommandAck | null = null;

  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch {
      return {
        ok: false,
        patch,
        ack,
        issues: [{ path: "$", message: "invalid JSON" }],
        ignoredKeys,
      };
    }
  }
  if (!isRecord(data)) {
    return {
      ok: false,
      patch,
      ack,
      issues: [{ path: "$", message: "expected an object" }],
      ignoredKeys,
    };
  }

  for (const [envelope, body] of Object.entries(data)) {
    if (!isRecord(body)) continue;

    const ackParse = ackSchema.safeParse(body);
    if (ackParse.success && ackParse.data.result !== undefined) {
      ack = {
        envelope,
        command: ackParse.data.command,
        sequenceId: ackParse.data.sequence_id ?? null,
        result: ackParse.data.result.toLowerCase(),
        reason: ackParse.data.reason && ackParse.data.reason !== "" ? ackParse.data.reason : null,
      };
    }

    if (envelope === "info") {
      const info = versionInfoSchema.safeParse(body);
      if (info.success) {
        const ota = info.data.module.find((m) => m.name === "ota");
        if (ota?.sw_ver) patch.firmware = ota.sw_ver;
      }
      continue;
    }

    if (envelope !== "print") continue;
    for (const [key, value] of Object.entries(body)) {
      if (key in printFieldSchemas) applyPrintField(patch, key as PrintFieldName, value, issues);
      else ignoredKeys.push(key);
    }
  }

  return { ok: true, patch, ack, issues, ignoredKeys };
}
