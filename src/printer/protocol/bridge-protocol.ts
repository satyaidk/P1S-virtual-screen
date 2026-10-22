import { z } from "zod";
import type { PrinterCommand } from "../commands";
import type { PrinterState } from "../types";

/**
 * Messages between the browser and the bridge (built into this app's server, see
 * src/server and docs/bridge-api.md). Server → browser travels over Server-Sent Events,
 * browser → server over HTTP POST. Version this contract explicitly.
 */
export const BRIDGE_PROTOCOL_VERSION = 2;

export const linkModeSchema = z.enum(["cloud", "lan"]);
export type LinkMode = z.infer<typeof linkModeSchema>;

export const bridgeServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    protocol: z.number().int(),
    printer: z
      .object({
        model: z.string(),
        name: z.string(),
        /** Masked by the server; the UI masks again regardless. */
        serial: z.string().nullable(),
      })
      .nullable(),
    /** How the server reaches the printer; null when nothing is configured yet. */
    mode: linkModeSchema.nullable().optional(),
    /** Command types this connection can deliver. */
    commands: z.array(z.string()).optional(),
    /** Why commands are unavailable (e.g. cloud connections are read-only). */
    readOnlyReason: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("printer_link"),
    status: z.enum(["connected", "connecting", "disconnected"]),
    error: z.string().nullable().optional(),
  }),
  z.object({
    /** Full normalized state accumulated by the server (P1 reports are partial). */
    type: z.literal("snapshot"),
    state: z.record(z.string(), z.unknown()),
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

export type BridgeServerMessage =
  | Exclude<z.infer<typeof bridgeServerMessageSchema>, { type: "snapshot" }>
  | { type: "snapshot"; state: PrinterState };

export interface BridgeCommandMessage {
  type: "command";
  requestId: string;
  command: PrinterCommand;
}

export const bridgeCommandMessageSchema = z.object({
  type: z.literal("command"),
  requestId: z.string().min(1).max(64),
  command: z.object({ type: z.string() }).passthrough(),
});
