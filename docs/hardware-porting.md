# Porting to ESP32-S3 + LVGL

The web app is a functional reference for the firmware, not code that runs on the device. Target:
ESP32-S3 R16N8 (16 MB flash, 8 MB PSRAM), 2.4″ IPS touch panel, 320 × 240 landscape, LVGL.

## What carries over

| Web module                                                                   | Firmware equivalent                                                      | Reuse                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| `printer/types.ts`                                                           | `printer_state_t` struct; `null` → `has_*` flags or `NAN`/`-1` sentinels | Same fields and meaning                          |
| `printer/state.ts` (`deriveDisplayStatus`, staleness, limits, speed presets) | `printer_state.c` pure functions                                         | Rewrite 1:1 in C                                 |
| `printer/commands.ts` (validation, effect predicates, specs)                 | `commands.c`                                                             | Rewrite 1:1; keep the unit test cases as C tests |
| `protocol/telemetry-parser.ts` + `state-merge.ts`                            | ArduinoJson / cJSON parse into the struct, merge in place                | Same field table (`protocol-notes.md`)           |
| `protocol/command-builders.ts`                                               | `snprintf` JSON templates                                                | Identical payloads                               |
| `command-manager.ts`                                                         | FreeRTOS task + queue; pending request table with deadlines              | Same state machine                               |
| `event-log.ts`                                                               | Ring buffer in PSRAM                                                     | Same capacity semantics                          |
| `display/navigation.ts`                                                      | LVGL screen table + back stack                                           | Same screens and transitions                     |
| `display/settings.ts`                                                        | NVS-stored settings; backlight PWM; buzzer                               | Same options                                     |
| `simulation/*`                                                               | Optional on-device demo mode                                             | Port if useful                                   |
| React components                                                             | LVGL screens/widgets                                                     | Re-implement; layout numbers below               |

## Connectivity choice

1. **Direct MQTT from the ESP32** (`esp-mqtt` with TLS, `bblp` + access code). No extra hardware;
   the access code is stored in NVS (encrypt with flash encryption). Needs Developer Mode.
   P1 reports can be large (full `pushall` ≈ several KB) — parse with a streaming/filtering
   JSON parser and keep buffers in PSRAM.
2. **Through the bridge** (WebSocket, `bridge-api.md`). Smaller, pre-validated messages and no
   printer credentials on the display, at the cost of running a service.

Both options keep the same state model; only the provider changes, as in the browser.

## Layout reference (logical px)

| Region                           | Size                                   |
| -------------------------------- | -------------------------------------- |
| Status bar                       | 320 × 22                               |
| Content area                     | 320 × 178                              |
| Bottom navigation                | 320 × 40 (5 tabs × 64)                 |
| Main: thumbnail placeholder      | 64 × 64                                |
| Main: progress bar               | full width × 6                         |
| Main: temperature/filament tiles | 3 × (≈100 × 46)                        |
| Buttons                          | ≥ 36 px tall; primary actions 40–44 px |

At 320 px across a 48.8 mm-wide panel, 1 px ≈ 0.15 mm: a 40 px button is ≈ 6 mm — the practical
minimum for a fingertip. Avoid targets below 36 px.

## Visual tokens → LVGL styles

| Token    | Hex       | Use                           |
| -------- | --------- | ----------------------------- |
| ink-950  | `#0A0C0D` | screen background             |
| ink-850  | `#161A1C` | tiles / cards                 |
| ink-700  | `#272C30` | borders                       |
| fg       | `#F2F4F5` | primary text                  |
| fg-muted | `#A8B0B6` | secondary text                |
| ok       | `#3CC46F` | printing, success             |
| info     | `#4AA3EC` | preparing, selection, pending |
| warn     | `#F2A93B` | paused, stale, warnings       |
| danger   | `#EF5A5A` | offline, errors, stop         |

Font: Inter 10/11/13/16/20/26 px with tabular digits; convert with the LVGL font converter
(include only the glyphs used: Latin, digits, `°%…→≈•`). Icons: export the used Lucide glyphs to
an icon font or 16-px images.

Transitions: 120 ms fade + 4 px slide (`lv_scr_load_anim` with `LV_SCR_LOAD_ANIM_FADE_IN` or a
custom animation). Pressed state = brighter background, no layout change. No blur/gradients.

## Must be rewritten

- All rendering (React → LVGL), touch handling and sleep (real backlight + touch IRQ wake).
- Networking, TLS, reconnect timing, NTP for the clock.
- Memory management: fixed-size buffers, no unbounded arrays (alerts, AMS units ≤ 4).

## Behaviour to keep identical

- Status priority (offline > connecting > stale > error > print status).
- Draft-then-apply temperatures; P1S bounds 300/100 °C.
- Stop requires a confirmation dialog; destructive commands never retried.
- Commands are confirmed by observed telemetry, not by publish success.
- Unknown values display as `--` / "Not reported", never as invented defaults.
