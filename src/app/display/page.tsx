import type { Metadata } from "next";
import { KioskDisplay } from "./KioskDisplay";

export const metadata: Metadata = { title: "P1S Display" };

/** Mode 1: only the 320x240 hardware display, no console. `?scale=1|2|3`, `?demo=1` for demo data. */
export default async function DisplayPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const { demo } = await searchParams;
  return <KioskDisplay demo={demo === "1"} />;
}
