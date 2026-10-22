import { describe, expect, it } from "vitest";
import { validateCommand, type CommandType, type PrinterCommand } from "@/printer/commands";
import { buildBambuRequest, LAN_SUPPORTED_COMMANDS } from "@/printer/protocol/command-builders";
import { createUnknownState, deriveDisplayStatus } from "@/printer/state";
import type { PrinterState, PrintStatus } from "@/printer/types";

const ALL: ReadonlySet<CommandType> = new Set<CommandType>([
  "pause",
  "resume",
  "stop",
  "set_speed",
  "set_nozzle_target",
  "set_bed_target",
  "set_chamber_light",
  "request_full_status",
  "start_sample_job",
]);
const NOW = 1_000_000;

function state(status: PrintStatus, overrides: Partial<PrinterState> = {}): PrinterState {
  const s = createUnknownState("simulated");
  return {
    ...s,
    status,
    connection: { ...s.connection, status: "connected", lastTelemetryAt: NOW },
    ...overrides,
  };
}

const ctx = { supported: ALL, now: NOW };

describe("validateCommand", () => {
  it("rejects unsupported commands", () => {
    const r = validateCommand({ type: "start_sample_job" }, state("idle"), {
      ...ctx,
      supported: LAN_SUPPORTED_COMMANDS,
    });
    expect(r).toEqual({ ok: false, reason: "Not supported by this connection" });
  });

  it("rejects everything while offline", () => {
    const offline = {
      ...state("printing"),
      connection: { ...state("printing").connection, status: "disconnected" as const },
    };
    expect(validateCommand({ type: "pause" }, offline, ctx).ok).toBe(false);
  });

  it("rejects commands on stale telemetry except a status refresh", () => {
    const stale = state("printing");
    const later = { ...ctx, now: NOW + 60_000 };
    expect(validateCommand({ type: "pause" }, stale, later)).toEqual({
      ok: false,
      reason: "Printer state is stale",
    });
    expect(validateCommand({ type: "request_full_status" }, stale, later).ok).toBe(true);
  });

  it("only pauses running prints and only resumes paused ones", () => {
    expect(validateCommand({ type: "pause" }, state("printing"), ctx).ok).toBe(true);
    expect(validateCommand({ type: "pause" }, state("idle"), ctx).ok).toBe(false);
    expect(validateCommand({ type: "resume" }, state("paused"), ctx).ok).toBe(true);
    expect(validateCommand({ type: "resume" }, state("printing"), ctx).ok).toBe(false);
  });

  it("requires explicit confirmation to stop", () => {
    const unconfirmed = { type: "stop", confirmed: false } as unknown as PrinterCommand;
    expect(validateCommand(unconfirmed, state("printing"), ctx)).toEqual({
      ok: false,
      reason: "Stopping requires confirmation",
    });
    expect(
      validateCommand({ type: "stop" } as unknown as PrinterCommand, state("printing"), ctx).ok,
    ).toBe(false);
    expect(validateCommand({ type: "stop", confirmed: true }, state("printing"), ctx).ok).toBe(
      true,
    );
    expect(validateCommand({ type: "stop", confirmed: true }, state("idle"), ctx).ok).toBe(false);
  });

  it("bounds temperature targets to P1S limits", () => {
    expect(
      validateCommand({ type: "set_nozzle_target", celsius: 300 }, state("idle"), ctx).ok,
    ).toBe(true);
    expect(
      validateCommand({ type: "set_nozzle_target", celsius: 301 }, state("idle"), ctx).ok,
    ).toBe(false);
    expect(validateCommand({ type: "set_bed_target", celsius: 101 }, state("idle"), ctx).ok).toBe(
      false,
    );
    expect(validateCommand({ type: "set_bed_target", celsius: -5 }, state("idle"), ctx).ok).toBe(
      false,
    );
    expect(validateCommand({ type: "set_bed_target", celsius: 60.5 }, state("idle"), ctx).ok).toBe(
      false,
    );
  });

  it("allows speed changes only during a print", () => {
    expect(validateCommand({ type: "set_speed", level: 3 }, state("printing"), ctx).ok).toBe(true);
    expect(validateCommand({ type: "set_speed", level: 3 }, state("idle"), ctx).ok).toBe(false);
  });
});

describe("deriveDisplayStatus", () => {
  it("prioritizes connectivity, freshness and errors", () => {
    const s = state("printing");
    expect(
      deriveDisplayStatus({ ...s, connection: { ...s.connection, status: "disconnected" } }, NOW),
    ).toBe("disconnected");
    expect(
      deriveDisplayStatus({ ...s, connection: { ...s.connection, status: "connecting" } }, NOW),
    ).toBe("connecting");
    expect(deriveDisplayStatus(s, NOW + 60_000)).toBe("stale");
    expect(
      deriveDisplayStatus(
        { ...s, alerts: [{ id: "a", severity: "error", code: "X", message: "m", at: 0 }] },
        NOW,
      ),
    ).toBe("error");
    expect(deriveDisplayStatus(s, NOW)).toBe("printing");
  });
});

describe("buildBambuRequest", () => {
  it("builds verified payloads", () => {
    expect(buildBambuRequest({ type: "pause" }, "5")).toEqual({
      qos: 1,
      payload: { print: { sequence_id: "5", command: "pause", param: "" } },
    });
    expect(buildBambuRequest({ type: "set_speed", level: 4 }, "6").payload.print).toMatchObject({
      command: "print_speed",
      param: "4",
    });
    expect(
      buildBambuRequest({ type: "set_nozzle_target", celsius: 215 }, "7").payload.print,
    ).toMatchObject({ command: "gcode_line", param: "M104 S215\n" });
    expect(
      buildBambuRequest({ type: "set_bed_target", celsius: 60 }, "8").payload.print,
    ).toMatchObject({ param: "M140 S60\n" });
    expect(buildBambuRequest({ type: "request_full_status" }, "9").payload.pushing).toMatchObject({
      command: "pushall",
    });
    expect(
      buildBambuRequest({ type: "set_chamber_light", on: false }, "10").payload.system,
    ).toMatchObject({ command: "ledctrl", led_mode: "off" });
  });

  it("refuses commands without a verified payload", () => {
    expect(() => buildBambuRequest({ type: "start_sample_job" }, "1")).toThrow(/No verified/);
  });
});
