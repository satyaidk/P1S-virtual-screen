"use client";

import { TriangleAlert, WifiOff } from "lucide-react";
import { usePrinter, useRuntime } from "@/hooks/usePrinter";
import { formatAge } from "@/lib/format";
import { isTelemetryStale, telemetryAgeMs } from "@/printer/state";
import { Banner } from "./primitives";

/** Connectivity/freshness banner for secondary screens (they keep showing last-known values). */
export function ScreenStatusBanner({ now }: { now: number }) {
  const runtime = useRuntime();
  const state = usePrinter((s) => s.state);
  if (state.connection.status !== "connected") {
    return (
      <Banner tone="danger" icon={WifiOff} testId="offline-banner">
        {state.connection.status === "connecting" ? "Connecting…" : "Offline"} · last data{" "}
        {formatAge(telemetryAgeMs(state, now))}
      </Banner>
    );
  }
  if (isTelemetryStale(state, now, runtime.staleAfterMs)) {
    return (
      <Banner tone="warn" icon={TriangleAlert} testId="stale-banner">
        No updates for {formatAge(telemetryAgeMs(state, now)).replace(" ago", "")} — controls locked
      </Banner>
    );
  }
  return null;
}
