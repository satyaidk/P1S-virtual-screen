import { z } from "zod";

/**
 * Zod schemas for the subset of Bambu Lab MQTT report fields this app consumes.
 * Field names and value encodings are taken from OpenBambuAPI (mqtt.md) and the
 * ha-bambulab integration; see docs/protocol-notes.md. Bambu frequently encodes numbers as
 * strings ("4", "22.7"), so numeric fields accept both.
 *
 * Every field is validated independently by the telemetry parser: one malformed field must not
 * discard the rest of a report.
 */

const numericString = z.string().regex(/^-?\d+(\.\d+)?$/);

export const numeric = z.union([z.number().finite(), numericString.transform(Number)]);
export const integer = numeric.refine((n) => Number.isInteger(n), "expected an integer");

export const hexColor = z.string().regex(/^[0-9A-Fa-f]{8}$/);
export const hexBits = z.string().regex(/^[0-9A-Fa-f]{1,8}$/);

export const traySchema = z.object({
  id: integer,
  tray_type: z.string().optional(),
  tray_color: hexColor.optional(),
  tray_info_idx: z.string().optional(),
  remain: integer.optional(),
  nozzle_temp_min: numeric.optional(),
  nozzle_temp_max: numeric.optional(),
});
export type RawTray = z.infer<typeof traySchema>;

export const amsUnitSchema = z.object({
  id: integer,
  humidity: integer.optional(),
  temp: numeric.optional(),
  tray: z.array(traySchema).optional(),
});
export type RawAmsUnit = z.infer<typeof amsUnitSchema>;

export const amsSchema = z.object({
  ams: z.array(amsUnitSchema).optional(),
  ams_exist_bits: hexBits.optional(),
  tray_exist_bits: hexBits.optional(),
  tray_now: integer.optional(),
});
export type RawAms = z.infer<typeof amsSchema>;

export const hmsEntrySchema = z.object({ attr: integer, code: integer });
export type RawHmsEntry = z.infer<typeof hmsEntrySchema>;

export const lightsReportSchema = z.array(z.object({ node: z.string(), mode: z.string() }));

/** Per-field schemas of the `print` object of a report. Unknown fields are ignored. */
export const printFieldSchemas = {
  gcode_state: z.string(),
  mc_percent: numeric,
  mc_remaining_time: numeric,
  gcode_start_time: numeric,
  subtask_name: z.string(),
  layer_num: integer,
  total_layer_num: integer,
  stg_cur: integer,
  nozzle_temper: numeric,
  nozzle_target_temper: numeric,
  bed_temper: numeric,
  bed_target_temper: numeric,
  spd_lvl: integer,
  cooling_fan_speed: integer,
  big_fan1_speed: integer,
  big_fan2_speed: integer,
  heatbreak_fan_speed: integer,
  print_error: integer,
  wifi_signal: z.string(),
  nozzle_diameter: z.union([z.string(), z.number()]).transform(String),
  hms: z.array(hmsEntrySchema),
  lights_report: lightsReportSchema,
  ams: amsSchema,
  vt_tray: traySchema,
} as const;

export type PrintFieldName = keyof typeof printFieldSchemas;

/** Fields that describe a command response rather than state. */
export const ackSchema = z.object({
  command: z.string(),
  sequence_id: z.union([z.string(), z.number()]).transform(String).optional(),
  result: z.string().optional(),
  reason: z.string().optional(),
});

export const versionInfoSchema = z.object({
  command: z.literal("get_version"),
  module: z.array(z.object({ name: z.string(), sw_ver: z.string().optional() })),
});
