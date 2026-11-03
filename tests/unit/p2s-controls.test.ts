import { describe, expect, it } from "vitest";
import {
  commandEffectObserved,
  validateCommand,
  type CommandType,
  type PrinterCommand,
} from "@/printer/commands";
import { buildBambuRequest, LAN_SUPPORTED_COMMANDS } from "@/printer/protocol/command-builders";
import { mergeTelemetry } from "@/printer/protocol/state-merge";
import { fanLevelToPercent, parseReport } from "@/printer/protocol/telemetry-parser";
import { SimulationEngine } from "@/printer/simulation/simulation-engine";
import { createUnknownState } from "@/printer/state";
import type { PrinterState, PrintStatus } from "@/printer/types";

const NOW = 1_000_000;
const ctx = { supported: LAN_SUPPORTED_COMMANDS as ReadonlySet<CommandType>, now: NOW };

function state(status: PrintStatus, overrides: Partial<PrinterState> = {}): PrinterState {
  const s = createUnknownState("live");
  return {
    ...s,
    status,
    connection: { ...s.connection, status: "connected", lastTelemetryAt: NOW },
    ...overrides,
  };
}

const gcodeOf = (cmd: PrinterCommand) =>
  (buildBambuRequest(cmd, "7").payload as { print: { command: string; param: string } }).print;

describe("fan telemetry", () => {
  it("converts Bambu's 0..15 fan levels to 10 % steps", () => {
    expect(fanLevelToPercent(0)).toBe(0);
    expect(fanLevelToPercent(15)).toBe(100);
    expect(fanLevelToPercent(10)).toBe(70);
    expect(fanLevelToPercent(99)).toBe(100);
  });

  it("parses the fan fields (string-encoded) into a patch", () => {
    const { patch, issues } = parseReport({
      print: {
        cooling_fan_speed: "15",
        big_fan1_speed: "0",
        big_fan2_speed: "8",
        heatbreak_fan_speed: "15",
      },
    });
    expect(issues).toEqual([]);
    expect(patch.fans).toEqual({ part: 100, aux: 0, chamber: 50, heatbreak: 100 });
  });

  it("merges partial fan reports without losing the other fans", () => {
    const a = mergeTelemetry(
      state("printing"),
      parseReport({ print: { cooling_fan_speed: "15", big_fan2_speed: "5" } }).patch,
      NOW,
    );
    const b = mergeTelemetry(a, parseReport({ print: { cooling_fan_speed: "0" } }).patch, NOW);
    expect(b.fans).toEqual({ part: 0, aux: null, chamber: 30, heatbreak: null });
    // Unrelated report keeps the fans object identity (narrow React re-renders).
    const c = mergeTelemetry(b, parseReport({ print: { mc_percent: 5 } }).patch, NOW);
    expect(c.fans).toBe(b.fans);
  });
});

describe("set_fan", () => {
  it("validates the range", () => {
    expect(
      validateCommand({ type: "set_fan", fan: "part", percent: 50 }, state("printing"), ctx),
    ).toEqual({ ok: true });
    expect(
      validateCommand({ type: "set_fan", fan: "part", percent: 101 }, state("idle"), ctx).ok,
    ).toBe(false);
    expect(
      validateCommand({ type: "set_fan", fan: "aux", percent: 12.5 }, state("idle"), ctx).ok,
    ).toBe(false);
  });

  it("builds M106 with the P1 fan index and a 0..255 value", () => {
    expect(gcodeOf({ type: "set_fan", fan: "part", percent: 100 })).toMatchObject({
      command: "gcode_line",
      param: "M106 P1 S255\n",
    });
    expect(gcodeOf({ type: "set_fan", fan: "aux", percent: 50 }).param).toBe("M106 P2 S128\n");
    expect(gcodeOf({ type: "set_fan", fan: "chamber", percent: 0 }).param).toBe("M106 P3 S0\n");
  });

  it("is observed when the reported step is within 10 %", () => {
    const s = state("printing", { fans: { part: 70, aux: null, chamber: null, heatbreak: null } });
    expect(commandEffectObserved({ type: "set_fan", fan: "part", percent: 75 }, s)).toBe(true);
    expect(commandEffectObserved({ type: "set_fan", fan: "part", percent: 30 }, s)).toBe(false);
    expect(commandEffectObserved({ type: "set_fan", fan: "aux", percent: 0 }, s)).toBe(false);
  });
});

describe("motion commands", () => {
  const move: PrinterCommand = { type: "move_axis", axis: "X", distanceMm: 10 };

  it("are locked while a job is active", () => {
    for (const s of ["printing", "paused", "preparing"] as const) {
      expect(validateCommand(move, state(s), ctx)).toEqual({
        ok: false,
        reason: "Axes are locked while printing",
      });
      expect(validateCommand({ type: "home_axes" }, state(s), ctx).ok).toBe(false);
    }
    expect(validateCommand(move, state("idle"), ctx)).toEqual({ ok: true });
    expect(validateCommand({ type: "home_axes" }, state("finished"), ctx)).toEqual({ ok: true });
  });

  it("rejects zero and oversized jogs", () => {
    expect(
      validateCommand({ ...move, distanceMm: 0 } as PrinterCommand, state("idle"), ctx).ok,
    ).toBe(false);
    expect(
      validateCommand({ ...move, distanceMm: 51 } as PrinterCommand, state("idle"), ctx).ok,
    ).toBe(false);
  });

  it("refuses cold extrusion", () => {
    const cold = state("idle", { nozzle: { current: 25, target: 0 } });
    const hot = state("idle", { nozzle: { current: 220, target: 220 } });
    expect(validateCommand({ type: "extrude", distanceMm: 10 }, cold, ctx)).toEqual({
      ok: false,
      reason: "Heat the nozzle to 170 °C first",
    });
    expect(validateCommand({ type: "extrude", distanceMm: -10 }, hot, ctx)).toEqual({ ok: true });
  });

  it("builds the Bambu Studio jog sequence in relative mode", () => {
    const p = gcodeOf({ type: "move_axis", axis: "Z", distanceMm: -1 }).param;
    expect(p).toContain("G91");
    expect(p).toContain("G1 Z-1.0 F600\n");
    expect(p.indexOf("push_ref_mode")).toBeLessThan(p.indexOf("pop_ref_mode"));
    expect(gcodeOf({ type: "move_axis", axis: "Y", distanceMm: 10 }).param).toContain(
      "G1 Y10.0 F3000\n",
    );
    expect(gcodeOf({ type: "home_axes" }).param).toBe("G28\n");
    expect(gcodeOf({ type: "extrude", distanceMm: -10 }).param).toBe("M83 \nG0 E-10.0 F900\n");
  });
});

describe("simulated fans", () => {
  it("run while printing and honour manual overrides", () => {
    const engine = new SimulationEngine("mid-print");
    expect(engine.snapshot().fans.part).toBe(100);
    engine.apply({ type: "set_fan", fan: "part", percent: 40 });
    expect(engine.snapshot().fans.part).toBe(40);
    engine.load("standard");
    expect(engine.snapshot().fans).toMatchObject({ part: 0, aux: 0, chamber: 0 });
  });
});
