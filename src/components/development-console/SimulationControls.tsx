"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { usePrinter, useRuntime } from "@/hooks/usePrinter";
import { SCENARIOS } from "@/printer/simulation/scenarios";
import { SIM_FAULTS, type SimFault } from "@/printer/simulation/simulation-engine";
import { formatDuration } from "@/lib/format";

const SPEEDS = [0, 1, 10, 30, 60, 120];

export function SimulationControls() {
  const runtime = useRuntime();
  const sim = usePrinter((s) => s.simulation);
  const status = usePrinter((s) => s.state.status);
  const [fault, setFault] = useState<SimFault>("filament_runout");
  const controls = runtime.provider.simulation;

  if (!controls || !sim) {
    return (
      <Panel title="Simulation">
        <p className="text-xs text-fg-muted">
          Simulation controls are only available with the simulated provider.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Simulation"
      testId="simulation-controls"
      actions={
        <span className="font-mono text-2xs text-fg-dim">
          sim t = {formatDuration(sim.simulatedTimeMs / 1000)}
        </span>
      }
    >
      <div className="flex flex-col gap-3 text-xs">
        <label className="flex items-center gap-2">
          <span className="w-20 text-fg-muted">Scenario</span>
          <select
            value={sim.scenarioId}
            onChange={(e) => controls.loadScenario(e.target.value)}
            className="h-8 flex-1 rounded-md border border-ink-600 bg-ink-850 px-2"
            data-testid="scenario-select"
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 text-fg-muted">Job</span>
          <Button
            variant="primary"
            onClick={() => void runtime.execute({ type: "start_sample_job" })}
            data-testid="sim-start"
          >
            Start
          </Button>
          <Button
            onClick={() => void runtime.execute({ type: "pause" })}
            data-testid="sim-pause"
            disabled={status !== "printing"}
          >
            Pause
          </Button>
          <Button
            onClick={() => void runtime.execute({ type: "resume" })}
            data-testid="sim-resume"
            disabled={status !== "paused"}
          >
            Resume
          </Button>
          <Button onClick={() => controls.completeJob()} data-testid="sim-complete">
            Complete
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 text-fg-muted">Speed</span>
          {SPEEDS.map((s) => (
            <Button
              key={s}
              variant={sim.speedMultiplier === s && sim.running ? "active" : "default"}
              onClick={() => {
                controls.setSpeedMultiplier(s);
                controls.setRunning(s > 0);
              }}
              data-testid={`sim-speed-${s}`}
            >
              {s === 0 ? "Pause sim" : `${s}×`}
            </Button>
          ))}
          <Button onClick={() => controls.stepBy(60_000)} data-testid="sim-step">
            +1 min
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 text-fg-muted">Fault</span>
          <select
            value={fault}
            onChange={(e) => setFault(e.target.value as SimFault)}
            className="h-8 flex-1 rounded-md border border-ink-600 bg-ink-850 px-2"
            data-testid="fault-select"
          >
            {SIM_FAULTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <Button
            variant="danger"
            onClick={() => controls.injectFault(fault)}
            data-testid="sim-inject"
          >
            Trigger
          </Button>
          <Button onClick={() => controls.clearAlerts()}>Clear alerts</Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 text-fg-muted">Network</span>
          <Button
            variant={sim.wifiUp ? "default" : "danger"}
            onClick={() => controls.setWifi(!sim.wifiUp)}
            data-testid="sim-wifi"
          >
            Wi-Fi {sim.wifiUp ? "up" : "down"}
          </Button>
          <Button
            variant={sim.mqttUp ? "default" : "danger"}
            onClick={() => controls.setMqtt(!sim.mqttUp)}
            data-testid="sim-mqtt"
          >
            MQTT {sim.mqttUp ? "up" : "down"}
          </Button>
          <Button
            variant={sim.telemetryFrozen ? "danger" : "default"}
            onClick={() => controls.setTelemetryFrozen(!sim.telemetryFrozen)}
            data-testid="sim-freeze"
          >
            {sim.telemetryFrozen ? "Telemetry frozen" : "Freeze telemetry"}
          </Button>
          <Button
            variant="primary"
            onClick={() => controls.restoreConnectivity()}
            data-testid="sim-restore"
          >
            Restore
          </Button>
        </div>

        <div className="flex justify-end">
          <Button variant="danger" onClick={() => controls.reset()} data-testid="sim-reset">
            Reset simulation
          </Button>
        </div>
      </div>
    </Panel>
  );
}
