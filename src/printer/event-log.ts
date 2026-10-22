export type EventCategory =
  "connection" | "state" | "command" | "alert" | "telemetry" | "protocol" | "simulation";

export type EventLevel = "info" | "warn" | "error";

export interface LogEvent {
  id: number;
  at: number;
  category: EventCategory;
  level: EventLevel;
  message: string;
  data?: unknown;
}

export type LogEventInput = Omit<LogEvent, "id" | "at"> & { at?: number };

/** Bounded, append-only diagnostic log (oldest entries are evicted first). */
export class EventLog {
  private items: LogEvent[] = [];
  private seq = 0;
  private listeners = new Set<(items: readonly LogEvent[]) => void>();

  constructor(
    private readonly now: () => number,
    readonly capacity = 200,
  ) {}

  push(input: LogEventInput): LogEvent {
    const event: LogEvent = { ...input, id: ++this.seq, at: input.at ?? this.now() };
    this.items = [...this.items, event].slice(-this.capacity);
    this.emit();
    return event;
  }

  entries(): readonly LogEvent[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
    this.emit();
  }

  subscribe(listener: (items: readonly LogEvent[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l(this.items);
  }
}
