"use client";

import type { ReactNode } from "react";
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from "./VirtualDisplay";

/** Physical panel: 2.4" diagonal, 4:3 → 1.92" × 1.44" active area. */
export const PANEL_WIDTH_INCHES = 1.92;

/** CSS scale that renders the panel at real-world size, given CSS px per inch of the monitor. */
export function physicalScale(cssPxPerInch = 96): number {
  return (PANEL_WIDTH_INCHES * cssPxPerInch) / DISPLAY_WIDTH;
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
  const pad = bezel ? Math.max(6, Math.round(14 * Math.min(scale, 2))) : 0;
  return (
    <div
      className={
        bezel ? "rounded-2xl border border-ink-600 bg-[#050606] shadow-[0_0_0_1px_#000]" : undefined
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
