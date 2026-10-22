import "server-only";

/**
 * The printer this display is built for (from the Bambu Handy "Firmware Version" screen).
 * Only the access code has to be typed: the serial is known here and the IP address is found
 * automatically on the LAN (see discovery.ts).
 *
 * Environment variables override these values, e.g. to point the app at another printer:
 *   BAMBU_PRINTER_SERIAL, BAMBU_PRINTER_NAME, BAMBU_PRINTER_HOST (fixed IP, skips discovery)
 */
export interface MyPrinter {
  serial: string;
  name: string;
  model: string;
  /** Fixed IP/host; null means "discover it on the network". */
  host: string | null;
}

export const DEFAULT_PRINTER_SERIAL = "01P00C662003044";

export function myPrinter(): MyPrinter {
  return {
    serial: (process.env.BAMBU_PRINTER_SERIAL || DEFAULT_PRINTER_SERIAL).trim().toUpperCase(),
    name: process.env.BAMBU_PRINTER_NAME?.trim() || "Bambu Lab P1S",
    model: "P1S",
    host: process.env.BAMBU_PRINTER_HOST?.trim() || null,
  };
}
