import type { ActiveFilament, AmsTray, AmsUnit, PrinterInfo } from "../types";

/**
 * Configurable sample data for the simulator. Everything here is SIMULATED and labelled as such
 * in the UI. Values follow the shapes the real P1S reports (see docs/protocol-notes.md), e.g.
 * remaining filament is unknown (null) for non-RFID spools.
 */

export interface SimJobDefinition {
  name: string;
  /** Print duration at the Standard (100%) speed preset. */
  durationSeconds: number;
  totalLayers: number | null;
  nozzleTarget: number;
  bedTarget: number;
  /** Time spent bed-leveling after the bed reaches temperature. */
  levelingSeconds: number;
  filament: ActiveFilament;
  /** Percent of the spool consumed by the whole job. */
  filamentUsagePercent: number;
  /** When false the simulated firmware never reports a remaining-time estimate. */
  reportsRemainingTime: boolean;
}

export interface Scenario {
  id: string;
  label: string;
  description: string;
  info: PrinterInfo;
  wifiSignalDbm: number | null;
  ambientC: number;
  amsUnits: AmsUnit[] | null;
  externalSpool: AmsTray | null;
  initialFilament: ActiveFilament;
  job: SimJobDefinition;
  /** Optional starting point: begin already printing at this progress fraction (0..1). */
  startPrintingAt?: number;
}

function tray(
  slot: number,
  material: string,
  color: string | null,
  remainPercent: number | null,
  presetId: string | null,
  nozzleRange: [number, number] | null,
): AmsTray {
  return {
    slot,
    state: "loaded",
    material,
    color,
    remainPercent,
    presetId,
    nozzleTempMin: nozzleRange?.[0] ?? null,
    nozzleTempMax: nozzleRange?.[1] ?? null,
  };
}

function empty(slot: number): AmsTray {
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

const standardAms: AmsUnit[] = [
  {
    id: 0,
    humidityIndex: 4,
    temperature: 24.6,
    trays: [
      tray(0, "PLA", "#161616", 82, "GFA00", [190, 240]),
      tray(1, "PLA", "#F2F2EE", 45, "GFA05", [190, 240]),
      // Third-party spool without RFID: Bambu reports remain = -1 (unknown).
      tray(2, "PETG", "#1F5FBF", null, null, [220, 260]),
      empty(3),
    ],
  },
];

const standardInfo: PrinterInfo = {
  model: "P1S",
  name: "P1S Workshop",
  serial: "01P00SIM0000001",
  firmware: "01.08.02.00",
  nozzleDiameter: "0.4",
  connectionMode: "simulation",
};

const sampleJob: SimJobDefinition = {
  name: "Cable_Clip_x8_PLA_0.2mm",
  durationSeconds: 42 * 60,
  totalLayers: 96,
  nozzleTarget: 220,
  bedTarget: 55,
  levelingSeconds: 25,
  filament: { kind: "ams", unit: 0, slot: 0 },
  filamentUsagePercent: 6,
  reportsRemainingTime: true,
};

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "standard",
    label: "P1S + AMS (idle)",
    description: "Idle printer with one AMS: three loaded trays, one empty.",
    info: standardInfo,
    wifiSignalDbm: -52,
    ambientC: 24,
    amsUnits: standardAms,
    externalSpool: empty(254),
    initialFilament: { kind: "ams", unit: 0, slot: 0 },
    job: sampleJob,
  },
  {
    id: "mid-print",
    label: "Mid-print (40%)",
    description: "Starts in the middle of a print to test the running layout.",
    info: standardInfo,
    wifiSignalDbm: -61,
    ambientC: 24,
    amsUnits: standardAms,
    externalSpool: empty(254),
    initialFilament: { kind: "ams", unit: 0, slot: 0 },
    job: sampleJob,
    startPrintingAt: 0.4,
  },
  {
    id: "no-ams",
    label: "External spool, no AMS",
    description: "P1S without AMS, printing from the external spool holder.",
    info: { ...standardInfo, name: "P1S Garage" },
    wifiSignalDbm: -70,
    ambientC: 21,
    amsUnits: [],
    externalSpool: tray(254, "PETG", "#2B2B2B", null, null, [220, 260]),
    initialFilament: { kind: "external" },
    job: {
      ...sampleJob,
      name: "Wall_Bracket_PETG",
      durationSeconds: 25 * 60,
      totalLayers: 140,
      nozzleTarget: 250,
      bedTarget: 70,
      filament: { kind: "external" },
    },
  },
  {
    id: "sparse",
    label: "Sparse telemetry",
    description: "Firmware, serial, Wi-Fi, colours and estimates are not reported.",
    info: {
      model: "P1S",
      name: "P1S",
      serial: null,
      firmware: null,
      nozzleDiameter: null,
      connectionMode: "simulation",
    },
    wifiSignalDbm: null,
    ambientC: 24,
    amsUnits: [
      {
        id: 0,
        humidityIndex: null,
        temperature: null,
        trays: [
          { ...tray(0, "PLA", null, null, null, null) },
          { ...empty(1), state: "unknown" },
          empty(2),
          empty(3),
        ],
      },
    ],
    externalSpool: null,
    initialFilament: { kind: "unknown" },
    job: {
      ...sampleJob,
      name: "untitled",
      totalLayers: null,
      reportsRemainingTime: false,
    },
  },
];

export const DEFAULT_SCENARIO_ID = "standard";

export function getScenario(id: string): Scenario {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`Unknown scenario "${id}"`);
  return scenario;
}
