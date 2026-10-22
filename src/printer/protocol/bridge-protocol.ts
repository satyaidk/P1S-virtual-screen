import { z } from "zod";
import type { PrinterCommand } from "../commands";

/**
 * Messages exchanged between the browser and the local MQTT bridge over WebSocket.
 * Specified in docs/bridge-api.md. Version this contract explicitly.
 */
export const BRIDGE_PROTOCOL_VERSION = 1;

export const bridgeServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    protocol: z.number().int(),
    printer: z.object({
      model: z.string(),
      name: z.string(),
      /** Bridges should send a masked serial; the UI masks again regardless. */
      serial: z.string().nullable(),
    }),
  }),
  z.object({
    type: z.literal("printer_link"),
    status: z.enum(["connected", "connecting", "disconnected"]),
    error: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("report"),
    /** Raw JSON object as received on device/{serial}/report. */
    payload: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("command_result"),
    requestId: z.string(),
    ok: z.boolean(),
    message: z.string().nullable().optional(),
  }),
]);

export type BridgeServerMessage = z.infer<typeof bridgeServerMessageSchema>;

export interface BridgeCommandMessage {
  type: "command";
  requestId: string;
  command: PrinterCommand;
}
