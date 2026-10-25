"use client";

import { Pause, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { useNow } from "@/hooks/useNow";
import { usePrinter, useRuntime } from "@/hooks/usePrinter";
import { cn } from "@/lib/cn";
import { formatAge } from "@/lib/format";
import { telemetryAgeMs } from "@/printer/state";
import type { ConnectionStatus } from "@/printer/types";

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected: "bg-ok",
  connecting: "bg-info",
  disconnected: "bg-danger",
};

/** What the browser-side runtime sees: provider, link state, freshness, allowed commands. */
export function ConnectionPanel() {
  const runtime = useRuntime();
  const now = useNow(1000);
  const state = usePrinter((s) => s.state);
  const { connection, info } = state;
  const caps = runtime.provider.capabilities;

  return (
    <Panel
      title="Data stream"
      description={
        runtime.provider.kind === "simulated"
          ? "From the built-in simulator."
          : "From your printer, through this app's server."
      }
      testId="connection-panel"
    >
      <div className="flex items-center gap-2.5 rounded-md border border-line bg-bench px-3 py-2.5">
        <span aria-hidden className={cn("size-2.5 rounded-full", STATUS_DOT[connection.status])} />
        <span className="text-[14px] font-medium" data-testid="console-connection-status">
          {connection.status}
        </span>
        <span className="flex-1" />
        <span className="tabular text-[13px] text-fg-muted">
          Last update {formatAge(telemetryAgeMs(state, now))}
        </span>
      </div>
      {connection.lastError && (
        <p className="mt-2 text-[13px] break-words text-warn">{connection.lastError}</p>
      )}
      <dl className="mt-3 grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-[13px]">
        <dt className="text-fg-muted">Transport</dt>
        <dd className="font-mono text-[12px]">{info.connectionMode ?? "none"}</dd>
        <dt className="text-fg-muted">Commands</dt>
        <dd>
          {caps.commands.size > 0 ? (
            <ul className="flex flex-wrap gap-1">
              {[...caps.commands].map((c) => (
                <li
                  key={c}
                  className="rounded border border-line px-1.5 py-px font-mono text-[11px] text-fg-muted"
                >
                  {c}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-fg-muted">{caps.unsupportedReason ?? "None available"}</span>
          )}
        </dd>
      </dl>
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Button onClick={() => void runtime.provider.connect()}>
          <RefreshCw size={14} aria-hidden />
          Reconnect
        </Button>
        <Button
          variant="ghost"
          onClick={() => void runtime.provider.disconnect()}
          data-testid="console-disconnect"
        >
          <Pause size={14} aria-hidden />
          Pause stream
        </Button>
      </div>
    </Panel>
  );
}
