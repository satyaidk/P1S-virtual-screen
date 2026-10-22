import type { CommandResult, CommandType, PrinterCommand } from "../commands";
import type { EventCategory, EventLevel } from "../event-log";
import type { DataSource, PrinterState } from "../types";
import type { SimulationControls } from "./SimulatedPrinterProvider";

export interface ProviderCapabilities {
  /** Commands this provider can deliver. The UI disables everything else. */
  commands: ReadonlySet<CommandType>;
}

export interface ProviderEvent {
  category: EventCategory;
  level: EventLevel;
  message: string;
  data?: unknown;
}

/**
 * Boundary between the UI and any source of printer data. The virtual display only ever talks to
 * this interface, never to the simulator or a transport directly.
 */
export interface PrinterProvider {
  readonly kind: DataSource;
  readonly capabilities: ProviderCapabilities;
  /** Present only on the simulated provider. */
  readonly simulation?: SimulationControls;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** Immutable (frozen) snapshot of the current state. */
  getState(): PrinterState;
  subscribe(listener: (state: PrinterState) => void): () => void;
  onEvent(listener: (event: ProviderEvent) => void): () => void;

  /**
   * Deliver a command. Resolves with the transport/printer acknowledgement only; callers must
   * still observe telemetry to confirm the effect (see CommandManager).
   */
  sendCommand(command: PrinterCommand): Promise<CommandResult>;

  dispose(): void;
}

/** Small helper for providers to manage listeners. */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  on(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const l of [...this.listeners]) l(value);
  }

  clear(): void {
    this.listeners.clear();
  }
}
