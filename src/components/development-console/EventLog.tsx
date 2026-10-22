"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
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
      title="Diagnostics"
      testId="event-log"
      actions={
        <>
          {(["events", "telemetry", "commands"] as const).map((t) => (
            <Button
              key={t}
              variant={tab === t ? "active" : "default"}
              onClick={() => setTab(t)}
              data-testid={`log-tab-${t}`}
            >
              {t}
            </Button>
          ))}
          <Button onClick={() => runtime.log.clear()}>Clear</Button>
        </>
      }
    >
      {tab === "events" && (
        <>
          <div className="mb-2 flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setFilter(c)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-2xs",
                  filter === c ? "bg-ink-700 text-fg" : "text-fg-dim hover:text-fg",
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <ol
            className="h-[300px] overflow-auto font-mono text-2xs leading-4"
            data-testid="event-list"
          >
            {shown.map((e) => (
              <li key={e.id} className="flex gap-2 border-b border-ink-800 py-0.5">
                <span className="shrink-0 text-fg-dim">{time(e.at)}</span>
                <span className="w-16 shrink-0 text-fg-muted">{e.category}</span>
                <span
                  className={cn(
                    e.level === "error" && "text-danger",
                    e.level === "warn" && "text-warn",
                  )}
                >
                  {e.message}
                </span>
              </li>
            ))}
            {shown.length === 0 && <li className="text-fg-dim">No events</li>}
          </ol>
        </>
      )}
      {tab === "telemetry" && (
        <ol
          className="h-[326px] overflow-auto font-mono text-2xs leading-4"
          data-testid="telemetry-list"
        >
          {telemetry
            .slice()
            .reverse()
            .map((t) => (
              <li key={t.id} className="border-b border-ink-800 py-0.5">
                <span className="text-fg-dim">{time(t.at)}</span>{" "}
                <span className="text-fg-muted">{t.changed.join(", ")}</span>
              </li>
            ))}
        </ol>
      )}
      {tab === "commands" && (
        <ol
          className="h-[326px] overflow-auto font-mono text-2xs leading-4"
          data-testid="command-list"
        >
          {requests
            .slice()
            .reverse()
            .map((r) => (
              <li key={r.id} className="flex gap-2 border-b border-ink-800 py-0.5">
                <span className="shrink-0 text-fg-dim">{time(r.startedAt)}</span>
                <span className="w-32 shrink-0">{r.command.type}</span>
                <span
                  className={cn(
                    "w-16 shrink-0",
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
