"use client";

import { Bell, History, Info, Moon, Settings, type LucideIcon } from "lucide-react";
import { useDisplayStore } from "@/display/display-store";
import { usePrinter } from "@/hooks/usePrinter";

export function MenuScreen() {
  const go = useDisplayStore((s) => s.go);
  const sleep = useDisplayStore((s) => s.sleep);
  const alerts = usePrinter((s) => s.state.alerts.length);
  const failures = usePrinter(
    (s) => s.requests.filter((r) => r.status === "failed" || r.status === "timeout").length,
  );

  const items: {
    id: string;
    label: string;
    icon: LucideIcon;
    badge?: number;
    onClick: () => void;
  }[] = [
    {
      id: "notifications",
      label: "Notifications",
      icon: Bell,
      badge: alerts + failures,
      onClick: () => go("notifications"),
    },
    { id: "history", label: "History", icon: History, onClick: () => go("history") },
    { id: "info", label: "Printer info", icon: Info, onClick: () => go("info") },
    { id: "settings", label: "Settings", icon: Settings, onClick: () => go("settings") },
    { id: "sleep", label: "Screen off", icon: Moon, onClick: sleep },
  ];

  return (
    <div className="grid h-full grid-cols-3 grid-rows-2 gap-1.5 p-2">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={item.onClick}
          data-testid={`menu-${item.id}`}
          className="touch relative flex flex-col items-center justify-center gap-1.5 rounded-md border border-ink-700 bg-ink-850 text-xs font-semibold"
        >
          <item.icon size={20} strokeWidth={2} aria-hidden className="text-fg-muted" />
          {item.label}
          {item.badge ? (
            <span className="absolute top-1.5 right-1.5 min-w-4 rounded-full bg-warn px-1 text-center text-2xs font-bold text-ink-950 tabular">
              {item.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
