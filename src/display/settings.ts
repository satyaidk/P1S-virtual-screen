/**
 * Display settings. All of these are SIMULATED in the browser (brightness is an overlay, the touch
 * sound is WebAudio); the future firmware maps them to backlight PWM, a buzzer, etc.
 */
export type ScreenTimeout = 0 | 30 | 60 | 300;
export type Rotation = 0 | 180;
export type DisplayTheme = "dark" | "contrast";

export interface DisplaySettings {
  brightness: number;
  timeoutSeconds: ScreenTimeout;
  rotation: Rotation;
  theme: DisplayTheme;
  touchSound: boolean;
}

export const DEFAULT_SETTINGS: DisplaySettings = {
  brightness: 90,
  timeoutSeconds: 0,
  rotation: 0,
  theme: "dark",
  touchSound: false,
};

export const BRIGHTNESS_MIN = 10;
export const BRIGHTNESS_MAX = 100;
export const BRIGHTNESS_STEP = 10;
export const TIMEOUT_OPTIONS: readonly ScreenTimeout[] = [0, 30, 60, 300];

export function clampBrightness(value: number): number {
  return Math.min(
    BRIGHTNESS_MAX,
    Math.max(BRIGHTNESS_MIN, Math.round(value / BRIGHTNESS_STEP) * BRIGHTNESS_STEP),
  );
}

export function nextTimeout(current: ScreenTimeout): ScreenTimeout {
  const i = TIMEOUT_OPTIONS.indexOf(current);
  return TIMEOUT_OPTIONS[(i + 1) % TIMEOUT_OPTIONS.length] ?? 0;
}

export function timeoutLabel(t: ScreenTimeout): string {
  if (t === 0) return "Never";
  return t < 60 ? `${t}s` : `${t / 60} min`;
}

/** Brightness is simulated as a black overlay; never fully black so the UI stays visible. */
export function dimOverlayOpacity(brightness: number): number {
  return Math.round((1 - clampBrightness(brightness) / 100) * 0.8 * 100) / 100;
}
