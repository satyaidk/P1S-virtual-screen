"use client";

import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { useDisplayStore } from "@/display/display-store";
import { dimOverlayOpacity } from "@/display/settings";
import { useNow } from "@/hooks/useNow";
import { AMSScreen } from "./AMSScreen";
import { CommandFeedback } from "./CommandFeedback";
import { ErrorScreen } from "./ErrorScreen";
import { FansScreen } from "./FansScreen";
import { HistoryScreen } from "./HistoryScreen";
import { InfoScreen } from "./InfoScreen";
import { MainScreen } from "./MainScreen";
import { MenuScreen } from "./MenuScreen";
import { MoveScreen } from "./MoveScreen";
import { Navigation } from "./Navigation";
import { PrintControlScreen } from "./PrintControlScreen";
import { SettingsScreen } from "./SettingsScreen";
import { StatusBar } from "./StatusBar";
import { TemperatureScreen } from "./TemperatureScreen";

export const DISPLAY_WIDTH = 320;
export const DISPLAY_HEIGHT = 240;

function useTouchSound(enabled: boolean) {
  const ctx = useRef<AudioContext | null>(null);
  return useCallback(() => {
    if (!enabled || typeof window === "undefined" || !("AudioContext" in window)) return;
    ctx.current ??= new AudioContext();
    const audio = ctx.current;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 2200;
    gain.gain.value = 0.04;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.015);
  }, [enabled]);
}

/**
 * The simulated hardware screen: a fixed 320x240 logical canvas. Nothing inside depends on the
 * browser viewport; scaling happens outside (DisplayFrame) with a CSS transform.
 */
export function VirtualDisplay() {
  const now = useNow(1000);
  const screen = useDisplayStore((s) => s.nav.screen);
  const settings = useDisplayStore((s) => s.settings);
  const asleep = useDisplayStore((s) => s.asleep);
  const lastInteractionAt = useDisplayStore((s) => s.lastInteractionAt);
  const touch = useDisplayStore((s) => s.touch);
  const sleep = useDisplayStore((s) => s.sleep);
  const click = useTouchSound(settings.touchSound);

  useEffect(() => {
    if (lastInteractionAt === 0) touch(Date.now());
  }, [lastInteractionAt, touch]);

  useEffect(() => {
    if (settings.timeoutSeconds === 0 || asleep || lastInteractionAt === 0) return;
    if (now - lastInteractionAt >= settings.timeoutSeconds * 1000) sleep();
  }, [now, settings.timeoutSeconds, asleep, lastInteractionAt, sleep]);

  const onPointerDownCapture = (e: PointerEvent) => {
    if (asleep) {
      // Like real panels, the first tap only wakes the screen.
      e.preventDefault();
      e.stopPropagation();
    } else {
      click();
    }
    touch(Date.now());
  };

  return (
    <div
      data-testid="virtual-display"
      data-display-theme={settings.theme}
      data-screen={screen}
      role="application"
      aria-label="Printer touchscreen (320 by 240)"
      onPointerDownCapture={onPointerDownCapture}
      onClickCapture={(e) => {
        if (asleep) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className="relative overflow-hidden bg-ink-950 font-display text-fg select-none"
      style={{ width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT }}
    >
      <div
        className="flex h-full w-full flex-col"
        style={settings.rotation === 180 ? { transform: "rotate(180deg)" } : undefined}
      >
        <StatusBar now={now} />
        <main className="relative min-h-0 flex-1 overflow-hidden" data-testid="screen-content">
          <div key={screen} className="screen-enter h-full">
            <ScreenRouter screen={screen} now={now} />
          </div>
          <CommandFeedback />
        </main>
        <Navigation />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-black"
        style={{ opacity: asleep ? 1 : dimOverlayOpacity(settings.brightness) }}
        data-testid="brightness-overlay"
      />
      {asleep && (
        <div
          className="absolute inset-0 z-40 flex items-end justify-center pb-3 text-2xs text-fg-dim"
          data-testid="sleep-overlay"
        >
          Tap to wake
        </div>
      )}
    </div>
  );
}

function ScreenRouter({ screen, now }: { screen: string; now: number }) {
  switch (screen) {
    case "temperature":
      return <TemperatureScreen now={now} />;
    case "ams":
      return <AMSScreen now={now} />;
    case "control":
      return <PrintControlScreen now={now} />;
    case "menu":
      return <MenuScreen />;
    case "info":
      return <InfoScreen now={now} />;
    case "settings":
      return <SettingsScreen />;
    case "notifications":
      return <ErrorScreen now={now} />;
    case "fans":
      return <FansScreen now={now} />;
    case "move":
      return <MoveScreen now={now} />;
    case "history":
      return <HistoryScreen />;
    default:
      return <MainScreen now={now} />;
  }
}
