"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { usePrinter, useRuntime } from "@/hooks/usePrinter";
import { useNow } from "@/hooks/useNow";
import { formatAge } from "@/lib/format";
import type { ProviderConfig } from "@/printer/providers/provider-factory";
import { telemetryAgeMs } from "@/printer/state";

export function ConnectionPanel({
  config,
  onChange,
}: {
  config: ProviderConfig;
  onChange: (c: ProviderConfig) => void;
}) {
  const runtime = useRuntime();
  const now = useNow(1000);
  const connection = usePrinter((s) => s.state.connection);
  const state = usePrinter((s) => s.state);
  const [url, setUrl] = useState(
    config.mode === "lan-bridge" ? config.bridgeUrl : "ws://127.0.0.1:8787/v1/stream",
  );

  return (
    <Panel title="Connection" testId="connection-panel">
      <div className="flex flex-col gap-2 text-xs">
        <div className="flex gap-1.5">
          <Button
            variant={config.mode === "simulation" ? "active" : "default"}
            onClick={() => onChange({ mode: "simulation" })}
            data-testid="mode-sim"
          >
            Simulation
          </Button>
          <Button
            variant={config.mode === "lan-bridge" ? "active" : "default"}
            onClick={() => onChange({ mode: "lan-bridge", bridgeUrl: url })}
            data-testid="mode-lan"
          >
            LAN bridge
          </Button>
        </div>
        <label className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-fg-muted">Bridge URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            className="h-8 min-w-0 flex-1 rounded-md border border-ink-600 bg-ink-850 px-2 font-mono text-2xs"
          />
        </label>
        <p className="text-2xs text-fg-dim">
          The bridge owns the printer IP, serial and LAN access code. Never enter credentials here.
          LAN mode is unverified against real hardware — see docs/bridge-api.md.
        </p>
        <dl className="grid grid-cols-[100px_1fr] gap-y-1 font-mono text-2xs">
          <dt className="text-fg-muted">provider</dt>
          <dd>{runtime.provider.kind}</dd>
          <dt className="text-fg-muted">status</dt>
          <dd data-testid="console-connection-status">{connection.status}</dd>
          <dt className="text-fg-muted">last error</dt>
          <dd>{connection.lastError ?? "—"}</dd>
          <dt className="text-fg-muted">last telemetry</dt>
          <dd>{formatAge(telemetryAgeMs(state, now))}</dd>
        </dl>
        <div className="flex gap-1.5">
          <Button onClick={() => void runtime.provider.connect()}>Connect</Button>
          <Button
            onClick={() => void runtime.provider.disconnect()}
            data-testid="console-disconnect"
          >
            Disconnect
          </Button>
        </div>
      </div>
    </Panel>
  );
}
