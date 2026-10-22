import type { Metadata } from "next";
import { KioskDisplay } from "./KioskDisplay";

export const metadata: Metadata = { title: "P1S Display" };

/** Mode 1: only the 320x240 hardware display, no console. `?scale=1|2|3` or fit-to-window. */
export default function DisplayPage() {
  return <KioskDisplay />;
}
