"use client";

import { useDisplayStore } from "@/display/display-store";
import { statusMeta } from "@/display/status-meta";
import { usePrinter, useRuntime } from "@/hooks/usePrinter";
import { formatAge, maskSerial } from "@/lib/format";
import { deriveDisplayStatus, telemetryAgeMs } from "@/printer/state";
import { SubHeader } from "./primitives";

export function InfoScreen({ now }: { now: number }) {
  const runtime = useRuntime();
  const back = useDisplayStore((s) => s.back);
  const state = usePrinter((s) => s.state);
  const status = statusMeta(deriveDisplayStatus(state, now, runtime.staleAfterMs), state);
  const { info, connection } = state;

  const rows: [string, string][] = [
    ["Model", info.model],
    ["Name", info.name],
    ["Data source", state.source === "simulated" ? "SIMULATED" : "LAN bridge"],
    ["Firmware", info.firmware ?? "Not reported"],
    ["Serial", maskSerial(info.serial)],
    ["Nozzle", info.nozzleDiameter ? `${info.nozzleDiameter} mm` : "Not reported"],
    ["Status", status.label],
    ["Connection", connection.status],
    [
      "Wi-Fi",
      connection.wifiSignalDbm === null ? "Not reported" : `${connection.wifiSignalDbm} dBm`,
    ],
    ["Last update", formatAge(telemetryAgeMs(state, now))],
  ];

  return (
    <div className="flex h-full flex-col">
      <SubHeader title="Printer info" onBack={back} />
      <dl
        className="grid flex-1 grid-cols-[88px_1fr] content-start gap-x-2 px-3 py-1.5 text-2xs leading-[14px]"
        data-testid="info-list"
      >
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-fg-dim">{label}</dt>
            <dd
              className="truncate font-semibold tabular"
              data-testid={`info-${label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {value}
            </dd>
          </div>
        ))}
        {connection.lastError && (
          <div className="contents">
            <dt className="text-fg-dim">Last error</dt>
            <dd className="truncate font-semibold text-danger">{connection.lastError}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
