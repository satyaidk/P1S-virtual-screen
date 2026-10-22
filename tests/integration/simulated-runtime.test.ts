import { afterEach, describe, expect, it } from "vitest";
import { SimulatedPrinterProvider } from "@/printer/providers/SimulatedPrinterProvider";
import { PrinterRuntime } from "@/printer/runtime";
import { ManualClock } from "@/printer/simulation/clock";
import { deriveDisplayStatus } from "@/printer/state";
import { advance, flush } from "./helpers";

let runtime: PrinterRuntime | null = null;

async function setup(scenarioId = "standard") {
  const clock = new ManualClock();
  const provider = new SimulatedPrinterProvider({
    clock,
    scenarioId,
    tickMs: 100,
    speedMultiplier: 20,
    commandLatencyMs: 100,
    connectDelayMs: 200,
  });
  runtime = new PrinterRuntime(provider, { clock, commandTimeoutMs: 3000 });
  await runtime.start();
  await advance(clock, 300);
  return { clock, provider, runtime };
}

afterEach(() => {
  runtime?.dispose();
  runtime = null;
});

describe("simulated provider + runtime", () => {
  it("starts without credentials and connects", async () => {
    const { runtime } = await setup();
    const { state } = runtime.getSnapshot();
    expect(state.connection.status).toBe("connected");
    expect(state.source).toBe("simulated");
    expect(state.status).toBe("idle");
  });

  it("starts and completes a print through the command path", async () => {
    const { clock, runtime, provider } = await setup();
    const req = runtime.execute({ type: "start_sample_job" });
    await advance(clock, 400);
    expect((await req).status).toBe("succeeded");
    expect(["preparing", "printing"]).toContain(runtime.getSnapshot().state.status);

    const temps0 = runtime.getSnapshot().state.nozzle.current ?? 0;
    await advance(clock, 2000);
    expect(runtime.getSnapshot().state.nozzle.current ?? 0).toBeGreaterThan(temps0);

    expect(provider.simulation.completeJob()).toBe(true);
    await flush();
    expect(runtime.getSnapshot().state.status).toBe("finished");
    const statusEvents = runtime
      .getSnapshot()
      .events.filter((e) => e.category === "state")
      .map((e) => e.message);
    expect(statusEvents).toContain("Print status idle → preparing");
    expect(statusEvents.at(-1)).toMatch(/→ finished$/);
  });

  it("pause is confirmed by observed state, not by the ack alone", async () => {
    const { clock, runtime } = await setup("mid-print");
    const p = runtime.execute({ type: "pause" });
    await flush();
    expect(runtime.commands.isPending("pause")).toBe(true);
    await advance(clock, 300);
    const done = await p;
    expect(done.status).toBe("succeeded");
    expect(runtime.getSnapshot().state.status).toBe("paused");

    const frozen = runtime.getSnapshot().state.job.progress;
    await advance(clock, 2000);
    expect(runtime.getSnapshot().state.job.progress).toBe(frozen);
  });

  it("reports a timeout when the printer acks but does nothing", async () => {
    const { clock, runtime, provider } = await setup("mid-print");
    provider.simulation.injectFault("ignore_next_command");
    const p = runtime.execute({ type: "pause" });
    await advance(clock, 3500);
    const done = await p;
    expect(done.status).toBe("timeout");
    expect(done.message).toMatch(/did not act/);
  });

  it("reports a failure when the printer rejects a command", async () => {
    const { clock, runtime, provider } = await setup("mid-print");
    provider.simulation.injectFault("reject_next_command");
    const p = runtime.execute({ type: "pause" });
    await advance(clock, 300);
    expect((await p).status).toBe("failed");
  });

  it("rejects invalid and duplicate commands before sending", async () => {
    const { clock, runtime } = await setup();
    expect((await runtime.execute({ type: "resume" })).status).toBe("rejected");
    const first = runtime.execute({ type: "set_bed_target", celsius: 60 });
    const dup = await runtime.execute({ type: "set_bed_target", celsius: 60 });
    expect(dup.status).toBe("rejected");
    expect(dup.message).toBe("Already in progress");
    await advance(clock, 300);
    expect((await first).status).toBe("succeeded");
  });

  it("handles Wi-Fi loss and reconnection", async () => {
    const { clock, runtime, provider } = await setup("mid-print");
    provider.simulation.setWifi(false);
    await flush();
    const s = runtime.getSnapshot().state;
    expect(s.connection.status).toBe("disconnected");
    expect(s.connection.lastError).toBe("Wi-Fi unavailable");
    const progressWhileOffline = s.job.progress;
    await advance(clock, 2000);
    // No telemetry reaches the display while offline.
    expect(runtime.getSnapshot().state.job.progress).toBe(progressWhileOffline);
    expect((await runtime.execute({ type: "pause" })).status).toBe("rejected");

    provider.simulation.setWifi(true);
    await flush();
    expect(runtime.getSnapshot().state.connection.status).toBe("connecting");
    await advance(clock, 300);
    expect(runtime.getSnapshot().state.connection.status).toBe("connected");
    const messages = runtime.getSnapshot().events.map((e) => e.message);
    expect(messages.some((m) => m.includes("connected → disconnected"))).toBe(true);
    expect(messages.some((m) => m.includes("connecting → connected"))).toBe(true);
  });

  it("detects stale telemetry", async () => {
    const { clock, runtime, provider } = await setup("mid-print");
    provider.simulation.setTelemetryFrozen(true);
    await advance(clock, 16_000, 1000);
    const { state } = runtime.getSnapshot();
    expect(deriveDisplayStatus(state, clock.now(), runtime.staleAfterMs)).toBe("stale");
    provider.simulation.setTelemetryFrozen(false);
    await flush();
    expect(
      deriveDisplayStatus(runtime.getSnapshot().state, clock.now(), runtime.staleAfterMs),
    ).toBe("printing");
  });

  it("records telemetry change history and keeps unchanged branches stable", async () => {
    const { clock, runtime } = await setup();
    const amsBefore = runtime.getSnapshot().state.ams;
    await advance(clock, 500);
    expect(runtime.getSnapshot().state.ams).toBe(amsBefore);
    runtime.execute({ type: "set_nozzle_target", celsius: 200 });
    await advance(clock, 500);
    const recent = runtime.getSnapshot().telemetry.flatMap((t) => t.changed);
    expect(recent).toContain("nozzle.target");
  });
});
