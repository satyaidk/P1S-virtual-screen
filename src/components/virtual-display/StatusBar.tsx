"use client";

import { Bell, Wifi, WifiHigh, WifiLow, WifiOff, WifiZero } from "lucide-react";
import { statusMeta, TONE_TEXT } from "@/display/status-meta";
import { useDisplayStore } from "@/display/display-store";
import { usePrinter, useRuntime } from "@/hooks/usePrinter";
import { formatClock, wifiBars } from "@/lib/format";
import { cn } from "@/lib/cn";
import { deriveDisplayStatus } from "@/printer/state";
import { StatusDot } from "./primitives";

const WIFI_ICONS = [WifiZero, WifiLow, WifiHigh, Wifi] as const;

export function StatusBar({ now }: { now: number }) {
  const runtime = useRuntime();
  const name = usePrinter((s) => s.state.info.name);
  const source = usePrinter((s) => s.state.source);
  const wifi = usePrinter((s) => s.state.connection.wifiSignalDbm);
  const alertCount = usePrinter((s) => s.state.alerts.length);
  const displayStatus = usePrinter((s) => deriveDisplayStatus(s.state, now, runtime.staleAfterMs));
  const printErrorCode = usePrinter((s) => s.state.printErrorCode);
  const go = useDisplayStore((s) => s.go);

  const meta = statusMeta(displayStatus, { printErrorCode });
  const offline = displayStatus === "disconnected" || displayStatus === "connecting";
  const bars = wifiBars(wifi);
  const WifiIcon = offline ? WifiOff : bars === null ? Wifi : WIFI_ICONS[bars];

  return (
    <header className="flex h-[22px] shrink-0 items-center gap-1.5 border-b border-ink-700 bg-ink-900 px-2 text-2xs">
      <StatusDot tone={meta.tone} />
      <span className="max-w-[120px] truncate font-semibold text-fg" data-testid="printer-name">
        {name}
      </span>
      <span className={cn("font-semibold", TONE_TEXT[meta.tone])} data-testid="status-label">
        {meta.label}
      </span>
      <span className="flex-1" />
      {source === "simulated" && (
        <span
          className="rounded-sm bg-info-soft px-1 font-bold tracking-wide text-info"
          title="Simulated data"
        >
          SIM
        </span>
      )}
      {alertCount > 0 && (
        <button
          type="button"
          onClick={() => go("notifications")}
          aria-label={`${alertCount} notifications`}
          className="touch flex items-center gap-0.5 text-warn"
        >
          <Bell size={11} strokeWidth={2.5} aria-hidden />
          <span className="tabular font-bold">{alertCount}</span>
        </button>
      )}
      <WifiIcon
        size={12}
        strokeWidth={2.5}
        aria-label={
          offline ? "Offline" : bars === null ? "Wi-Fi signal not reported" : `Wi-Fi ${bars} of 3`
        }
        className={offline ? "text-danger" : bars === null ? "text-fg-dim" : "text-fg-muted"}
      />
      <span className="tabular text-fg-muted">{formatClock(now)}</span>
    </header>
  );
}
