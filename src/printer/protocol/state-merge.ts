import type {
  ActiveFilament,
  AmsState,
  AmsTray,
  AmsUnit,
  PrinterAlert,
  PrinterState,
  PrintStatus,
} from "../types";
import {
  PRINT_ERROR_USER_CANCELLED,
  STAGE_LABELS,
  TRAY_NOW_EXTERNAL,
  TRAY_NOW_NONE,
} from "./mqtt-types";
import type { AmsPatch, TelemetryPatch, TrayPatch } from "./telemetry-parser";

const SLOTS_PER_AMS = 4;

function emptyTray(slot: number): AmsTray {
  return {
    slot,
    state: "empty",
    material: null,
    color: null,
    remainPercent: null,
    presetId: null,
    nozzleTempMin: null,
    nozzleTempMax: null,
  };
}

export function mergeTray(prev: AmsTray | undefined, patch: TrayPatch): AmsTray {
  if (patch.empty) return emptyTray(patch.slot);
  const base: AmsTray =
    prev && prev.state !== "empty" ? prev : { ...emptyTray(patch.slot), state: "loaded" };
  return {
    slot: patch.slot,
    state: "loaded",
    material: patch.material !== undefined ? patch.material : base.material,
    color: patch.color !== undefined ? patch.color : base.color,
    remainPercent: patch.remainPercent !== undefined ? patch.remainPercent : base.remainPercent,
    presetId: patch.presetId !== undefined ? patch.presetId : base.presetId,
    nozzleTempMin: patch.nozzleTempMin ?? base.nozzleTempMin,
    nozzleTempMax: patch.nozzleTempMax ?? base.nozzleTempMax,
  };
}

export function decodeTrayNow(trayNow: number): ActiveFilament {
  if (trayNow === TRAY_NOW_NONE) return { kind: "none" };
  if (trayNow === TRAY_NOW_EXTERNAL) return { kind: "external" };
  if (trayNow >= 0 && trayNow < 16 * SLOTS_PER_AMS) {
    return {
      kind: "ams",
      unit: Math.floor(trayNow / SLOTS_PER_AMS),
      slot: trayNow % SLOTS_PER_AMS,
    };
  }
  return { kind: "unknown" };
}

function mergeAms(prev: AmsState, patch: AmsPatch): AmsState {
  let units: AmsUnit[] | null = prev.units;

  if (patch.units) {
    const byId = new Map((units ?? []).map((u) => [u.id, u]));
    for (const unitPatch of patch.units) {
      const prevUnit = byId.get(unitPatch.id);
      const trays = [...(prevUnit?.trays ?? [])];
      for (const trayPatch of unitPatch.trays ?? []) {
        const idx = trays.findIndex((t) => t.slot === trayPatch.slot);
        const merged = mergeTray(idx >= 0 ? trays[idx] : undefined, trayPatch);
        if (idx >= 0) trays[idx] = merged;
        else trays.push(merged);
      }
      trays.sort((a, b) => a.slot - b.slot);
      byId.set(unitPatch.id, {
        id: unitPatch.id,
        humidityIndex: unitPatch.humidityIndex ?? prevUnit?.humidityIndex ?? null,
        temperature: unitPatch.temperature ?? prevUnit?.temperature ?? null,
        trays,
      });
    }
    units = [...byId.values()].sort((a, b) => a.id - b.id);
  }

  if (patch.amsExistBits !== undefined) {
    const bits = patch.amsExistBits;
    units = (units ?? []).filter((u) => (bits >> u.id) & 1);
  }

  if (patch.trayExistBits !== undefined && units) {
    const bits = patch.trayExistBits;
    units = units.map((u) => ({
      ...u,
      trays: u.trays.map((t) => {
        const present = (bits >> (u.id * SLOTS_PER_AMS + t.slot)) & 1;
        if (!present) return t.state === "empty" ? t : emptyTray(t.slot);
        return t.state === "empty" ? { ...t, state: "unknown" as const } : t;
      }),
    }));
  }

  return {
    units,
    externalSpool: prev.externalSpool,
    active: patch.trayNow !== undefined ? decodeTrayNow(patch.trayNow) : prev.active,
  };
}

/** Format an HMS entry the way Bambu documents it: HMS_AAAA_AAAA_CCCC_CCCC. */
export function formatHmsCode(attr: number, code: number): string {
  const hex = (n: number) => (n >>> 0).toString(16).toUpperCase().padStart(8, "0");
  const a = hex(attr);
  const c = hex(code);
  return `HMS_${a.slice(0, 4)}_${a.slice(4)}_${c.slice(0, 4)}_${c.slice(4)}`;
}

// Module and severity encodings verified against ha-bambulab (const.py HMS_MODULES / HMS_SEVERITY_LEVELS).
const HMS_MODULES: Readonly<Record<number, string>> = {
  0x03: "motion controller",
  0x05: "mainboard",
  0x07: "AMS",
  0x08: "toolhead",
  0x0c: "camera/xcam",
};

function hmsModule(attr: number): string {
  return HMS_MODULES[(attr >>> 24) & 0xff] ?? "unknown module";
}

function hmsSeverity(code: number): PrinterAlert["severity"] {
  // The upper 16 bits of `code` carry the HMS level: 1 fatal, 2 serious, 3 common, 4 info.
  const level = (code >>> 16) & 0xffff;
  if (level === 1 || level === 2) return "error";
  if (level === 3) return "warning";
  return "info";
}

