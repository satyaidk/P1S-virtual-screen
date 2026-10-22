"use client";

import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { useDisplayStore } from "@/display/display-store";
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  BRIGHTNESS_STEP,
  clampBrightness,
  nextTimeout,
  timeoutLabel,
} from "@/display/settings";
import { usePrinter } from "@/hooks/usePrinter";
import { SubHeader, TouchButton } from "./primitives";

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex h-[40px] shrink-0 items-center gap-2 border-b border-ink-800 px-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold">{label}</div>
        {note && <div className="truncate text-2xs text-fg-dim">{note}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsScreen() {
  const back = useDisplayStore((s) => s.back);
  const settings = useDisplayStore((s) => s.settings);
  const update = useDisplayStore((s) => s.updateSettings);
  const source = usePrinter((s) => s.state.source);

  return (
    <div className="flex h-full flex-col">
      <SubHeader title="Settings" onBack={back} />
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-testid="settings-list"
      >
        <Row label="Brightness" note="Simulated backlight">
          <TouchButton
            aria-label="Decrease brightness"
            icon={Minus}
            className="w-10"
            disabled={settings.brightness <= BRIGHTNESS_MIN}
            onClick={() =>
              update({ brightness: clampBrightness(settings.brightness - BRIGHTNESS_STEP) })
            }
          />
          <span
            className="w-9 text-center text-xs font-bold tabular"
            data-testid="brightness-value"
          >
            {settings.brightness}%
          </span>
          <TouchButton
            aria-label="Increase brightness"
            icon={Plus}
            className="w-10"
            disabled={settings.brightness >= BRIGHTNESS_MAX}
            onClick={() =>
              update({ brightness: clampBrightness(settings.brightness + BRIGHTNESS_STEP) })
            }
          />
        </Row>
        <Row label="Screen timeout" note="Simulated">
          <TouchButton
            className="w-[76px]"
            onClick={() => update({ timeoutSeconds: nextTimeout(settings.timeoutSeconds) })}
            data-testid="timeout"
          >
            {timeoutLabel(settings.timeoutSeconds)}
          </TouchButton>
        </Row>
        <Row label="Rotation" note="For upside-down mounting">
          <TouchButton
            className="w-[76px]"
            onClick={() => update({ rotation: settings.rotation === 0 ? 180 : 0 })}
            data-testid="rotation"
          >
            {settings.rotation}°
          </TouchButton>
        </Row>
        <Row label="Theme">
          <TouchButton
            className="w-[76px]"
            onClick={() => update({ theme: settings.theme === "dark" ? "contrast" : "dark" })}
            data-testid="theme"
          >
            {settings.theme === "dark" ? "Dark" : "Contrast"}
          </TouchButton>
        </Row>
        <Row label="Touch sound" note="Simulated (browser audio)">
          <TouchButton
            className="w-[76px]"
            variant={settings.touchSound ? "selected" : "default"}
            onClick={() => update({ touchSound: !settings.touchSound })}
            aria-pressed={settings.touchSound}
            data-testid="touch-sound"
          >
            {settings.touchSound ? "On" : "Off"}
          </TouchButton>
        </Row>
        <Row label="Connection" note="Change in the development console">
          <span className="text-xs font-semibold text-fg-muted">
            {source === "simulated" ? "Simulation" : "LAN bridge"}
          </span>
        </Row>
      </div>
    </div>
  );
}
