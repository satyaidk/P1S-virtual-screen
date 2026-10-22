/**
 * Injectable time source. Production code uses SystemClock; tests use ManualClock so that
 * timers, timeouts and the simulation loop are fully deterministic.
 */
export type TimerHandle = number;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as TimerHandle,
  clearTimeout: (h) => globalThis.clearTimeout(h as unknown as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms) as unknown as TimerHandle,
  clearInterval: (h) => globalThis.clearInterval(h as unknown as ReturnType<typeof setInterval>),
};

interface ScheduledTimer {
  id: TimerHandle;
  due: number;
  fn: () => void;
  interval: number | null;
}

export class ManualClock implements Clock {
  private time: number;
  private nextId = 1;
  private timers: ScheduledTimer[] = [];

  constructor(start = 1_700_000_000_000) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    return this.add(fn, ms, null);
  }

  setInterval(fn: () => void, ms: number): TimerHandle {
    return this.add(fn, ms, Math.max(1, ms));
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }

  clearInterval(handle: TimerHandle): void {
    this.clearTimeout(handle);
  }

  /** Advance time, firing due timers in chronological order. */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const next = this.timers
        .filter((t) => t.due <= end)
        .sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!next) break;
      this.time = Math.max(this.time, next.due);
      if (next.interval !== null) next.due += next.interval;
      else this.timers = this.timers.filter((t) => t !== next);
      next.fn();
    }
    this.time = end;
  }

  pendingTimers(): number {
    return this.timers.length;
  }

  private add(fn: () => void, ms: number, interval: number | null): TimerHandle {
    const id = this.nextId++;
    this.timers.push({ id, due: this.time + Math.max(0, ms), fn, interval });
    return id;
  }
}
