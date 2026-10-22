"use client";

import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { useNow } from "@/hooks/useNow";
import { usePrinter, useRuntime } from "@/hooks/usePrinter";
import { formatAge } from "@/lib/format";
import { telemetryAgeMs } from "@/printer/state";

/** What the browser-side runtime sees: provider, link state, freshness, allowed commands. */
export function ConnectionPanel() {
  const runtime = useRuntime();
  const now = useNow(1000);
  const state = usePrinter((s) => s.state);
  const { connection, info } = state;
  const caps = runtime.provider.capabilities;

  return (
    <Panel title="Runtime" testId="connection-panel">
      <dl className="grid grid-cols-[110px_1fr] gap-y-1 font-mono text-2xs">
        <dt className="text-fg-muted">data source</dt>
        <dd>{runtime.provider.kind === "simulated" ? "simulator (demo)" : "your printer"}</dd>
        <dt className="text-fg-muted">via</dt>
        <dd>{info.connectionMode ?? "—"}</dd>
        <dt className="text-fg-muted">status</dt>
        <dd data-testid="console-connection-status">{connection.status}</dd>
        <dt className="text-fg-muted">last error</dt>
        <dd className="break-words">{connection.lastError ?? "—"}</dd>
        <dt className="text-fg-muted">last telemetry</dt>
        <dd>{formatAge(telemetryAgeMs(state, now))}</dd>
        <dt className="text-fg-muted">commands</dt>
        <dd className="break-words">
          {caps.commands.size > 0
            ? [...caps.commands].join(", ")
            : (caps.unsupportedReason ?? "none")}
        </dd>
      </dl>
      <div className="mt-3 flex gap-1.5">
        <Button onClick={() => void runtime.provider.connect()}>Reconnect stream</Button>
        <Button onClick={() => void runtime.provider.disconnect()} data-testid="console-disconnect">
          Pause stream
        </Button>
      </div>
    </Panel>
  );
}
