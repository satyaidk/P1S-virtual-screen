import { describe, expect, it } from "vitest";
import pushall from "../fixtures/p1s-pushall.json";
import {
  mapGcodeState,
  normalizeTrayColor,
  parseReport,
  parseWifiSignal,
} from "@/printer/protocol/telemetry-parser";

describe("parseReport", () => {
  it("parses the documented pushall report", () => {
    const { ok, patch, issues } = parseReport(pushall);
    expect(ok).toBe(true);
    expect(issues).toEqual([]);
    expect(patch.status).toBe("idle");
    expect(patch.nozzleCurrent).toBe(25);
    expect(patch.bedTarget).toBe(25);
    expect(patch.speedLevel).toBe(2);
    expect(patch.wifiSignalDbm).toBe(-45);
    expect(patch.chamberLight).toBe(true);
    expect(patch.jobName).toBeNull();
    expect(patch.startedAt).toBeNull();
    expect(patch.stageId).toBeNull();
    expect(patch.ams?.trayNow).toBe(255);
    expect(patch.ams?.trayExistBits).toBe(0xe);
    const trays = patch.ams?.units?.[0]?.trays ?? [];
    expect(trays[0]).toEqual({ slot: 0, empty: true });
    expect(trays[1]?.material).toBe("PLA");
    expect(trays[1]?.color).toBe("#000000");
    expect(trays[3]?.remainPercent).toBeNull(); // -1 = unknown
    expect(patch.externalSpool?.empty).toBe(true);
  });

  it("accepts JSON strings and rejects malformed JSON", () => {
    expect(parseReport('{"print":{"mc_percent":"42"}}').patch.progress).toBe(42);
    const bad = parseReport("{not json");
    expect(bad.ok).toBe(false);
    expect(bad.issues[0]?.message).toBe("invalid JSON");
  });

  it("drops invalid fields individually and keeps valid ones", () => {
    const { patch, issues } = parseReport({
      print: { nozzle_temper: "hot", bed_temper: 60.5, spd_lvl: 9, mc_percent: 12 },
    });
    expect(patch.nozzleCurrent).toBeUndefined();
    expect(patch.speedLevel).toBeUndefined();
    expect(patch.bedCurrent).toBe(60.5);
    expect(patch.progress).toBe(12);
    expect(issues.map((i) => i.path).sort()).toEqual(["print.nozzle_temper", "print.spd_lvl"]);
  });

  it("reports ignored keys without failing", () => {
    const { ignoredKeys } = parseReport({ print: { some_new_field: 1, mc_percent: 1 } });
    expect(ignoredKeys).toContain("some_new_field");
  });

  it("extracts command acknowledgements", () => {
    const { ack } = parseReport({
      print: { command: "pause", sequence_id: "7", result: "SUCCESS", reason: "" },
    });
    expect(ack).toEqual({
      envelope: "print",
      command: "pause",
      sequenceId: "7",
      result: "success",
      reason: null,
    });
  });

  it("reads firmware from info.get_version", () => {
    const { patch } = parseReport({
      info: {
        command: "get_version",
        module: [
          { name: "ota", sw_ver: "01.08.02.00" },
          { name: "mc", sw_ver: "x" },
        ],
      },
    });
    expect(patch.firmware).toBe("01.08.02.00");
  });

  it("converts remaining minutes and start time", () => {
    const { patch } = parseReport({
      print: { mc_remaining_time: 90, gcode_start_time: "1700000000" },
    });
    expect(patch.remainingSeconds).toBe(5400);
    expect(patch.startedAt).toBe(1_700_000_000_000);
  });
});

describe("value helpers", () => {
  it("maps gcode states", () => {
    expect(mapGcodeState("RUNNING")).toBe("printing");
    expect(mapGcodeState("PAUSE")).toBe("paused");
    expect(mapGcodeState("PREPARE")).toBe("preparing");
    expect(mapGcodeState("FINISH")).toBe("finished");
    expect(mapGcodeState("FAILED")).toBe("failed");
    expect(mapGcodeState("SOMETHING")).toBe("unknown");
  });

  it("normalizes colours and wifi", () => {
    expect(normalizeTrayColor("F95959FF")).toBe("#F95959");
    expect(normalizeTrayColor("00000000")).toBeNull();
    expect(parseWifiSignal("-61dBm")).toBe(-61);
    expect(parseWifiSignal("weak")).toBeNull();
  });
});
