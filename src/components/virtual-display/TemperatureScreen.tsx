"use client";

import { useState } from "react";
import { Flame, Minus, Plus, Snowflake, Check } from "lucide-react";
import { usePrinter, useRuntime, useCommandValidation } from "@/hooks/usePrinter";
import { formatTemp } from "@/lib/format";
import { cn } from "@/lib/cn";
import { BED_MAX_C, NOZZLE_MAX_C } from "@/printer/state";
import type { Temperature } from "@/printer/types";
import { BedIcon } from "./icons";
import { TouchButton } from "./primitives";
import { ScreenStatusBanner } from "./ScreenStatusBanner";

const STEP = 5;

type Heater = "nozzle" | "bed";

/**
 * Targets are edited as a local draft and applied explicitly, so stepping through values does
 * not flood the printer with commands (matters on the P1's constrained MQTT link).
 */
export function TemperatureScreen({ now }: { now: number }) {
  const runtime = useRuntime();
  const nozzle = usePrinter((s) => s.state.nozzle);
  const bed = usePrinter((s) => s.state.bed);
  const pendingNozzle = usePrinter((s) =>
    s.requests.some((r) => r.status === "pending" && r.command.type === "set_nozzle_target"),
  );
  const pendingBed = usePrinter((s) =>
    s.requests.some((r) => r.status === "pending" && r.command.type === "set_bed_target"),
  );
  const [draft, setDraft] = useState<Record<Heater, number | null>>({ nozzle: null, bed: null });

  const nozzleTarget = draft.nozzle ?? nozzle.target ?? 0;
  const bedTarget = draft.bed ?? bed.target ?? 0;
  const nozzleValid = useCommandValidation(
    { type: "set_nozzle_target", celsius: nozzleTarget },
    now,
  );
  const bedValid = useCommandValidation({ type: "set_bed_target", celsius: bedTarget }, now);
  const coolValid = useCommandValidation({ type: "set_nozzle_target", celsius: 0 }, now);

  const nozzleDirty = draft.nozzle !== null && draft.nozzle !== nozzle.target;
  const bedDirty = draft.bed !== null && draft.bed !== bed.target;

  const adjust = (heater: Heater, delta: number) => {
    const max = heater === "nozzle" ? NOZZLE_MAX_C : BED_MAX_C;
    const current = heater === "nozzle" ? nozzleTarget : bedTarget;
    const next = Math.min(max, Math.max(0, Math.round((current + delta) / STEP) * STEP));
    setDraft((d) => ({ ...d, [heater]: next }));
  };

  const apply = async () => {
    const jobs: Promise<unknown>[] = [];
    if (nozzleDirty)
      jobs.push(runtime.execute({ type: "set_nozzle_target", celsius: nozzleTarget }));
    if (bedDirty) jobs.push(runtime.execute({ type: "set_bed_target", celsius: bedTarget }));
    setDraft({ nozzle: null, bed: null });
    await Promise.all(jobs);
  };

  const coolDown = () => {
    setDraft({ nozzle: null, bed: null });
    void runtime.execute({ type: "set_nozzle_target", celsius: 0 });
    void runtime.execute({ type: "set_bed_target", celsius: 0 });
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenStatusBanner now={now} />
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
        <HeaterRow
          heater="nozzle"
          label="Nozzle"
          temp={nozzle}
          target={nozzleTarget}
          max={NOZZLE_MAX_C}
          dirty={nozzleDirty}
          pending={pendingNozzle}
          disabled={!nozzleValid.ok && !nozzleDirty}
          onAdjust={adjust}
        />
        <HeaterRow
          heater="bed"
          label="Bed"
          temp={bed}
          target={bedTarget}
          max={BED_MAX_C}
          dirty={bedDirty}
          pending={pendingBed}
          disabled={!bedValid.ok && !bedDirty}
          onAdjust={adjust}
        />
        <div className="mt-auto flex gap-1.5">
          <TouchButton
            icon={Snowflake}
            className="h-9 flex-1"
            disabled={!coolValid.ok}
            onClick={coolDown}
            data-testid="cool-down"
          >
            Cool down
          </TouchButton>
          <TouchButton
            variant="primary"
            icon={Check}
            className="h-9 flex-1"
            disabled={
              !(nozzleDirty || bedDirty) ||
              (nozzleDirty && !nozzleValid.ok) ||
              (bedDirty && !bedValid.ok)
            }
            onClick={() => void apply()}
            data-testid="apply-temps"
          >
            Apply
          </TouchButton>
        </div>
      </div>
    </div>
  );
}

function HeaterRow({
  heater,
  label,
  temp,
  target,
  max,
  dirty,
  pending,
  disabled,
  onAdjust,
}: {
  heater: Heater;
  label: string;
  temp: Temperature;
  target: number;
  max: number;
  dirty: boolean;
  pending: boolean;
  disabled: boolean;
  onAdjust: (heater: Heater, delta: number) => void;
}) {
  const heating = (temp.target ?? 0) > 0;
  const Icon = heater === "nozzle" ? Flame : BedIcon;
  return (
    <div
      className="flex h-[52px] items-center gap-1.5 rounded-md border border-ink-700 bg-ink-850 pl-2 pr-1"
      data-testid={`heater-${heater}`}
    >
      <div className="w-[92px] shrink-0">
        <div className="flex items-center gap-1 text-2xs text-fg-muted">
          <Icon size={11} aria-hidden className={heating ? "text-warn" : undefined} />
          {label}
        </div>
        <div className="text-xl leading-6 font-bold tabular" data-testid={`${heater}-current`}>
          {formatTemp(temp.current)}°
        </div>
      </div>
      <TouchButton
        aria-label={`Lower ${label} target`}
        icon={Minus}
        className="h-10 w-11"
        disabled={disabled || pending || target <= 0}
        onClick={() => onAdjust(heater, -STEP)}
        data-testid={`${heater}-minus`}
      />
      <div className="flex flex-1 flex-col items-center leading-none">
        <span className="text-2xs text-fg-dim">
          {pending ? "Sending…" : dirty ? "New target" : "Target"}
        </span>
        <span
          className={cn("text-lg font-bold tabular", dirty ? "text-info" : "text-fg")}
          data-testid={`${heater}-target`}
        >
          {target === 0 ? "Off" : `${target}°`}
        </span>
      </div>
      <TouchButton
        aria-label={`Raise ${label} target`}
        icon={Plus}
        className="h-10 w-11"
        disabled={disabled || pending || target >= max}
        onClick={() => onAdjust(heater, STEP)}
        data-testid={`${heater}-plus`}
      />
    </div>
  );
}
