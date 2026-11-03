"use client";

import { useState } from "react";
import { MonitorUp } from "lucide-react";
import { PrinterRuntimeProvider } from "@/hooks/usePrinter";
import { cn } from "@/lib/cn";
import { defaultProviderConfig, type ProviderConfig } from "@/printer/providers/provider-factory";
import { ConnectionPanel } from "./ConnectionPanel";
import { DisplayStage } from "./DisplayStage";
import { EventLog } from "./EventLog";
import { PrinterSetup } from "./PrinterSetup";
import { SimulationControls } from "./SimulationControls";
import { StateInspector } from "./StateInspector";

/**
 * Layout: the device and the one task that drives it (connecting a printer, or steering the
 * simulator) share the first screen; diagnostics for developers sit below.
 *
 * `demo` switches to the built-in simulator (development only; `/?demo=1`).
 */
export function DevelopmentConsole({ demo = false }: { demo?: boolean }) {
  const [config] = useState<ProviderConfig>(() => defaultProviderConfig(demo));
  const simulated = config.mode === "simulation";

  return (
    <div className="min-h-screen bg-bench text-fg">
      <header className="sticky top-0 z-10 border-b border-line bg-bench/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
          <a href={simulated ? "/?demo=1" : "/"} className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={26} height={26} />
            <span className="text-[15px] font-semibold">P1S Virtual Screen</span>
          </a>
          <a
            href="/api/version"
            title="Commit this build was made from"
            className="rounded border border-line px-1.5 font-mono text-[11px] text-fg-muted hover:text-fg"
            data-testid="build-commit"
          >
            build {process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "unknown"}
          </a>
          <nav aria-label="Data source" className="flex rounded-md border border-line p-0.5">
            <SourceLink href="/" active={!simulated} testId="source-live">
              My printer
            </SourceLink>
            <SourceLink href="/?demo=1" active={simulated} testId="source-demo">
              Demo printer
            </SourceLink>
          </nav>
          <span className="flex-1" />
          <a
            href={simulated ? "/display?demo=1" : "/display"}
            className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium text-fg-muted hover:bg-surface-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-mat-ink"
            data-testid="open-display"
          >
            <MonitorUp size={16} aria-hidden />
            Open display only
          </a>
        </div>
      </header>
      <PrinterRuntimeProvider
        config={config}
        fallback={<p className="p-6 text-sm text-fg-muted">Starting printer runtime…</p>}
      >
        <main className="mx-auto grid max-w-[1600px] gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <DisplayStage />
          <div className="flex min-w-0 flex-col gap-4">
            {simulated ? <SimulationControls /> : <PrinterSetup />}
            <ConnectionPanel />
          </div>
          <div className="grid min-w-0 gap-4 lg:col-span-2 xl:grid-cols-2">
            <EventLog />
            <StateInspector />
          </div>
        </main>
      </PrinterRuntimeProvider>
    </div>
  );
}

function SourceLink({
  href,
  active,
  testId,
  children,
}: {
  href: string;
  active: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      className={cn(
        "rounded-[5px] px-2.5 py-1 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-mat-ink",
        active ? "bg-surface-raised text-fg" : "text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </a>
  );
}
