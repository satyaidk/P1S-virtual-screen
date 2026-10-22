"use client";

import { useState } from "react";
import { Droplets, Thermometer } from "lucide-react";
import { usePrinter } from "@/hooks/usePrinter";
import { cn } from "@/lib/cn";
import type { ActiveFilament, AmsTray } from "@/printer/types";
import { ScreenStatusBanner } from "./ScreenStatusBanner";

function unitLetter(unit: number): string {
  return String.fromCharCode(65 + unit);
}

function isActive(active: ActiveFilament, unit: number, slot: number): boolean {
  return active.kind === "ams" && active.unit === unit && active.slot === slot;
}

/**
 * Read-only AMS view. Load/unload and tray selection are intentionally absent: the P1S payloads
 * for them are not verified yet (docs/research.md, "Unresolved").
 */
export function AMSScreen({ now }: { now: number }) {
  const ams = usePrinter((s) => s.state.ams);
  const [unitIndex, setUnitIndex] = useState(0);
  const [selected, setSelected] = useState<number | "ext" | null>(null);

  const units = ams.units;
  const unit = units?.[Math.min(unitIndex, (units?.length ?? 1) - 1)];

  const selectedTray: { tray: AmsTray | null; label: string } | null =
    selected === "ext"
      ? { tray: ams.externalSpool, label: "External spool" }
      : selected !== null && unit
        ? {
            tray: unit.trays.find((t) => t.slot === selected) ?? null,
            label: `${unitLetter(unit.id)}${selected + 1}`,
          }
        : null;

  return (
    <div className="flex h-full flex-col">
      <ScreenStatusBanner now={now} />
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
        <div className="flex h-[16px] items-center gap-2 text-2xs text-fg-muted">
          {units === null && <span>AMS status not reported yet</span>}
          {units?.length === 0 && <span data-testid="no-ams">No AMS detected</span>}
          {units && units.length > 0 && (
            <>
              {units.length > 1 ? (
                units.map((u, i) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setUnitIndex(i)}
                    className={cn(
                      "touch rounded px-1.5 font-semibold",
                      i === unitIndex ? "bg-ink-700 text-fg" : "text-fg-dim",
                    )}
                  >
                    AMS {u.id + 1}
                  </button>
                ))
              ) : (
                <span className="font-semibold text-fg">AMS {(unit?.id ?? 0) + 1}</span>
              )}
              <span className="flex items-center gap-0.5" title="Raw Bambu humidity index">
                <Droplets size={10} aria-hidden /> Humidity idx {unit?.humidityIndex ?? "--"}
              </span>
              <span className="flex items-center gap-0.5">
                <Thermometer size={10} aria-hidden />{" "}
                {unit?.temperature != null ? `${unit.temperature.toFixed(1)}°C` : "--"}
              </span>
            </>
          )}
        </div>

        {unit ? (
          <div className="grid h-[98px] grid-cols-4 gap-1.5" data-testid="ams-trays">
            {[0, 1, 2, 3].map((slot) => {
              const tray = unit.trays.find((t) => t.slot === slot) ?? null;
              return (
                <TrayCard
                  key={slot}
                  label={`${unitLetter(unit.id)}${slot + 1}`}
                  tray={tray}
                  active={isActive(ams.active, unit.id, slot)}
                  selected={selected === slot}
                  onSelect={() => setSelected(selected === slot ? null : slot)}
                />
              );
            })}
          </div>
        ) : (
          <div className="grid h-[98px] grid-cols-4 gap-1.5">
            <TrayCard
              label="Ext"
              tray={ams.externalSpool}
              active={ams.active.kind === "external"}
              selected={selected === "ext"}
              onSelect={() => setSelected(selected === "ext" ? null : "ext")}
            />
            <div className="col-span-3 flex items-center px-2 text-2xs text-fg-dim">
              {units === null
                ? "Waiting for AMS report…"
                : "Printing from the external spool holder."}
            </div>
          </div>
        )}

        <div
          className="mt-auto flex h-[36px] items-center gap-2 rounded-md border border-ink-700 bg-ink-850 px-2 text-2xs"
          data-testid="tray-details"
        >
          {selectedTray ? (
            <TrayDetails label={selectedTray.label} tray={selectedTray.tray} />
          ) : (
            <>
              {unit && (
                <button
                  type="button"
                  onClick={() => setSelected("ext")}
                  className="touch flex items-center gap-1 rounded border border-ink-600 px-1.5 py-1 font-semibold"
                >
                  <Swatch tray={ams.externalSpool} size="sm" />
                  Ext{" "}
                  {ams.externalSpool?.state === "loaded"
                    ? (ams.externalSpool.material ?? "?")
                    : "empty"}
                </button>
              )}
              <span className="truncate text-fg-dim">Tap a slot for details</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Swatch({ tray, size = "lg" }: { tray: AmsTray | null; size?: "lg" | "sm" }) {
  const empty = !tray || tray.state === "empty";
  return (
    <span
      aria-hidden
      className={cn(
        "block shrink-0 rounded-full",
        size === "lg" ? "size-[26px] border-2" : "size-3 border",
        empty ? "border-dashed border-ink-500" : "border-ink-500",
        !empty && !tray?.color && "unknown-swatch",
      )}
      style={!empty && tray?.color ? { backgroundColor: tray.color } : undefined}
    />
  );
}

function TrayCard({
  label,
  tray,
  active,
  selected,
  onSelect,
}: {
  label: string;
  tray: AmsTray | null;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const state = tray?.state ?? "unknown";
  const empty = state === "empty";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`tray-${label}`}
      data-state={state}
      className={cn(
        "touch relative flex flex-col items-center gap-1 rounded-md border bg-ink-850 px-1 pt-1.5 pb-1",
        active ? "border-ok" : selected ? "border-info" : "border-ink-700",
      )}
    >
      <span className="flex w-full items-center justify-between px-0.5 text-2xs font-bold">
        <span>{label}</span>
        {active && (
          <span className="rounded-sm bg-ok px-1 text-[9px] leading-3 text-ink-950">IN USE</span>
        )}
      </span>
      <Swatch tray={tray} />
      <span className={cn("text-xs font-bold", empty ? "text-fg-dim" : "text-fg")}>
        {empty
          ? "Empty"
          : state === "unknown" && !tray?.material
            ? "Unknown"
            : (tray?.material ?? "--")}
      </span>
      <div className="w-full px-0.5">
        <div className="h-1 w-full overflow-hidden rounded-full bg-ink-700">
          {tray?.remainPercent != null && (
            <div
              className="h-full rounded-full bg-fg-muted"
              style={{ width: `${tray.remainPercent}%` }}
            />
          )}
        </div>
        <span
          className="block text-center text-2xs text-fg-muted tabular"
          data-testid={`tray-${label}-remain`}
        >
          {empty
            ? "—"
            : tray?.remainPercent != null
              ? `${Math.round(tray.remainPercent)}%`
              : "? left"}
        </span>
      </div>
    </button>
  );
}

function TrayDetails({ label, tray }: { label: string; tray: AmsTray | null }) {
  if (!tray || tray.state === "empty") {
    return <span className="text-fg-muted">{label}: no filament loaded</span>;
  }
  const range =
    tray.nozzleTempMin !== null && tray.nozzleTempMax !== null
      ? `${tray.nozzleTempMin}–${tray.nozzleTempMax}°C`
      : "temp range n/a";
  return (
    <>
      <Swatch tray={tray} size="sm" />
      <span className="truncate">
        <span className="font-bold">{label}</span> · {tray.material ?? "Unknown type"} ·{" "}
        {tray.color ?? "colour n/a"} · {range}
        {tray.remainPercent === null && " · remaining not measurable"}
      </span>
    </>
  );
}
