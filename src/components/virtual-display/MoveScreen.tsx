"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  House,
  type LucideIcon,
} from "lucide-react";
import { useDisplayStore } from "@/display/display-store";
import { usePrinter, useRuntime, useCommandValidation } from "@/hooks/usePrinter";
import type { Axis, PrinterCommand } from "@/printer/commands";
import { JOG_STEPS_MM } from "@/printer/state";
import { TouchButton, SubHeader } from "./primitives";
import { ScreenStatusBanner } from "./ScreenStatusBanner";

const EXTRUDE_MM = 10;

/**
 * Axis jog / home / extruder, like the P2S "Control → Move" panel. Locked while a job runs (the
 * same validateCommand rule the command manager enforces). Moves are relative and never retried.
 */
export function MoveScreen({ now }: { now: number }) {
  const back = useDisplayStore((s) => s.back);
  const [step, setStep] = useState<number>(JOG_STEPS_MM[1] ?? 10);
  const busy = usePrinter((s) =>
    s.requests.some(
      (r) =>
        r.status === "pending" &&
        (r.command.type === "move_axis" ||
          r.command.type === "home_axes" ||
          r.command.type === "extrude"),
    ),
  );
  const moveValid = useCommandValidation({ type: "move_axis", axis: "X", distanceMm: step }, now);
  const extrudeValid = useCommandValidation({ type: "extrude", distanceMm: EXTRUDE_MM }, now);
  const hint = !moveValid.ok ? moveValid.reason : !extrudeValid.ok ? extrudeValid.reason : null;

  const jog = (axis: Axis, sign: 1 | -1): PrinterCommand => ({
    type: "move_axis",
    axis,
    distanceMm: sign * step,
  });

  return (
    <div className="flex h-full flex-col">
      <SubHeader
        title="Move axes"
        onBack={back}
        right={
          <div className="flex gap-1" role="radiogroup" aria-label="Step size">
            {JOG_STEPS_MM.map((mm) => (
              <button
                key={mm}
                type="button"
                role="radio"
                aria-checked={step === mm}
                onClick={() => setStep(mm)}
                data-testid={`step-${mm}`}
                className={
                  "touch h-6 rounded border px-2 text-2xs font-semibold tabular " +
                  (step === mm ? "border-info bg-info-soft" : "border-ink-600 bg-ink-800")
                }
              >
                {mm} mm
              </button>
            ))}
          </div>
        }
      />
      <ScreenStatusBanner now={now} />
      <div className="flex min-h-0 flex-1 gap-2 px-2 pt-1.5">
        <div className="grid grid-cols-3 grid-rows-3 gap-1" aria-label="X and Y">
          <span />
          <Jog icon={ArrowUp} label="Y+" cmd={jog("Y", 1)} disabled={!moveValid.ok || busy} />
          <span />
          <Jog icon={ArrowLeft} label="X−" cmd={jog("X", -1)} disabled={!moveValid.ok || busy} />
          <Jog
            icon={House}
            label="Home"
            cmd={{ type: "home_axes" }}
            disabled={!moveValid.ok || busy}
            testId="home-axes"
          />
          <Jog icon={ArrowRight} label="X+" cmd={jog("X", 1)} disabled={!moveValid.ok || busy} />
          <span />
          <Jog icon={ArrowDown} label="Y−" cmd={jog("Y", -1)} disabled={!moveValid.ok || busy} />
          <span />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-center text-2xs text-fg-dim">Bed (Z)</span>
          <Jog icon={ChevronsUp} label="Z−" cmd={jog("Z", -1)} disabled={!moveValid.ok || busy} />
          <Jog icon={ChevronsDown} label="Z+" cmd={jog("Z", 1)} disabled={!moveValid.ok || busy} />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-center text-2xs text-fg-dim">Extruder</span>
          <Jog
            icon={ArrowDown}
            label="Extrude"
            cmd={{ type: "extrude", distanceMm: EXTRUDE_MM }}
            disabled={!extrudeValid.ok || busy}
            testId="extrude"
          />
          <Jog
            icon={ArrowUp}
            label="Retract"
            cmd={{ type: "extrude", distanceMm: -EXTRUDE_MM }}
            disabled={!extrudeValid.ok || busy}
            testId="retract"
          />
        </div>
      </div>
      <p
        className="h-4 shrink-0 px-2 pb-1 text-center text-2xs text-fg-dim"
        data-testid="move-hint"
      >
        {hint ?? `Bed ↑ = Z−. Extruder moves ${EXTRUDE_MM} mm.`}
      </p>
    </div>
  );
}

function Jog({
  icon,
  label,
  cmd,
  disabled,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  cmd: PrinterCommand;
  disabled: boolean;
  testId?: string;
}) {
  const runtime = useRuntime();
  return (
    <TouchButton
      icon={icon}
      aria-label={label}
      disabled={disabled}
      className="h-[34px] min-h-0 w-full min-w-[44px] gap-0.5 px-1 text-2xs"
      onClick={() => void runtime.execute(cmd)}
      data-testid={
        testId ?? `jog-${label.replace("−", "minus").replace("+", "plus").toLowerCase()}`
      }
    >
      {label === "Home" ? null : label}
    </TouchButton>
  );
}
