import { describe, expect, it } from "vitest";
import { SimulationEngine } from "@/printer/simulation/simulation-engine";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

function runUntil(engine: SimulationEngine, predicate: () => boolean, maxMs = 3 * 60 * MINUTE) {
  let elapsed = 0;
  while (!predicate() && elapsed < maxMs) {
    engine.step(SECOND);
    elapsed += SECOND;
  }
  return elapsed;
}

describe("SimulationEngine", () => {
  it("starts idle at ambient temperature with AMS data", () => {
    const e = new SimulationEngine("standard");
    const s = e.snapshot();
    expect(s.status).toBe("idle");
    expect(s.nozzle.current).toBe(24);
    expect(s.job.name).toBeNull();
    expect(s.ams.units?.[0]?.trays).toHaveLength(4);
  });

  it("runs a full job: preparing -> printing -> finished", () => {
    const e = new SimulationEngine("standard");
    expect(e.apply({ type: "start_sample_job" }).ok).toBe(true);
    expect(e.snapshot().status).toBe("preparing");
    expect(e.snapshot().job.stage).toBe("Heatbed preheating");

    runUntil(e, () => e.snapshot().status === "printing");
    const atStart = e.snapshot();
    expect(atStart.status).toBe("printing");
    expect(atStart.nozzle.current).toBeGreaterThanOrEqual(218);
    expect(atStart.bed.current).toBeGreaterThanOrEqual(53);

    e.step(10 * MINUTE);
    const mid = e.snapshot();
    expect(mid.job.progress).toBeGreaterThan(atStart.job.progress ?? 0);
    expect(mid.job.elapsedSeconds).toBe(600);
    // Elapsed + remaining add up to the job duration at standard speed.
    expect((mid.job.elapsedSeconds ?? 0) + (mid.job.remainingSeconds ?? 0)).toBe(42 * 60);
    expect(mid.job.layer).toBeGreaterThan(1);

    runUntil(e, () => e.snapshot().status === "finished");
    const done = e.snapshot();
    expect(done.status).toBe("finished");
    expect(done.job.progress).toBe(100);
    expect(done.job.remainingSeconds).toBe(0);
    expect(done.nozzle.target).toBe(0);
    // Filament on the active tray was consumed.
    expect(done.ams.units?.[0]?.trays[0]?.remainPercent).toBeLessThan(82);
  });

  it("freezes progress and elapsed print time while paused", () => {
    const e = new SimulationEngine("mid-print");
    expect(e.apply({ type: "pause" }).ok).toBe(true);
    const paused = e.snapshot();
    e.step(5 * MINUTE);
    const later = e.snapshot();
    expect(later.status).toBe("paused");
    expect(later.job.progress).toBe(paused.job.progress);
    expect(later.job.elapsedSeconds).toBe(paused.job.elapsedSeconds);

    expect(e.apply({ type: "resume" }).ok).toBe(true);
    e.step(MINUTE);
    expect(e.snapshot().job.elapsedSeconds).toBe((paused.job.elapsedSeconds ?? 0) + 60);
  });

  it("models temperature independently of print progress", () => {
    const e = new SimulationEngine("standard");
    e.apply({ type: "set_nozzle_target", celsius: 200 });
    e.step(30 * SECOND);
    const s = e.snapshot();
    expect(s.status).toBe("idle");
    expect(s.nozzle.current).toBeGreaterThan(150);
    expect(s.job.progress).toBeNull();
  });

  it("speed presets change progress rate", () => {
    const slow = new SimulationEngine("mid-print");
    const fast = new SimulationEngine("mid-print");
    slow.apply({ type: "set_speed", level: 1 });
    fast.apply({ type: "set_speed", level: 4 });
    slow.step(5 * MINUTE);
    fast.step(5 * MINUTE);
    expect(fast.snapshot().job.progress).toBeGreaterThan(slow.snapshot().job.progress ?? 0);
  });

  it("cancels into the failed state with the user-cancel code", () => {
    const e = new SimulationEngine("mid-print");
    expect(e.apply({ type: "stop", confirmed: true }).ok).toBe(true);
    const s = e.snapshot();
    expect(s.status).toBe("failed");
    expect(s.printErrorCode).toBe(50348044);
    expect(s.alerts).toEqual([]);
    expect(s.nozzle.target).toBe(0);
  });

  it("filament runout pauses with a warning; resume clears it", () => {
    const e = new SimulationEngine("mid-print");
    expect(e.injectFault("filament_runout", 0)).toBe(true);
    expect(e.snapshot().status).toBe("paused");
    expect(e.snapshot().job.stage).toBe("Filament runout");
    expect(e.snapshot().alerts[0]?.severity).toBe("warning");
    e.apply({ type: "resume" });
    expect(e.snapshot().alerts).toEqual([]);
  });

  it("heater fault fails the print with an error alert", () => {
    const e = new SimulationEngine("mid-print");
    e.injectFault("nozzle_heater_fault", 0);
    expect(e.snapshot().status).toBe("failed");
    expect(e.snapshot().alerts[0]?.severity).toBe("error");
  });

  it("can reject or ignore the next command", () => {
    const e = new SimulationEngine("mid-print");
    e.injectFault("reject_next_command", 0);
    expect(e.apply({ type: "pause" }).ok).toBe(false);
    e.injectFault("ignore_next_command", 0);
    expect(e.apply({ type: "pause" }).ok).toBe(true);
    expect(e.snapshot().status).toBe("printing");
  });

  it("is deterministic", () => {
    const a = new SimulationEngine("standard");
    const b = new SimulationEngine("standard");
    for (const e of [a, b]) {
      e.apply({ type: "start_sample_job" });
      for (let i = 0; i < 500; i++) e.step(733);
    }
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it("represents sparse telemetry as unknown", () => {
    const e = new SimulationEngine("sparse");
    e.apply({ type: "start_sample_job" });
    runUntil(e, () => e.snapshot().status === "printing");
    const s = e.snapshot();
    expect(s.job.remainingSeconds).toBeNull();
    expect(s.job.totalLayers).toBeNull();
    expect(s.info.firmware).toBeNull();
    expect(s.wifiSignalDbm).toBeNull();
    expect(s.ams.units?.[0]?.trays[0]?.color).toBeNull();
  });
});
