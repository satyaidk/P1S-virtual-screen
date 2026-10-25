"use client";

import { useState, type ReactNode } from "react";
import { Button, Segmented } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/field";
import { Panel } from "@/components/ui/Panel";
import { usePrinter, useRuntime } from "@/hooks/usePrinter";
import { cn } from "@/lib/cn";
import { SCENARIOS } from "@/printer/simulation/scenarios";
import { SIM_FAULTS, type SimFault } from "@/printer/simulation/simulation-engine";
import { formatDuration } from "@/lib/format";

const SPEEDS = [0, 1, 10, 30, 60, 120];

const selectClass = cn(fieldClass, "w-full");

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

export function SimulationControls() {
  const runtime = useRuntime();
  const sim = usePrinter((s) => s.simulation);
  const status = usePrinter((s) => s.state.status);
  const [fault, setFault] = useState<SimFault>("filament_runout");
  const controls = runtime.provider.simulation;

  if (!controls || !sim) {
    return (
      <Panel title="Demo printer">
        <p className="text-[13px] text-fg-muted">
          Simulation controls are only available with the demo printer.
        </p>
      </Panel>
    );
  }

  const speed = sim.running ? sim.speedMultiplier : 0;

  return (
    <Panel
      title="Demo printer"
      description="Drive the simulator to see each screen state."
      testId="simulation-controls"
      actions={
        <span className="tabular font-mono text-[12px] text-fg-muted" title="Simulated time">
          {formatDuration(sim.simulatedTimeMs / 1000)}
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <Group label="Scenario">
          <select
            value={sim.scenarioId}
            onChange={(e) => controls.loadScenario(e.target.value)}
            className={selectClass}
            data-testid="scenario-select"
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Group>

        <Group label="Print job">
          <div className="flex flex-wrap gap-1.5">
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
              Finish now
            </Button>
          </div>
        </Group>

        <Group label="Simulation speed">
          <div className="flex flex-wrap items-center gap-1.5">
            <Segmented
              label="Simulation speed"
              value={speed}
              onChange={(s) => {
                controls.setSpeedMultiplier(s);
                controls.setRunning(s > 0);
              }}
              items={SPEEDS.map((s) => ({
                value: s,
                label: s === 0 ? "Stop" : `${s}×`,
                testId: `sim-speed-${s}`,
              }))}
            />
            <Button variant="ghost" onClick={() => controls.stepBy(60_000)} data-testid="sim-step">
              +1 min
            </Button>
          </div>
        </Group>

        <Group label="Fault">
          <div className="flex gap-1.5">
            <select
              value={fault}
              onChange={(e) => setFault(e.target.value as SimFault)}
              className={selectClass}
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
          </div>
          <Button
            variant="ghost"
            className="-ml-3 self-start"
            onClick={() => controls.clearAlerts()}
          >
            Clear alerts
          </Button>
        </Group>

        <Group label="Network">
          <div className="flex flex-wrap gap-1.5">
            <Toggle on={sim.wifiUp} onClick={() => controls.setWifi(!sim.wifiUp)} testId="sim-wifi">
              Wi-Fi {sim.wifiUp ? "up" : "down"}
            </Toggle>
            <Toggle on={sim.mqttUp} onClick={() => controls.setMqtt(!sim.mqttUp)} testId="sim-mqtt">
              MQTT {sim.mqttUp ? "up" : "down"}
            </Toggle>
            <Toggle
              on={!sim.telemetryFrozen}
              onClick={() => controls.setTelemetryFrozen(!sim.telemetryFrozen)}
              testId="sim-freeze"
            >
              {sim.telemetryFrozen ? "Telemetry frozen" : "Telemetry live"}
            </Toggle>
          </div>
          <Button
            variant="ghost"
            className="-ml-3 self-start"
            onClick={() => controls.restoreConnectivity()}
            data-testid="sim-restore"
          >
            Restore all connections
          </Button>
        </Group>

        <div className="border-t border-line pt-3">
          <Button variant="danger" onClick={() => controls.reset()} data-testid="sim-reset">
            Reset simulation
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/** On/off switch-button: the dot shows the current state, the label names it. */
function Toggle({
  on,
  onClick,
  testId,
  children,
}: {
  on: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Button
      onClick={onClick}
      data-testid={testId}
      className={cn(!on && "border-danger/60 bg-danger-soft")}
    >
      <span aria-hidden className={cn("size-2 rounded-full", on ? "bg-ok" : "bg-danger")} />
      {children}
    </Button>
  );
}
