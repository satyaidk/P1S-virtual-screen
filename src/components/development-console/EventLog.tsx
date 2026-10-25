"use client";

import { useState } from "react";
import { Button, Segmented } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { usePrinter, useRuntime } from "@/hooks/usePrinter";
import { cn } from "@/lib/cn";
import type { EventCategory } from "@/printer/event-log";

const CATEGORIES: (EventCategory | "all")[] = [
  "all",
  "connection",
  "state",
  "command",
  "alert",
  "simulation",
  "protocol",
];

function time(at: number): string {
  const d = new Date(at);
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function EventLog() {
  const runtime = useRuntime();
  const events = usePrinter((s) => s.events);
  const telemetry = usePrinter((s) => s.telemetry);
  const requests = usePrinter((s) => s.requests);
  const [filter, setFilter] = useState<EventCategory | "all">("all");
  const [tab, setTab] = useState<"events" | "telemetry" | "commands">("events");
  const shown = events
    .filter((e) => filter === "all" || e.category === filter)
    .slice()
    .reverse();

  return (
    <Panel
      title="Activity"
      description="Newest first."
      testId="event-log"
      actions={
        <>
          <Segmented
            label="Activity view"
            value={tab}
            onChange={setTab}
            items={[
              { value: "events", label: "Events", testId: "log-tab-events" },
              { value: "telemetry", label: "Telemetry", testId: "log-tab-telemetry" },
              { value: "commands", label: "Commands", testId: "log-tab-commands" },
            ]}
          />
          <Button variant="ghost" onClick={() => runtime.log.clear()}>
            Clear
          </Button>
        </>
      }
    >
      {tab === "events" && (
        <>
          <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Filter events">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={filter === c}
                onClick={() => setFilter(c)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[12px] capitalize focus-visible:outline-2 focus-visible:outline-mat-ink",
                  filter === c
                    ? "border-mat-ink bg-mat text-fg"
                    : "border-line text-fg-muted hover:text-fg",
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <ol
            className="h-[330px] overflow-auto rounded-md bg-bench px-2 font-mono text-[11.5px] leading-5"
            data-testid="event-list"
          >
            {shown.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2 border-b border-line/60 py-0.5">
                <span className="shrink-0 text-fg-dim">{time(e.at)}</span>
                <span className="w-[5.5rem] shrink-0 text-fg-muted">{e.category}</span>
                <span
                  className={cn(
                    "min-w-0 basis-full sm:flex-1 sm:basis-auto",
                    e.level === "error" && "text-danger",
                    e.level === "warn" && "text-warn",
                  )}
                >
                  {e.message}
                </span>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="py-2 font-sans text-[13px] text-fg-muted">
                No events in this category yet.
              </li>
            )}
          </ol>
        </>
      )}
      {tab === "telemetry" && (
        <ol
          className="h-[362px] overflow-auto rounded-md bg-bench px-2 font-mono text-[11.5px] leading-5"
          data-testid="telemetry-list"
        >
          {telemetry
            .slice()
            .reverse()
            .map((t) => (
              <li key={t.id} className="border-b border-line/60 py-0.5">
                <span className="text-fg-dim">{time(t.at)}</span>{" "}
                <span className="text-fg-muted">{t.changed.join(", ")}</span>
              </li>
            ))}
        </ol>
      )}
      {tab === "commands" && (
        <ol
          className="h-[362px] overflow-auto rounded-md bg-bench px-2 font-mono text-[11.5px] leading-5"
          data-testid="command-list"
        >
          {requests
            .slice()
            .reverse()
            .map((r) => (
              <li key={r.id} className="flex gap-2 border-b border-line/60 py-0.5">
                <span className="shrink-0 text-fg-dim">{time(r.startedAt)}</span>
                <span className="w-32 shrink-0">{r.command.type}</span>
                <span
                  className={cn(
                    "w-20 shrink-0",
                    r.status === "succeeded" && "text-ok",
                    r.status === "pending" && "text-info",
                    (r.status === "failed" || r.status === "timeout") && "text-danger",
                    r.status === "rejected" && "text-warn",
                  )}
                >
                  {r.status}
                </span>
                <span className="text-fg-muted">{r.message}</span>
              </li>
            ))}
        </ol>
      )}
    </Panel>
  );
}
