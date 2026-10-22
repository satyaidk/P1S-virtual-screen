"use client";

import { useEffect, useState } from "react";
import { DisplayFrame } from "@/components/virtual-display/DisplayFrame";
import {
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  VirtualDisplay,
} from "@/components/virtual-display/VirtualDisplay";
import { PrinterRuntimeProvider } from "@/hooks/usePrinter";
import { defaultProviderConfig } from "@/printer/providers/provider-factory";

function useScale(): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const requested = Number(new URLSearchParams(window.location.search).get("scale"));
    const compute = () => {
      if (requested > 0) return setScale(requested);
      // Largest integer scale that fits keeps pixels crisp.
      const fit = Math.floor(
        Math.min(window.innerWidth / DISPLAY_WIDTH, window.innerHeight / DISPLAY_HEIGHT),
      );
      setScale(Math.max(1, fit));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  return scale;
}

export function KioskDisplay({ demo = false }: { demo?: boolean }) {
  const scale = useScale();
  const [config] = useState(() => defaultProviderConfig(demo));
  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <PrinterRuntimeProvider config={config}>
        <DisplayFrame scale={scale} bezel={false}>
          <VirtualDisplay />
        </DisplayFrame>
      </PrinterRuntimeProvider>
    </div>
  );
}
