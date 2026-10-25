"use client";

import type { ReactNode } from "react";
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from "./VirtualDisplay";

/** Physical panel: 2.4" diagonal, 4:3 → 1.92" × 1.44" active area. */
export const PANEL_WIDTH_INCHES = 1.92;

/** CSS scale that renders the panel at real-world size, given CSS px per inch of the monitor. */
export function physicalScale(cssPxPerInch = 96): number {
  return (PANEL_WIDTH_INCHES * cssPxPerInch) / DISPLAY_WIDTH;
}

/** Bezel thickness around the panel at a given scale (0 when the bezel is hidden). */
export function bezelPadding(scale: number, bezel = true): number {
  return bezel ? Math.max(6, Math.round(14 * Math.min(scale, 2))) : 0;
}

/**
 * Scales the fixed 320x240 display with a transform. Layout inside never changes; the outer box
 * reserves the scaled size so the console layout stays correct.
 */
export function DisplayFrame({
  scale,
  bezel = true,
  children,
}: {
  scale: number;
  bezel?: boolean;
  children: ReactNode;
}) {
  const w = DISPLAY_WIDTH * scale;
  const h = DISPLAY_HEIGHT * scale;
  const pad = bezelPadding(scale, bezel);
  return (
    <div
      className={
        bezel
          ? "rounded-2xl border border-black bg-[#050606] shadow-[inset_0_1px_0_#2a2f33,0_18px_40px_-12px_rgb(0_0_0/0.7),0_2px_6px_rgb(0_0_0/0.5)]"
          : undefined
      }
      style={{ padding: pad, width: w + pad * 2 }}
      data-testid="display-frame"
      data-scale={scale}
    >
      <div style={{ width: w, height: h, overflow: "hidden" }}>
        <div
          style={{
            width: DISPLAY_WIDTH,
            height: DISPLAY_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
