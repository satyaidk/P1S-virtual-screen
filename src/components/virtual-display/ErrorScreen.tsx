"use client";

import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useDisplayStore } from "@/display/display-store";
import { TONE_TEXT, type Tone } from "@/display/status-meta";
import { usePrinter } from "@/hooks/usePrinter";
import { formatAge } from "@/lib/format";
import { cn } from "@/lib/cn";
import { COMMAND_SPECS } from "@/printer/commands";
import type { AlertSeverity } from "@/printer/types";
import { SubHeader, TouchButton } from "./primitives";

interface Item {
  key: string;
  tone: Tone;
  icon: LucideIcon;
  title: string;
  detail: string;
  at: number;
}

const SEVERITY: Record<AlertSeverity, { tone: Tone; icon: LucideIcon }> = {
  error: { tone: "danger", icon: CircleAlert },
  warning: { tone: "warn", icon: TriangleAlert },
  info: { tone: "info", icon: Info },
};

/** Printer alerts, connectivity failures and failed commands, most severe first. */
export function ErrorScreen({ now }: { now: number }) {
  const back = useDisplayStore((s) => s.back);
  const go = useDisplayStore((s) => s.go);
  const alerts = usePrinter((s) => s.state.alerts);
  const connection = usePrinter((s) => s.state.connection);
  const requests = usePrinter((s) => s.requests);

  const items: Item[] = [];
  if (connection.status === "disconnected" && connection.lastError) {
    items.push({
      key: "conn",
      tone: "danger",
      icon: WifiOff,
      title: "Connection lost",
      detail: connection.lastError,
      at: now,
    });
  }
  const order: AlertSeverity[] = ["error", "warning", "info"];
  for (const a of [...alerts].sort(
    (x, y) => order.indexOf(x.severity) - order.indexOf(y.severity),
  )) {
    items.push({ key: a.id, ...SEVERITY[a.severity], title: a.message, detail: a.code, at: a.at });
  }
  for (const r of requests
    .filter((r) => r.status === "failed" || r.status === "timeout")
    .slice(-4)
    .reverse()) {
    items.push({
      key: `cmd-${r.id}`,
      tone: "warn",
      icon: TriangleAlert,
      title: `${COMMAND_SPECS[r.command.type].label} ${r.status === "timeout" ? "timed out" : "failed"}`,
      detail: r.message ?? "",
      at: r.finishedAt ?? r.startedAt,
    });
  }

  return (
    <div className="flex h-full flex-col">
      <SubHeader
        title="Notifications"
        onBack={back}
        right={
          <TouchButton variant="ghost" className="min-h-0 h-6 px-1.5" onClick={() => go("home")}>
            Home
          </TouchButton>
        }
      />
      {items.length === 0 ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-1 text-fg-muted"
          data-testid="no-notifications"
        >
          <CircleCheck size={24} className="text-ok" aria-hidden />
          <span className="text-xs">No notifications</span>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="notification-list">
          {items.map((item) => (
            <li key={item.key} className="flex gap-2 border-b border-ink-800 px-3 py-1.5">
              <item.icon
                size={14}
                aria-hidden
                className={cn("mt-0.5 shrink-0", TONE_TEXT[item.tone])}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-4 font-semibold">{item.title}</p>
                <p className="truncate text-2xs text-fg-dim">
                  {item.detail} · {formatAge(Math.max(0, now - item.at))}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
