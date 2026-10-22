import type { Clock } from "../simulation/clock";
import { BridgePrinterProvider } from "./BridgePrinterProvider";
import type { PrinterProvider } from "./PrinterProvider";
import {
  SimulatedPrinterProvider,
  type SimulatedProviderOptions,
} from "./SimulatedPrinterProvider";

export type ProviderConfig =
  | ({ mode: "simulation" } & SimulatedProviderOptions)
  | { mode: "live"; bridgeUrl: string; clock?: Clock };

export const DEFAULT_BRIDGE_URL = "/api/bridge";

export function createPrinterProvider(config: ProviderConfig): PrinterProvider {
  switch (config.mode) {
    case "simulation": {
      const { mode: _mode, ...options } = config;
      void _mode;
      return new SimulatedPrinterProvider(options);
    }
    case "live":
      return new BridgePrinterProvider({ bridgeUrl: config.bridgeUrl, clock: config.clock });
  }
}

/**
 * Real printer data by default. The simulator is a development aid only: enable it with
 * `?demo=1` in the URL or NEXT_PUBLIC_PRINTER_MODE=simulation.
 */
export function defaultProviderConfig(demo = false): ProviderConfig {
  if (demo || process.env.NEXT_PUBLIC_PRINTER_MODE === "simulation") return { mode: "simulation" };
  return { mode: "live", bridgeUrl: process.env.NEXT_PUBLIC_BRIDGE_URL || DEFAULT_BRIDGE_URL };
}
