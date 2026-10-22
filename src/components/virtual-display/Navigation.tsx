"use client";

import {
  House,
  Layers,
  LayoutGrid,
  SlidersHorizontal,
  Thermometer,
  type LucideIcon,
} from "lucide-react";
import { useDisplayStore } from "@/display/display-store";
import { activeTab, TABS, type TabId } from "@/display/navigation";
import { cn } from "@/lib/cn";

const ICONS: Record<TabId, LucideIcon> = {
  home: House,
  temperature: Thermometer,
  ams: Layers,
  control: SlidersHorizontal,
  menu: LayoutGrid,
};

export function Navigation() {
  const screen = useDisplayStore((s) => s.nav.screen);
  const go = useDisplayStore((s) => s.go);
  const current = activeTab(screen);

  return (
    <nav aria-label="Screens" className="flex h-[40px] shrink-0 border-t border-ink-700 bg-ink-900">
      {TABS.map((tab) => {
        const Icon = ICONS[tab.id];
        const active = tab.id === current;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => go(tab.id)}
            aria-current={active ? "page" : undefined}
            data-testid={`tab-${tab.id}`}
            className={cn(
              "touch relative flex flex-1 flex-col items-center justify-center gap-0.5 text-2xs font-semibold",
              active ? "text-fg" : "text-fg-dim",
            )}
          >
            {active && (
              <span aria-hidden className="absolute inset-x-3 top-0 h-0.5 rounded-b bg-ok" />
            )}
            <Icon size={16} strokeWidth={active ? 2.5 : 2} aria-hidden />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
