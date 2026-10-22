"use client";

import { useState } from "react";
import { PrinterRuntimeProvider } from "@/hooks/usePrinter";
import { defaultProviderConfig, type ProviderConfig } from "@/printer/providers/provider-factory";
import { ConnectionPanel } from "./ConnectionPanel";
import { DisplayStage } from "./DisplayStage";
import { EventLog } from "./EventLog";
import { PrinterSetup } from "./PrinterSetup";
import { SimulationControls } from "./SimulationControls";
import { StateInspector } from "./StateInspector";

/** `demo` switches to the built-in simulator (development only; `/?demo=1`). */
export function DevelopmentConsole({ demo = false }: { demo?: boolean }) {
  const [config] = useState<ProviderConfig>(() => defaultProviderConfig(demo));
  const simulated = config.mode === "simulation";

  return (
    <div className="min-h-screen bg-ink-950 text-fg">
      <header className="flex h-12 items-center gap-3 border-b border-ink-700 px-4">
        <h1 className="text-sm font-semibold">P1S Virtual Screen</h1>
        <span className="text-xs text-fg-dim">Development console</span>
        <span className="flex-1" />
        {simulated && (
          <span className="rounded bg-info-soft px-1.5 py-0.5 text-2xs font-bold text-info">
            DEMO DATA
          </span>
        )}
        <a
          href={simulated ? "/" : "/?demo=1"}
          className="text-xs text-fg-dim hover:text-fg"
          data-testid="toggle-demo"
        >
          {simulated ? "Use my printer" : "Demo mode"}
        </a>
        <a
          href={simulated ? "/display?demo=1" : "/display"}
          className="text-xs text-info hover:underline"
          data-testid="open-display"
        >
          Open display only →
        </a>
      </header>
      <PrinterRuntimeProvider
        config={config}
        fallback={<p className="p-6 text-sm text-fg-muted">Starting printer runtime…</p>}
      >
        <main className="grid gap-4 p-4 xl:grid-cols-[minmax(0,auto)_minmax(420px,1fr)]">
          <div className="flex flex-col gap-4">
            <div className="flex justify-center overflow-auto rounded-lg border border-ink-700 bg-ink-900 p-6">
              <DisplayStage />
            </div>
            {simulated ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <SimulationControls />
                <ConnectionPanel />
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                <PrinterSetup />
                <ConnectionPanel />
              </div>
            )}
          </div>
          <div className="grid content-start gap-4">
            <EventLog />
            <StateInspector />
          </div>
        </main>
      </PrinterRuntimeProvider>
    </div>
  );
}
