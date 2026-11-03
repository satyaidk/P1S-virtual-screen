# Printer bridge (built into the app server)

The browser never talks MQTT to the printer and never holds credentials. This app's Next.js server
holds them, keeps one MQTT session with the printer, and relays data to any number of browser
displays.

```text
Browser display ── SSE  /api/bridge/stream  ──┐
                 ── POST /api/bridge/command ──┤  Next.js server (src/server)
Console setup   ── /api/bambu/*  ──────────────┤   ├─ BambuCloudClient  ── HTTPS ─► api.bambulab.com
                                               │   └─ PrinterLink (mqtt.js)
                                               │        ├─ cloud: mqtts://us.mqtt.bambulab.com:8883
                                               │        └─ LAN:   mqtts://<printer-ip>:8883
                                               └─ .data/bambu-session.json (0600, git-ignored)
```

## Default: access code only

The printer's serial is built in (`src/server/printer-config.ts`, overridable with
`BAMBU_PRINTER_SERIAL`). Its IP comes from **network discovery** (`src/server/discovery.ts`): the
server listens on UDP 1990 (multicast `239.255.255.250`) and 2021 (broadcast) for the printer's
SSDP-style `NOTIFY` (`NT: urn:bambulab-com:device:3dprinter:1`, `USN: <serial>`,
`Location: <ip>`), and sends an `M-SEARCH` probe at start-up. The user only types the LAN access
code. The saved connection is marked `hostSource: "auto"`; when the printer is later announced at a
different IP (DHCP), the link is restarted at the new address. `BAMBU_PRINTER_HOST` or a typed IP
skips discovery.

## Hosted mode (Vercel)

Detected with `VERCEL=1` (or `P1S_HOSTED=1`). A serverless function cannot reach the LAN, keep a
process alive or write files, so `src/server/hosted-service.ts` replaces the local service:

- **Session:** the Bambu token, MQTT user id and chosen printer are sealed with AES-256-GCM
  (key from `P1S_SESSION_SECRET`) into the `p1s_session` cookie (HttpOnly, Secure,
  SameSite=Strict, at most 90 days). An in-progress email-code/2FA sign-in uses `p1s_login`
  (15 minutes). Without the secret, sign-in answers 503 with setup instructions.
- **Printer:** after sign-in the built-in serial is selected automatically if it is bound to the
  account (or the only printer on it).
