"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DisplayFrame, physicalScale } from "@/components/virtual-display/DisplayFrame";
import { VirtualDisplay } from "@/components/virtual-display/VirtualDisplay";

type Zoom = 1 | 2 | 3 | "physical";

export function DisplayStage() {
  const [zoom, setZoom] = useState<Zoom>(2);
  const [ppi, setPpi] = useState(96);
  const scale = zoom === "physical" ? physicalScale(ppi) : zoom;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Display zoom">
        {([1, 2, 3] as const).map((z) => (
          <Button
            key={z}
            variant={zoom === z ? "active" : "default"}
            onClick={() => setZoom(z)}
            data-testid={`zoom-${z}`}
          >
            {z === 1 ? "100% (1:1)" : `${z}×`}
          </Button>
        ))}
        <Button
          variant={zoom === "physical" ? "active" : "default"}
          onClick={() => setZoom("physical")}
          data-testid="zoom-physical"
        >
          Physical size
        </Button>
        {zoom === "physical" && (
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            CSS px/inch
            <input
              type="number"
              min={60}
              max={300}
              value={ppi}
              onChange={(e) => setPpi(Number(e.target.value) || 96)}
              className="h-8 w-16 rounded-md border border-ink-600 bg-ink-850 px-2 text-fg"
            />
          </label>
        )}
      </div>
      <DisplayFrame scale={scale}>
        <VirtualDisplay />
      </DisplayFrame>
      <p className="text-center text-xs text-fg-dim">
        Logical 320 × 240 · scale {scale.toFixed(2)}×
        {zoom === "physical" && " · 2.4″ panel (calibrate px/inch for your monitor)"}
      </p>
    </div>
  );
}
