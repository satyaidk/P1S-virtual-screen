import type { CommandType, PrinterCommand } from "../commands";
import type { BambuRequest } from "./mqtt-types";

/**
 * Builders for commands whose payloads are verified in OpenBambuAPI mqtt.md and the
 * ha-bambulab integration. Anything not listed here has no verified payload and must not be sent.
 *
 * Intended to be shared with the local bridge (docs/bridge-api.md), which owns publishing.
 */

export const LAN_SUPPORTED_COMMANDS: ReadonlySet<CommandType> = new Set<CommandType>([
  "pause",
  "resume",
  "stop",
  "set_speed",
  "set_nozzle_target",
  "set_bed_target",
  "set_chamber_light",
  "request_full_status",
]);

export class UnsupportedCommandError extends Error {
  constructor(type: string) {
    super(`No verified Bambu payload for command "${type}"`);
    this.name = "UnsupportedCommandError";
  }
}

export function buildBambuRequest(command: PrinterCommand, sequenceId: string): BambuRequest {
  switch (command.type) {
    case "pause":
    case "resume":
    case "stop":
      return {
        qos: 1,
        payload: { print: { sequence_id: sequenceId, command: command.type, param: "" } },
      };
    case "set_speed":
      return {
        qos: 0,
        payload: {
          print: { sequence_id: sequenceId, command: "print_speed", param: String(command.level) },
        },
      };
    case "set_nozzle_target":
      return gcodeLine(sequenceId, `M104 S${command.celsius}\n`);
    case "set_bed_target":
      return gcodeLine(sequenceId, `M140 S${command.celsius}\n`);
    case "set_chamber_light":
      return {
        qos: 0,
        payload: {
          system: {
            sequence_id: sequenceId,
            command: "ledctrl",
            led_node: "chamber_light",
            led_mode: command.on ? "on" : "off",
            led_on_time: 500,
            led_off_time: 500,
            loop_times: 0,
            interval_time: 0,
          },
        },
      };
    case "request_full_status":
      return {
        qos: 0,
        payload: {
          pushing: { sequence_id: sequenceId, command: "pushall", version: 1, push_target: 1 },
        },
      };
    case "start_sample_job":
      throw new UnsupportedCommandError(command.type);
  }
}

function gcodeLine(sequenceId: string, gcode: string): BambuRequest {
  return {
    qos: 0,
    payload: { print: { sequence_id: sequenceId, command: "gcode_line", param: gcode } },
  };
}
