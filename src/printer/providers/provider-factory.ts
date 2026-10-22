import type { Clock } from "../simulation/clock";
import { LanPrinterProvider } from "./LanPrinterProvider";
import type { PrinterProvider } from "./PrinterProvider";
import {
  SimulatedPrinterProvider,
  type SimulatedProviderOptions,
} from "./SimulatedPrinterProvider";

export type ProviderConfig =
  | ({ mode: "simulation" } & SimulatedProviderOptions)
  | { mode: "lan-bridge"; bridgeUrl: string; clock?: Clock };

export function createPrinterProvider(config: ProviderConfig): PrinterProvider {
  switch (config.mode) {
    case "simulation": {
      const { mode: _mode, ...options } = config;
      void _mode;
      return new SimulatedPrinterProvider(options);
    }
    case "lan-bridge":
      return new LanPrinterProvider({ bridgeUrl: config.bridgeUrl, clock: config.clock });
  }
}

/**
 * Default configuration from public env vars. Only non-secret values may be read here:
 * the bridge URL is public; printer credentials live exclusively in the bridge process.
 */
export function defaultProviderConfig(): ProviderConfig {
  const mode = process.env.NEXT_PUBLIC_PRINTER_MODE;
  const bridgeUrl = process.env.NEXT_PUBLIC_BRIDGE_URL;
  if (mode === "lan-bridge" && bridgeUrl) return { mode: "lan-bridge", bridgeUrl };
  return { mode: "simulation" };
}
