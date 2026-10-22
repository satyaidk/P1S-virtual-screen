"use client";

import { create } from "zustand";
import { back, INITIAL_NAV, navigate, type NavState, type ScreenId } from "./navigation";
import { DEFAULT_SETTINGS, type DisplaySettings } from "./settings";

interface DisplayStore {
  nav: NavState;
  settings: DisplaySettings;
  lastInteractionAt: number;
  asleep: boolean;
  go(to: ScreenId): void;
  back(): void;
  updateSettings(patch: Partial<DisplaySettings>): void;
  touch(now: number): void;
  sleep(): void;
  reset(): void;
}

export const useDisplayStore = create<DisplayStore>((set) => ({
  nav: INITIAL_NAV,
  settings: DEFAULT_SETTINGS,
  lastInteractionAt: 0,
  asleep: false,
  go: (to) => set((s) => ({ nav: navigate(s.nav, to) })),
  back: () => set((s) => ({ nav: back(s.nav) })),
  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  touch: (now) => set({ lastInteractionAt: now, asleep: false }),
  sleep: () => set({ asleep: true }),
  reset: () => set({ nav: INITIAL_NAV, settings: DEFAULT_SETTINGS, asleep: false }),
}));
