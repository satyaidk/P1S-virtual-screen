"use client";

import { useEffect, useRef, useState } from "react";
import { Segmented } from "@/components/ui/Button";
import {
  bezelPadding,
  DisplayFrame,
  PANEL_WIDTH_INCHES,
  physicalScale,
} from "@/components/virtual-display/DisplayFrame";
import {
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  VirtualDisplay,
} from "@/components/virtual-display/VirtualDisplay";

type Zoom = "fit" | 1 | 2 | 3 | "physical";

const ZOOMS = [
  { value: "fit", label: "Fit", testId: "zoom-fit" },
  { value: 1, label: "1×", testId: "zoom-1" },
  { value: 2, label: "2×", testId: "zoom-2" },
  { value: 3, label: "3×", testId: "zoom-3" },
  { value: "physical", label: "Actual size", testId: "zoom-physical" },
] satisfies { value: Zoom; label: string; testId: string }[];

/** Room the dimension lines take beside the device. */
const RULER = 28;

/** Largest scale (up to 3×) at which the device and its rulers fit the stage width. */
function useFitScale(ref: React.RefObject<HTMLDivElement | null>): number {
  const [scale, setScale] = useState(2);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const room = (entry?.contentRect.width ?? 0) - RULER;
      let s = 3;
      while (s > 0.5 && DISPLAY_WIDTH * s + 2 * bezelPadding(s) > room) s -= 0.125;
      setScale(s);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return scale;
}

/**
 * The device on the bench: the virtual display in its bezel on a cutting mat, with dimension
 * lines that state the logical resolution the hardware will have.
 */
export function DisplayStage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const fit = useFitScale(stageRef);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [ppi, setPpi] = useState(96);
  const scale = zoom === "fit" ? fit : zoom === "physical" ? physicalScale(ppi) : zoom;
  const pad = bezelPadding(scale);
  const millimetres = Math.round(PANEL_WIDTH_INCHES * 25.4 * 10) / 10;

  return (
    <section
      aria-label="Virtual display"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="min-w-[14rem] flex-1">
          <h2 className="text-[15px] font-semibold">Display</h2>
          <p className="text-[13px] text-fg-muted">
            2.4-inch panel, {DISPLAY_WIDTH} × {DISPLAY_HEIGHT}. Tap it as you would the real one.
          </p>
        </div>
        <Segmented label="Display zoom" items={ZOOMS} value={zoom} onChange={setZoom} />
      </div>

      <div
        ref={stageRef}
        className="cutting-mat flex flex-1 justify-center overflow-auto border-t border-line px-3 py-6 sm:min-h-[320px] sm:px-7 sm:py-8"
        data-testid="display-stage"
      >
        <div
          className="m-auto grid grid-cols-[auto_auto] grid-rows-[auto_auto]"
          style={{ columnGap: 0 }}
        >
          <span aria-hidden />
          <Dimension orientation="horizontal" length={DISPLAY_WIDTH * scale} inset={pad}>
            {DISPLAY_WIDTH} px
          </Dimension>
          <Dimension orientation="vertical" length={DISPLAY_HEIGHT * scale} inset={pad}>
            {DISPLAY_HEIGHT} px
          </Dimension>
          <DisplayFrame scale={scale}>
            <VirtualDisplay />
          </DisplayFrame>
        </div>
      </div>

      <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-2 text-[13px] text-fg-muted">
        <span className="tabular">Scale {scale.toFixed(2)}×</span>
        {zoom === "physical" ? (
          <label className="flex items-center gap-2">
            Your screen&apos;s pixels per inch
            <input
              type="number"
              min={60}
              max={300}
              value={ppi}
              onChange={(e) => setPpi(Number(e.target.value) || 96)}
              className="tabular h-7 w-16 rounded-md border border-line-strong bg-bench px-2 text-fg focus-visible:outline-2 focus-visible:outline-mat-ink"
            />
          </label>
        ) : (
          <span>
            Panel width {PANEL_WIDTH_INCHES} in ({millimetres} mm)
          </span>
        )}
      </div>
    </section>
  );
}

/** Technical-drawing dimension line with end ticks, aligned to the panel (not the bezel). */
function Dimension({
  orientation,
  length,
  inset,
  children,
}: {
  orientation: "horizontal" | "vertical";
  length: number;
  inset: number;
  children: React.ReactNode;
}) {
  const horizontal = orientation === "horizontal";
  return (
    <div
      aria-hidden
      className="flex items-center justify-center text-mat-ink"
      style={
        horizontal
          ? { height: RULER, paddingLeft: inset, paddingRight: inset }
          : { width: RULER, paddingTop: inset, paddingBottom: inset }
      }
    >
      <div
        className={
          horizontal
            ? "relative flex h-3 items-center border-x border-mat-ink"
            : "relative flex w-3 items-center justify-center border-y border-mat-ink"
        }
        style={horizontal ? { width: length } : { height: length }}
      >
        <span
          className={
            horizontal
              ? "absolute inset-x-0 top-1/2 h-px bg-mat-ink/60"
              : "absolute inset-y-0 left-1/2 w-px bg-mat-ink/60"
          }
        />
        <span
          className={
            horizontal
              ? "relative mx-auto bg-mat px-1.5 font-mono text-[11px] leading-none"
              : "relative bg-mat py-1.5 font-mono text-[11px] leading-none [writing-mode:vertical-rl] rotate-180"
          }
        >
          {children}
        </span>
      </div>
    </div>
  );
}