- **Stream:** each `GET /api/bridge/stream` opens its own MQTT connection to Bambu Cloud and ends
  after 280 s (Vercel's limit is 300 s). The browser reconnects with `?resume=1`, so no extra
  `pushall` is sent, and keeps showing "connected" for a 5 s grace period, so the display doesn't flicker.
- **Commands:** read-only; `request_full_status` succeeds, everything else answers with the
  read-only reason. LAN/access-code connect answers 400.

## Ways to connect

| Mode                                | Needs                                                    | Data                | Control                                                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bambu Cloud**                     | Bambu account (the one the printer is bound to in Handy) | Live, from anywhere | **Read-only.** Since the January 2025 Authorization Control firmware, unsigned third-party commands over the cloud are rejected. Only `pushall` status requests are sent. |
| **LAN via account**                 | Signed in + printer IP                                   | Live, same network  | Pause/resume/stop/speed/temps/light — requires **LAN Only + Developer Mode** on the printer; otherwise the printer may refuse, and the UI shows the refusal               |
| **LAN, access code only** (default) | Access code; serial built in, IP discovered              | Live, same network  | Same as LAN via account                                                                                                                                                   |
| **LAN manual**                      | IP, serial, access code (printer: Settings → Network)    | Live, same network  | Same as above                                                                                                                                                             |

"Bind with PIN code" in Bambu Handy is a one-time step that links a printer to an account. This
app does not re-bind: it signs in to the account the printer is already bound to and lists it.

## Setup endpoints (`/api/bambu/*`, JSON)

| Method & path     | Body                                                                                                                                                             | Result                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET status`      | —                                                                                                                                                                | `{ myPrinter: {name, maskedSerial, host, hostSource, lastSeen, discoveryProblems}, cloud: {signedIn, account (masked), region}, pendingLogin, printer, link }` |
| `POST login`      | `{region, account, password}`                                                                                                                                    | `{step: "done" \| "verifyCode" \| "tfa"}`. On `verifyCode` the server already asked Bambu to email a code. The password is forwarded once and never stored.    |
| `POST email-code` | `{region, account}`                                                                                                                                              | Passwordless sign-in: Bambu emails a code → `{step: "verifyCode"}`                                                                                             |
| `POST verify`     | `{code}`                                                                                                                                                         | Completes the pending email-code or 2FA sign-in                                                                                                                |
| `GET devices`     | —                                                                                                                                                                | Printers bound to the account (serial, name, online…). Access codes are never returned.                                                                        |
| `POST connect`    | `{source:"access-code", accessCode, host?}` (default), `{source:"account", serial, mode:"cloud"\|"lan", host?}` or `{source:"manual", host, serial, accessCode}` | Saves the choice and starts the MQTT link. `access-code` waits up to 15 s for discovery; 404 if the printer is not found.                                      |
| `POST disconnect` | —                                                                                                                                                                | Stops the link, forgets the printer choice                                                                                                                     |
| `GET tasks`       | `?limit=1..20` (query)                                                                                                                                           | Recent prints of the selected printer from Bambu Cloud: `{tasks: [{id, title, cover, status, plateIndex, startTime, endTime, weightGrams, costTimeSeconds}]}`  |
| `GET cover`       | `?id=<task id>` (query)                                                                                                                                          | The task's plate preview image, proxied (the signed CDN URL never reaches the browser). Only ids from this printer's own history are served.                   |
| `POST logout`     | —                                                                                                                                                                | Stops the link and deletes the saved session                                                                                                                   |

Bambu API calls used (community-documented, see `research.md`): `POST /v1/user-service/user/login`,
`POST /v1/user-service/user/sendemail/code`, `POST bambulab.com/api/sign-in/tfa` (2FA),
`GET /v1/design-user-service/my/preference` (MQTT user id), `GET /v1/iot-service/api/user/bind`,
`GET /v1/user-service/my/tasks?deviceId=…` (print history + covers). `tasks`/`cover` need a Bambu
account sign-in; with only a LAN access code they answer 401 and the display shows its placeholder.

## Stream (`GET /api/bridge/stream`, Server-Sent Events)

Each event's `data` is one JSON message (`src/printer/protocol/bridge-protocol.ts`, v2):

```jsonc
// First message, and again whenever the printer choice changes.
{ "type": "hello", "protocol": 2,
  "printer": { "model": "P1S", "name": "Workshop", "serial": "•••••••••••3044" } | null,
  "mode": "cloud" | "lan" | null,
  "commands": ["request_full_status"],
  "readOnlyReason": "Read-only via Bambu Cloud — use LAN + Developer Mode to control" }

{ "type": "printer_link", "status": "connected" | "connecting" | "disconnected", "error": "…" | null }

// Sent to a newly connected browser: everything accumulated so far (P1 reports are partial).
{ "type": "snapshot", "state": { /* PrinterState */ } }

// Every message from device/{serial}/report, verbatim.
{ "type": "report", "payload": { "print": { "nozzle_temper": 212.5 } } }
```

A `: keepalive` comment is sent every 15 s.

## Commands (`POST /api/bridge/command`)

```jsonc
// request
{ "type": "command", "requestId": "req-7", "command": { "type": "pause" } }
// response
{ "type": "command_result", "requestId": "req-7", "ok": true, "message": null }
```

The server re-checks the command against the connection mode (cloud = read-only), requires
`confirmed: true` for `stop`, builds the payload with `buildBambuRequest`, publishes it with a fresh
`sequence_id`, and waits up to 4 s for the printer's reply with that `sequence_id`:
`result: "success"` → ok, anything else → `ok: false` with the printer's reason. No reply within the
window → `ok: true, message: "Sent; no acknowledgement"`; the browser's command manager still
requires the state change before it shows success. `pushall` is rate-limited to once per minute.

## Security

- Routes answer only requests addressed to `localhost` and reject cross-origin requests (blocks
  other websites and DNS rebinding). `P1S_ALLOW_LAN_CLIENTS=1` opens them to your LAN — only do
  that on a trusted network.
- Session file `.data/bambu-session.json` is created with mode `0600` and holds the Bambu token
  (valid ~3 months), MQTT user id, and the chosen printer (including its LAN access code). Delete it,
  or use Sign out, to revoke local access.
- Serials are masked in everything sent to the browser; access codes and tokens never are sent.
- LAN TLS is verified against Bambu's printer CA (bundled from OpenBambuAPI) with the serial as SNI;
  cloud TLS uses the system CAs. Verification is never disabled.

## Environment variables

| Variable                   | Default   | Purpose                                                        |
| -------------------------- | --------- | -------------------------------------------------------------- |
| `P1S_DATA_DIR`             | `./.data` | Where the session file lives                                   |
| `P1S_ALLOW_LAN_CLIENTS`    | unset     | `1` lets other devices on the network use the app              |
| `P1S_ALLOWED_HOSTS`        | unset     | Comma-separated exact hostnames also accepted (e.g. Tailscale) |
| `NEXT_PUBLIC_PRINTER_MODE` | unset     | `simulation` forces demo data (same as `?demo=1`)              |

## Troubleshooting the job preview (3D cover)

The preview comes from Bambu Cloud, in two steps. Check them in the same browser where you are
signed in (the requests use your session cookie):

1. `GET /api/bambu/tasks?limit=1` — the newest print. `cover` must be a path such as
   `/api/bambu/cover?id=123`. `null` means Bambu has no cover for that print (SD-card/LAN-only
   prints never have one); a 401 means you are not signed in to the Bambu account.
2. Open that `cover` path. It returns the image, or JSON `{ "error": … }` saying why (for example
   `Cover image unavailable (HTTP 403)`). Failures are also logged on the server as `[cover] task …`.

The display retries on its own: it re-checks the task every 30 s for about 5 minutes after a print
starts (covers can appear after the task), and retries a failed image download 3 times.
