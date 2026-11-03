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
  "set_fan",
  "move_axis",
  "home_axes",
  "extrude",
  "request_full_status",
]);

/** `M106 P<n>` fan index on P1-series firmware (ha-bambulab, OpenBambuAPI). */
export const FAN_GCODE_INDEX = { part: 1, aux: 2, chamber: 3 } as const;

const XY_FEED_MM_MIN = 3000;
const Z_FEED_MM_MIN = 600;
const EXTRUDE_FEED_MM_MIN = 900;

function mm(n: number): string {
  // Fixed one decimal: Bambu firmware expects "10.0", never "1e1".
  return n.toFixed(1);
}

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
    case "set_fan":
      return gcodeLine(
        sequenceId,
        `M106 P${FAN_GCODE_INDEX[command.fan]} S${Math.round((command.percent / 100) * 255)}\n`,
      );
    case "move_axis": {
      const feed = command.axis === "Z" ? Z_FEED_MM_MIN : XY_FEED_MM_MIN;
      // Same sequence Bambu Studio's jog panel sends: soft-endstops on, relative move, restore.
      return gcodeLine(
        sequenceId,
        "M211 S\nM211 X1 Y1 Z1\nM1002 push_ref_mode\nG91 \n" +
          `G1 ${command.axis}${mm(command.distanceMm)} F${feed}\n` +
          "M1002 pop_ref_mode\nM211 R\n",
      );
    }
    case "home_axes":
      return gcodeLine(sequenceId, "G28\n");
    case "extrude":
      return gcodeLine(sequenceId, `M83 \nG0 E${mm(command.distanceMm)} F${EXTRUDE_FEED_MM_MIN}\n`);
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
