import { describe, expect, it } from "vitest";
import pushall from "../fixtures/p1s-pushall.json";
import { decodeTrayNow, formatHmsCode, mergeTelemetry } from "@/printer/protocol/state-merge";
import { parseReport } from "@/printer/protocol/telemetry-parser";
import { createUnknownState } from "@/printer/state";
import type { PrinterState } from "@/printer/types";

const NOW = 1_700_000_100_000;

function apply(state: PrinterState, report: unknown, now = NOW): PrinterState {
  return mergeTelemetry(state, parseReport(report).patch, now);
}

describe("mergeTelemetry", () => {
  const full = apply(createUnknownState("live"), pushall);

  it("builds a complete state from a full report", () => {
    expect(full.status).toBe("idle");
    expect(full.connection.lastTelemetryAt).toBe(NOW);
    expect(full.ams.units).toHaveLength(1);
    const trays = full.ams.units?.[0]?.trays ?? [];
    expect(trays.map((t) => t.state)).toEqual(["empty", "loaded", "loaded", "loaded"]);
    expect(trays[3]?.remainPercent).toBeNull();
    expect(full.ams.active).toEqual({ kind: "none" });
    expect(full.ams.externalSpool?.state).toBe("empty");
    expect(full.alerts).toEqual([]);
  });

  it("preserves fields omitted from a partial report", () => {
    const next = apply(full, { print: { nozzle_temper: 180.5 } }, NOW + 1000);
    expect(next.nozzle.current).toBe(180.5);
    expect(next.nozzle.target).toBe(25);
    expect(next.bed).toBe(full.bed); // identity preserved
    expect(next.ams).toBe(full.ams);
    expect(next.speedLevel).toBe(2);
    expect(next.connection.lastTelemetryAt).toBe(NOW + 1000);
  });

  it("merges partial tray updates without erasing other tray fields", () => {
    const next = apply(full, {
      print: { ams: { ams: [{ id: "0", tray: [{ id: "2", remain: 50 }] }] } },
    });
    const tray = next.ams.units?.[0]?.trays[2];
    expect(tray?.remainPercent).toBe(50);
    expect(tray?.material).toBe("PLA");
    expect(tray?.color).toBe("#DFE2E3");
    expect(next.ams.units?.[0]?.humidityIndex).toBe(4);
  });

  it("applies tray presence bits and active tray", () => {
    const next = apply(full, { print: { ams: { tray_exist_bits: "6", tray_now: "2" } } });
    expect(next.ams.units?.[0]?.trays[3]?.state).toBe("empty");
    expect(next.ams.active).toEqual({ kind: "ams", unit: 0, slot: 2 });
  });

  it("removes AMS units that are no longer present", () => {
    const next = apply(full, { print: { ams: { ams_exist_bits: "0" } } });
    expect(next.ams.units).toEqual([]);
  });

  it("does not let an invalid field erase existing state", () => {
    const next = apply(full, { print: { bed_temper: { bad: true }, nozzle_temper: 30 } });
    expect(next.bed.current).toBe(25);
    expect(next.nozzle.current).toBe(30);
  });

  it("tracks a running job and derives elapsed time from the start time", () => {
    const start = (NOW - 600_000) / 1000;
    const next = apply(full, {
      print: {
        gcode_state: "RUNNING",
        subtask_name: "Benchy",
        mc_percent: 25,
        mc_remaining_time: 30,
        gcode_start_time: String(start),
        stg_cur: 0,
        layer_num: 10,
        total_layer_num: 40,
      },
    });
    expect(next.status).toBe("printing");
    expect(next.job).toMatchObject({
      name: "Benchy",
      progress: 25,
      remainingSeconds: 1800,
      layer: 10,
      totalLayers: 40,
      stage: "Printing",
    });
    expect(next.job.elapsedSeconds).toBe(600);
  });

  it("turns HMS entries and print errors into alerts", () => {
    const next = apply(full, {
      print: { hms: [{ attr: 50331904, code: 65543 }], print_error: 117473287 },
    });
    const codes = next.alerts.map((a) => a.code);
    expect(codes).toContain("HMS_0300_0100_0001_0007");
    expect(codes.some((c) => c.startsWith("PRINT_ERROR_"))).toBe(true);
    expect(next.alerts.find((a) => a.code.startsWith("HMS"))?.severity).toBe("error");
    const cleared = apply(next, { print: { hms: [], print_error: 0 } });
    expect(cleared.alerts).toEqual([]);
  });

  it("treats the user-cancel print_error as not an alert", () => {
    const next = apply(full, { print: { gcode_state: "FAILED", print_error: 50348044 } });
    expect(next.alerts).toEqual([]);
    expect(next.status).toBe("failed");
  });
});

describe("helpers", () => {
  it("formats HMS codes like the Bambu wiki", () => {
    expect(formatHmsCode(50331904, 65543)).toBe("HMS_0300_0100_0001_0007");
  });

  it("decodes tray_now", () => {
    expect(decodeTrayNow(255)).toEqual({ kind: "none" });
    expect(decodeTrayNow(254)).toEqual({ kind: "external" });
    expect(decodeTrayNow(5)).toEqual({ kind: "ams", unit: 1, slot: 1 });
    expect(decodeTrayNow(999)).toEqual({ kind: "unknown" });
  });
});
