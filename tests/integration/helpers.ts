import { ManualClock } from "@/printer/simulation/clock";

export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Advance a ManualClock in small slices, letting promise callbacks run in between. */
export async function advance(clock: ManualClock, ms: number, slice = 50): Promise<void> {
  let left = ms;
  while (left > 0) {
    const d = Math.min(slice, left);
    clock.advance(d);
    left -= d;
    await flush();
  }
}