function mergeAlerts(prev: PrinterAlert[], patch: TelemetryPatch, now: number): PrinterAlert[] {
  let alerts = prev;

  if (patch.hms) {
    const nonHms = alerts.filter((a) => !a.code.startsWith("HMS_"));
    const hms = patch.hms.map((h): PrinterAlert => {
      const code = formatHmsCode(h.attr, h.code);
      const existing = prev.find((a) => a.code === code);
      return {
        id: existing?.id ?? `hms-${code}`,
        severity: hmsSeverity(h.code),
        code,
        message: `HMS alert from ${hmsModule(h.attr)}`,
        at: existing?.at ?? now,
      };
    });
    alerts = [...nonHms, ...hms];
  }

  if (patch.printErrorCode !== undefined) {
    alerts = alerts.filter((a) => !a.code.startsWith("PRINT_ERROR_"));
    const code = patch.printErrorCode;
    if (code !== 0 && code !== PRINT_ERROR_USER_CANCELLED) {
      const hex = (code >>> 0).toString(16).toUpperCase().padStart(8, "0");
      const existing = prev.find((a) => a.code === `PRINT_ERROR_${hex}`);
      alerts = [
        ...alerts,
        {
          id: `print-error-${hex}`,
          severity: "error",
          code: `PRINT_ERROR_${hex}`,
          message: `Print error 0x${hex}`,
          at: existing?.at ?? now,
        },
      ];
    }
  }

  return alerts;
}

function stageLabel(stageId: number | null, status: PrintStatus): string | null {
  if (stageId === null) return null;
  if (status !== "preparing" && status !== "printing" && status !== "paused") return null;
  return STAGE_LABELS[stageId] ?? `Stage ${stageId}`;
}

function pick<T>(next: T | undefined, prev: T): T {
  return next === undefined ? prev : next;
}

/**
 * Merge a partial telemetry patch into the previous state.
 *
 * - Fields absent from the patch are preserved (P1 printers send partial reports).
 * - Unchanged branches keep their object identity so React selectors avoid re-renders.
 */
export function mergeTelemetry(
  prev: PrinterState,
  patch: TelemetryPatch,
  now: number,
): PrinterState {
  const status = pick(patch.status, prev.status);

  const job = { ...prev.job };
  job.name = pick(patch.jobName, prev.job.name);
  job.progress = pick(patch.progress, prev.job.progress);
  job.remainingSeconds = pick(patch.remainingSeconds, prev.job.remainingSeconds);
  job.startedAt = pick(patch.startedAt, prev.job.startedAt);
  job.layer = pick(patch.layer, prev.job.layer);
  job.totalLayers = pick(patch.totalLayers, prev.job.totalLayers);
  if (patch.stageId !== undefined || patch.status !== undefined) {
    const stageId = patch.stageId !== undefined ? patch.stageId : null;
    job.stage =
      patch.stageId !== undefined
        ? stageLabel(stageId, status)
        : status === prev.status
          ? prev.job.stage
          : null;
  }
  // Bambu does not report elapsed time; derive it from the start time (includes paused time).
  if (
    job.startedAt !== null &&
    (status === "printing" || status === "paused" || status === "preparing")
  ) {
    job.elapsedSeconds = Math.max(0, Math.round((now - job.startedAt) / 1000));
  }

  const ams =
    patch.ams || patch.externalSpool
      ? {
          ...(patch.ams ? mergeAms(prev.ams, patch.ams) : prev.ams),
          externalSpool: patch.externalSpool
            ? mergeTray(prev.ams.externalSpool ?? undefined, patch.externalSpool)
            : prev.ams.externalSpool,
        }
      : prev.ams;

  const next: PrinterState = {
    source: prev.source,
    info:
      patch.firmware !== undefined || patch.nozzleDiameter !== undefined
        ? {
            ...prev.info,
            firmware: pick(patch.firmware, prev.info.firmware),
            nozzleDiameter: pick(patch.nozzleDiameter, prev.info.nozzleDiameter),
          }
        : prev.info,
    connection: {
      ...prev.connection,
      wifiSignalDbm: pick(patch.wifiSignalDbm, prev.connection.wifiSignalDbm),
      lastTelemetryAt: now,
    },
    status,
    job: shallowEqual(job, prev.job) ? prev.job : job,
    nozzle:
      patch.nozzleCurrent !== undefined || patch.nozzleTarget !== undefined
        ? {
            current: pick(patch.nozzleCurrent, prev.nozzle.current),
            target: pick(patch.nozzleTarget, prev.nozzle.target),
          }
        : prev.nozzle,
    bed:
      patch.bedCurrent !== undefined || patch.bedTarget !== undefined
        ? {
            current: pick(patch.bedCurrent, prev.bed.current),
            target: pick(patch.bedTarget, prev.bed.target),
          }
        : prev.bed,
    speedLevel: pick(patch.speedLevel, prev.speedLevel),
    chamberLight: pick(patch.chamberLight, prev.chamberLight),
    fans: patch.fans
      ? {
          part: pick(patch.fans.part, prev.fans.part),
          aux: pick(patch.fans.aux, prev.fans.aux),
          chamber: pick(patch.fans.chamber, prev.fans.chamber),
          heatbreak: pick(patch.fans.heatbreak, prev.fans.heatbreak),
        }
      : prev.fans,
    ams,
    printErrorCode: pick(patch.printErrorCode, prev.printErrorCode),
    alerts:
      patch.hms || patch.printErrorCode !== undefined
        ? mergeAlerts(prev.alerts, patch, now)
        : prev.alerts,
  };
  return next;
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((k) => Object.is(a[k], b[k]));
}
