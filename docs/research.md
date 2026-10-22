# Research log

Sources consulted before and during implementation, what was verified, and what is still open.
"Verified" means the value was read in protocol documentation **and** in working community source
code. Nothing here has been tested against a physical P1S yet.

## Sources

| Source                                                                                                                                             | Used for                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OpenBambuAPI — mqtt.md](https://github.com/Doridian/OpenBambuAPI/blob/main/mqtt.md)                                                               | Broker settings, topics, request/report envelope, `pushall`, `pause`/`resume`/`stop`, `print_speed`, `gcode_line`, `ledctrl`, `ams_change_filament`, `ams_control`, full P1 report example                                                                                  |
| [OpenBambuAPI — video.md](https://github.com/Doridian/OpenBambuAPI/blob/main/video.md)                                                             | P1/A1 camera: TLS JPEG stream on port 6000 (not RTSP)                                                                                                                                                                                                                       |
| [bambu-mcp — docs/mqtt-protocol.md](https://github.com/schwarztim/bambu-mcp/blob/main/docs/mqtt-protocol.md)                                       | P1S capture from Bambu Handy; signed-command format on post-Jan-2025 firmware; status/AMS report examples                                                                                                                                                                   |
| [ha-bambulab (pybambu)](https://github.com/greghesp/ha-bambulab/tree/main/custom_components/bambu_lab/pybambu)                                     | Field handling in production code: `const.py` (stage ids, gcode states, speed profiles, HMS severity/module tables), `commands.py` (payloads), `utils.py` (`M104`/`M140` temperature G-code, HMS decoding), `models.py` (partial-update merging, `print_error` cancel code) |
| [Bambu Lab wiki — Enable developer mode](https://wiki.bambulab.com/en/knowledge-sharing/enable-developer-mode)                                     | LAN-only + Developer Mode opens MQTT, live stream and FTP for third-party tools                                                                                                                                                                                             |
| [SimplyPrint — LAN-only & developer mode](https://help.simplyprint.io/en/article/bambu-lab-lan-only-mode-and-developer-mode-how-to-enable-xa0hch/) | Practical setup notes and the effect of Bambu's Authorization Control System                                                                                                                                                                                                |
| Bambu Lab P1S spec sheet                                                                                                                           | Max hotend 300 °C, max bed 100 °C (used as command bounds)                                                                                                                                                                                                                  |

Interface references (functional patterns only, no assets copied): Bambu Lab P1S/X1/P2S touchscreen
layouts, Bambu Handy and Bambu Studio device tabs, Klipper Mainsail/Fluidd dashboards, Prusa
MK4/XL display. Patterns adopted: persistent status bar, one-glance "job + progress + remaining"
hero, temperature tiles that double as navigation, AMS shown as four colour swatches with an
in-use marker, destructive actions behind a modal with the safe option first.

## Verified protocol facts

- **Local broker:** `mqtts://{printer_ip}:8883`, username `bblp`, password = LAN access code. The
  printer presents a self-signed certificate.
- **Topics:** reports on `device/{serial}/report`; requests on `device/{serial}/request`.
- **Envelope:** `{ "<type>": { "sequence_id": "<string>", "command": "<cmd>", ... } }`. Replies
  echo `sequence_id` and add `result` (case-insensitive) and sometimes `reason`.
- **Partial reports (P1 series):** `print.push_status` only contains fields that changed. A full
  snapshot requires `{"pushing":{"command":"pushall","version":1,"push_target":1}}`; OpenBambuAPI
  warns not to send it more often than every ~5 minutes on P1P.
- **State:** `gcode_state` ∈ IDLE, PREPARE, RUNNING, PAUSE, FINISH, FAILED (also INIT, SLICING,
  OFFLINE, UNKNOWN seen in ha-bambulab).
- **Progress:** `mc_percent` (0–100), `mc_remaining_time` (**minutes**), `layer_num`,
  `total_layer_num`, `subtask_name` (job), `gcode_start_time` (Unix seconds as a string).
- **Temperatures:** `nozzle_temper`, `nozzle_target_temper`, `bed_temper`, `bed_target_temper`.
- **Set temperature:** no dedicated command; `print.gcode_line` with `M104 S<t>\n` (nozzle) or
  `M140 S<t>\n` (bed) — exactly what ha-bambulab sends.
- **Speed:** `print.print_speed` with `param` "1".."4" (silent, standard, sport, ludicrous);
  reported as `spd_lvl`, with `spd_mag` = 50/100/124/166 %.
- **Pause / resume / stop:** `print.pause|resume|stop`, `param: ""`, QoS 1.
- **Stage:** `stg_cur` id → label table from ha-bambulab (`-1`/255 = none).
- **AMS:** `print.ams.ams[]` units with `humidity`, `temp`, `tray[]`; a tray object containing only
  `id` is an empty slot; `tray_color` is `RRGGBBAA`; `remain` = −1 when unmeasurable (non-RFID
  spool); `tray_exist_bits` (hex) marks loaded slots (bit = unit×4 + slot); `tray_now`: 255 none,
  254 external spool (`vt_tray`), otherwise unit×4 + slot.
- **Errors:** `hms[]` entries `{attr, code}` render as `HMS_AAAA_AAAA_CCCC_CCCC`; severity is
  `code >> 16` (1 fatal, 2 serious, 3 common, 4 info); module is `(attr >> 24) & 0xFF`.
  `print_error` = 50348044 (0x0300400C) is what the printer reports when a user cancels.
- **Chamber light:** `system.ledctrl` with `led_node: "chamber_light"`, `led_mode: on|off`;
  reported in `lights_report[]`.
- **Wi-Fi:** `wifi_signal` as a string like `"-45dBm"`.
- **Firmware:** `info.get_version` → `module[]`, the `ota` module's `sw_ver`.
- **Camera (P1S):** JPEG frames over TLS on port 6000 with an auth packet — a browser cannot open
  this socket; it needs the bridge.

## Bambu Cloud (added for the live connection)

Sources: OpenBambuAPI `cloud-http.md`, ha-bambulab `bambu_cloud.py` / `bambu_client.py`. Login error
shapes were checked against the live API with an invalid account (`{"code":1,"error":"Incorrect
account or password."}`, `{"code":4,"error":"Please login."}`).

- `POST https://api.bambulab.com/v1/user-service/user/login` with `{account, password}` returns
  `accessToken` (≈3 months) or `loginType: "verifyCode"` (email code needed) or `loginType: "tfa"`
  with `tfaKey`. With `{account, code}` it logs in with an emailed code.
- `POST /v1/user-service/user/sendemail/code` `{email, type: "codeLogin"}` sends that code.
- 2FA: `POST https://bambulab.com/api/sign-in/tfa` `{tfaKey, tfaCode}` with the `bbl_csrf_token`
  cookie from `GET https://bambulab.com/api/csrf`; the token comes back as a `token` cookie.
- MQTT username is `u_{uid}`: from the JWT payload `username`, else `GET
/v1/design-user-service/my/preference` → `uid`. Password = access token.
- Broker: `us.mqtt.bambulab.com:8883` (China: `cn.mqtt.bambulab.com`; API host `api.bambulab.cn`).
- `GET /v1/iot-service/api/user/bind` lists bound printers: `dev_id` (serial), `name`, `online`,
  `print_status`, `dev_model_name` (P1S = `C12`), `dev_product_name`, `dev_access_code`.
- The API is behind Cloudflare; ha-bambulab falls back to browser-impersonating clients when
  blocked. This app does not impersonate; it reports the block instead.
- **Bind with PIN code:** no public or community documentation exists for the PIN-binding call
  (only an unlabeled path list from an APK memory dump). It is also unnecessary for a printer that
  already appears in Handy, so it is not implemented.
- **Cloud control:** subscribing to `device/{serial}/report` and sending `pushall`/`get_version` work
  with an account token; control commands require Bambu's signed-command scheme on current
  firmware (the user's P1S runs 01.10.00.00), so cloud mode is read-only here.

## LAN discovery (added for "access code only")

Sources: Bambu Lab wiki port table (device discovery on UDP 1990/2021, SSDP multicast/broadcast, cloud
and LAN mode), Bambu forum thread "Use SSDP Standards" (example announcement), community
`bambu-ssdp-discovery.py` gist (Bambu Studio listens on 2021/udp).

Example announcement (X1C, from the forum; field set assumed identical on P1S):

```text
Host: 239.255.255.250:1990
Location: 192.168.1.64
NT: urn:bambulab-com:device:3dprinter:1
NTS: ssdp:alive
USN: <serial>
DevModel.bambu.com: 3DPrinter-X1-Carbon
DevName.bambu.com: MrSlinky
DevSignal.bambu.com: -30
DevConnect.bambu.com: cloud
DevBind.bambu.com: occupied
```

Unverified: whether a P1S answers `M-SEARCH` (the app does not rely on it; periodic announcements
are enough) and the exact `DevModel` string for P1S (`C12` per the cloud API's `dev_model_name`).

## Authentication and firmware

- Since the January 2025 "Authorization Control" firmware, cloud-connected printers reject
  unsigned third-party write commands. Signed commands use a `header` with an RSA-SHA256
  signature and app certificate (bambu-mcp). This project does **not** implement or bypass that.
- The supported route for local tools is **LAN-only mode + Developer Mode** (printer screen). On
  P1 series this was reported to arrive with firmware 01.08.02.00 (secondary source).
- Cloud MQTT (`us.mqtt.bambulab.com:8883`, user `u_{uid}`, password = access token) requires a
  Bambu account token. Not used here; no scraping of Bambu Handy.

## Decisions taken from the research

1. The browser never speaks MQTT/TLS to the printer and never holds tokens or access codes → this
   app's own server owns the MQTT session (see `bridge-api.md`).
2. Telemetry is merged, never replaced, because P1 reports are partial.
3. A transport ack is not success: commands are confirmed by observing the state change.
4. Only commands with verified payloads are exposed in LAN mode (see
   `src/printer/protocol/command-builders.ts`). Starting a print and AMS load/unload are not.
5. Thumbnails are not available over MQTT; the UI uses a designed placeholder.

## Unresolved questions

- **AMS humidity semantics.** `humidity` is an index, but sources disagree on whether 1 or 5 is
  driest. The UI shows the raw index ("Humidity idx 4") rather than guessing.
- **AMS load/unload on P1S.** `ams_change_filament` / `unload_filament` payloads exist in
  OpenBambuAPI, but temperatures and sequencing on current P1S firmware are unconfirmed.
  Disabled until tested.
- **Report cadence when idle.** Freshness threshold is 15 s; a real idle P1S may report less often.
  Needs measurement, then tuning of `DEFAULT_STALE_AFTER_MS`.
- **Elapsed time.** The printer reports a start time, not elapsed print time; for the LAN provider
  elapsed includes paused time. Confirm whether firmware exposes a better field.
- **Pause temperatures.** Whether the P1S drops the nozzle target while paused is not modelled.
- **HMS text.** Human-readable HMS messages come from Bambu's online database; the display shows
  code + module only.
- **Developer Mode requirement per firmware version** — verify on the actual printer.
