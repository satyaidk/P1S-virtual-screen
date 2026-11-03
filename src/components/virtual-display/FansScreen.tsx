"use client";

import { useState } from "react";
import { Check, Fan, Minus, Plus } from "lucide-react";
import { useDisplayStore } from "@/display/display-store";
import { usePrinter, useRuntime, useCommandValidation } from "@/hooks/usePrinter";
import { cn } from "@/lib/cn";
import type { ControllableFan } from "@/printer/types";
import { TouchButton, SubHeader } from "./primitives";
import { ScreenStatusBanner } from "./ScreenStatusBanner";

const STEP = 10;

const FANS: readonly { id: ControllableFan; label: string; hint: string }[] = [
  { id: "part", label: "Part", hint: "Cooling" },
  { id: "aux", label: "Aux", hint: "Side" },
  { id: "chamber", label: "Chamber", hint: "Exhaust" },
];

/**
 * Fan control like the P2S "Fans" panel. As on the temperature screen, -/+ edit a local draft and
 * the check button sends one command, so stepping does not flood the printer's MQTT link.
 */
export function FansScreen({ now }: { now: number }) {
  const back = useDisplayStore((s) => s.back);
  const heatbreak = usePrinter((s) => s.state.fans.heatbreak);
  return (
    <div className="flex h-full flex-col">
      <SubHeader
        title="Fans"
        onBack={back}
        right={
          <span className="text-2xs text-fg-dim tabular" data-testid="fan-heatbreak">
            Hotend {heatbreak === null ? "--" : `${heatbreak}%`}
          </span>
        }
      />
      <ScreenStatusBanner now={now} />
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5">
        {FANS.map((f) => (
          <FanRow key={f.id} fan={f.id} label={f.label} hint={f.hint} now={now} />
        ))}
      </div>
    </div>
  );
}

function FanRow({
  fan,
  label,
  hint,
  now,
}: {
  fan: ControllableFan;
  label: string;
  hint: string;
  now: number;
}) {
  const runtime = useRuntime();
  const current = usePrinter((s) => s.state.fans[fan]);
  const pending = usePrinter((s) =>
    s.requests.some(
      (r) => r.status === "pending" && r.command.type === "set_fan" && r.command.fan === fan,
    ),
  );
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? current ?? 0;
  const dirty = draft !== null && draft !== current;
  const validation = useCommandValidation({ type: "set_fan", fan, percent: value }, now);
  const locked = !validation.ok;

  const adjust = (delta: number) =>
    setDraft(Math.min(100, Math.max(0, Math.round((value + delta) / STEP) * STEP)));

  return (
    <div
      className="flex h-[40px] items-center gap-1 rounded-md border border-ink-700 bg-ink-850 pr-1 pl-2"
      data-testid={`fan-${fan}`}
      title={locked ? validation.reason : undefined}
    >
      <Fan
        size={14}
        aria-hidden
        className={cn("shrink-0", (current ?? 0) > 0 ? "text-info" : "text-fg-dim")}
      />
      <div className="w-[62px] shrink-0 leading-3">
        <div className="text-xs font-semibold">{label}</div>
        <div className="text-2xs text-fg-dim">{hint}</div>
      </div>
      <TouchButton
        aria-label={`Lower ${label} fan`}
        icon={Minus}
        className="h-8 w-9 px-0"
        disabled={locked || pending || value <= 0}
        onClick={() => adjust(-STEP)}
        data-testid={`fan-${fan}-minus`}
      />
      <span
        className={cn(
          "flex-1 text-center text-base font-bold tabular",
          dirty ? "text-info" : "text-fg",
        )}
        data-testid={`fan-${fan}-value`}
      >
        {current === null && draft === null ? "--" : `${value}%`}
      </span>
      <TouchButton
        aria-label={`Raise ${label} fan`}
        icon={Plus}
        className="h-8 w-9 px-0"
        disabled={locked || pending || value >= 100}
        onClick={() => adjust(STEP)}
        data-testid={`fan-${fan}-plus`}
      />
      <TouchButton
        aria-label={`Apply ${label} fan speed`}
        variant="primary"
        icon={Check}
        pending={pending}
        className="h-8 w-9 px-0"
        disabled={!dirty || locked}
        onClick={() => {
          setDraft(null);
          void runtime.execute({ type: "set_fan", fan, percent: value });
        }}
        data-testid={`fan-${fan}-apply`}
      />
    </div>
  );
}
