# Protocol notes (P1S local MQTT)

Implementation reference for `src/printer/protocol`. Sources and confidence levels are in
`research.md`.

## Report field mapping

| Bambu field                             | Normalized field               | Notes                                                                                                                    |
| --------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `gcode_state`                           | `status`                       | IDLE/INIT→idle, PREPARE/SLICING→preparing, RUNNING→printing, PAUSE→paused, FINISH→finished, FAILED→failed, other→unknown |
| `mc_percent`                            | `job.progress`                 | clamped 0–100                                                                                                            |
| `mc_remaining_time`                     | `job.remainingSeconds`         | minutes × 60                                                                                                             |
| `gcode_start_time`                      | `job.startedAt`                | Unix seconds → ms; `0` → null                                                                                            |
| derived                                 | `job.elapsedSeconds`           | `now − startedAt` while active (includes pauses)                                                                         |
| `subtask_name`                          | `job.name`                     | empty → null                                                                                                             |
| `layer_num`, `total_layer_num`          | `job.layer`, `job.totalLayers` |                                                                                                                          |
| `stg_cur`                               | `job.stage`                    | label table; only while preparing/printing/paused                                                                        |
| `nozzle_temper`, `nozzle_target_temper` | `nozzle.current/target`        |                                                                                                                          |
| `bed_temper`, `bed_target_temper`       | `bed.current/target`           |                                                                                                                          |
| `spd_lvl`                               | `speedLevel`                   | values outside 1–4 rejected                                                                                              |
| `print_error`                           | `printErrorCode` + alert       | 0 none; 50348044 = user cancel (no alert)                                                                                |
| `hms[]`                                 | `alerts` (`HMS_…`)             | list replaces previous HMS alerts; first-seen time kept                                                                  |
| `wifi_signal`                           | `connection.wifiSignalDbm`     | `"-45dBm"` → −45                                                                                                         |
| `nozzle_diameter`                       | `info.nozzleDiameter`          |                                                                                                                          |
| `lights_report[chamber_light].mode`     | `chamberLight`                 | anything but `off` = on                                                                                                  |
| `cooling_fan_speed`                     | `fans.part`                    | level 0–15 → percent, rounded to 10 % (as Bambu Studio shows it)                                                         |
| `big_fan1_speed`, `big_fan2_speed`      | `fans.aux`, `fans.chamber`     | same conversion                                                                                                          |
| `heatbreak_fan_speed`                   | `fans.heatbreak`               | same conversion; firmware-controlled, display only                                                                       |
| `ams.ams[].tray[]`                      | `ams.units[].trays[]`          | merged per unit id and slot                                                                                              |
| `ams.tray_exist_bits`                   | tray `state`                   | bit cleared → empty                                                                                                      |
| `ams.ams_exist_bits`                    | `ams.units` filter             | 0 → `[]` (no AMS)                                                                                                        |
| `ams.tray_now`                          | `ams.active`                   | 255 none, 254 external, n → unit n/4, slot n%4                                                                           |
| `vt_tray`                               | `ams.externalSpool`            | empty `tray_type` → empty                                                                                                |
| `info.module[name=ota].sw_ver`          | `info.firmware`                | from `get_version`                                                                                                       |

Ignored but recorded (`ignoredKeys`): everything else (xcam, ipcam, upgrade state, …).

## Merge rules

1. A field absent from a report keeps its previous value.
2. An invalid field is dropped and reported as a parse issue; it never erases existing state.
3. Trays merge field by field; `{ "id": "N" }` alone means the slot is empty.
4. Any applied report updates `connection.lastTelemetryAt` (freshness).
5. Unchanged branches keep object identity.

## Commands

| Intent              | Payload                                                                                      | QoS |
| ------------------- | -------------------------------------------------------------------------------------------- | --- |
| pause               | `{"print":{"command":"pause","param":"","sequence_id":"N"}}`                                 | 1   |
| resume              | `{"print":{"command":"resume","param":"","sequence_id":"N"}}`                                | 1   |
| stop                | `{"print":{"command":"stop","param":"","sequence_id":"N"}}`                                  | 1   |
| set_speed           | `{"print":{"command":"print_speed","param":"1..4"}}`                                         | 0   |
| set_nozzle_target   | `{"print":{"command":"gcode_line","param":"M104 S<t>\n"}}`                                   | 0   |
| set_bed_target      | `{"print":{"command":"gcode_line","param":"M140 S<t>\n"}}`                                   | 0   |
| set_chamber_light   | `{"system":{"command":"ledctrl","led_node":"chamber_light","led_mode":"on"}}` (or `"off"`)   | 0   |
| set_fan             | `gcode_line` `M106 P<1 part \| 2 aux \| 3 chamber> S<0–255>\n`                               | 0   |
| move_axis           | `gcode_line` `M211 S … M1002 push_ref_mode, G91, G1 <axis><mm> F<3000 XY \| 600 Z> … M211 R` | 0   |
| home_axes           | `gcode_line` `G28\n`                                                                         | 0   |
| extrude             | `gcode_line` `M83 \nG0 E<±mm> F900\n`                                                        | 0   |
| request_full_status | `{"pushing":{"command":"pushall","version":1,"push_target":1}}`                              | 0   |

Expected observable effect used to confirm each command: see `commandEffectObserved` in
`src/printer/commands.ts`.

## Bounds

Nozzle 0–300 °C, bed 0–100 °C, whole degrees. Fans 0–100 % (whole numbers). Axis moves 1–50 mm,
homing and extrusion only when no job is active; extrusion also needs the nozzle at ≥ 170 °C.
Motion commands are relative and therefore never retried automatically. Speed only while printing or paused. Pause only
while printing; resume only while paused; stop only while preparing/printing/paused, with
confirmation.

## Not implemented (by design, for now)

- Starting prints (`project_file`) — needs file upload via FTP and is out of scope for a display.
- AMS load/unload/change filament — payloads documented but unverified on P1S.
- Job thumbnails over MQTT — the P1S does not send them. The display instead reads the cover from
  the Bambu Cloud print task (`GET /v1/user-service/my/tasks`), so it works for prints started via
  Handy / Bambu Studio cloud / MakerWorld, not for SD-card or LAN-only prints.
- Camera — P1S uses a TLS JPEG socket on port 6000; must go through the bridge.
- Signed commands for cloud-mode printers.
