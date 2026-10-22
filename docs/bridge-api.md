# Local bridge API (contract v1)

The browser cannot safely speak MQTT over TLS to the printer, and it must never hold the LAN access
code. A small local service — the **bridge** — owns the printer connection. This document is the
contract `LanPrinterProvider` implements. **The bridge itself is not part of this repository yet,
and the LAN path has not been tested against a real P1S.**

```text
Browser ──WebSocket (JSON)──► Bridge ──MQTT/TLS :8883 (bblp + access code)──► P1S
```

## Endpoint

`GET ws://<bridge-host>:<port>/v1/stream` — WebSocket upgrade. Bind to `127.0.0.1` or the LAN
interface only. The frontend reads the URL from `NEXT_PUBLIC_BRIDGE_URL` (a public, non-secret
value).

## Server → client messages

```jsonc
// Sent once after the socket opens.
{ "type": "hello", "protocol": 1,
  "printer": { "model": "P1S", "name": "Workshop", "serial": "••••••••••0001" } }

// State of the bridge's MQTT session with the printer.
{ "type": "printer_link", "status": "connected" | "connecting" | "disconnected",
  "error": "optional human-readable reason" }

// Every message received on device/{serial}/report, forwarded verbatim as JSON.
{ "type": "report", "payload": { "print": { "nozzle_temper": 212.5 } } }

// Outcome of a command: after the printer's reply with the same sequence_id
// (ok = result == "success"), or after the bridge's own timeout/failure.
{ "type": "command_result", "requestId": "req-7", "ok": true, "message": null }
```

## Client → server messages

```jsonc
{ "type": "command", "requestId": "req-7", "command": { "type": "pause" } }
```

`command` is a `PrinterCommand` (`src/printer/commands.ts`). The bridge must:

1. Re-validate it (type allow-list, temperature bounds, `stop` must have `confirmed: true`).
2. Build the payload with the shared `buildBambuRequest` (`src/printer/protocol/command-builders.ts`).
3. Assign an incrementing `sequence_id`, publish to `device/{serial}/request` with the given QoS.
4. Answer with `command_result` when the matching report arrives, or `ok: false` after ~5 s.
5. Never auto-retry `stop`, `pause` or `resume`.
6. Rate-limit `request_full_status` (P1 printers lag when `pushall` is sent too often).

## Client behaviour (already implemented)

- Reconnects with exponential backoff (1 s → 30 s cap); in-flight commands fail on disconnect.
- On `printer_link: connected` it sends one `request_full_status`.
- Validates every message with zod; unknown messages are logged and ignored.
- Treats `command_result.ok` as an acknowledgement only; success requires the state change.

## Environment variables

| Variable                   | Where    | Secret    | Purpose                                |
| -------------------------- | -------- | --------- | -------------------------------------- |
| `NEXT_PUBLIC_PRINTER_MODE` | frontend | no        | `simulation` (default) or `lan-bridge` |
| `NEXT_PUBLIC_BRIDGE_URL`   | frontend | no        | e.g. `ws://127.0.0.1:8787/v1/stream`   |
| `BAMBU_PRINTER_HOST`       | bridge   | no        | printer IP                             |
| `BAMBU_PRINTER_SERIAL`     | bridge   | sensitive | used for MQTT topics                   |
| `BAMBU_ACCESS_CODE`        | bridge   | **yes**   | LAN access code (MQTT password)        |
| `BRIDGE_ALLOWED_ORIGINS`   | bridge   | no        | Origin allow-list for the WebSocket    |

## Security considerations

- The access code lives only in the bridge's environment — never in `NEXT_PUBLIC_*`, browser
  storage or the client bundle.
- Check the WebSocket `Origin` header; LAN-only binding; no internet exposure.
- The printer uses a self-signed certificate. Pin the printer's certificate (or Bambu's CA from
  OpenBambuAPI `tls.md`) instead of disabling verification.
- Mask the serial number before sending it to the browser.
- Printer prerequisites: LAN-only mode and Developer Mode enabled on the printer (current firmware
  rejects unsigned third-party control otherwise). Do not attempt to bypass Bambu's authorization.

## Suggested implementation (future)

Node.js + `mqtt` + `ws`, reusing `src/printer/protocol/*` and `src/printer/commands.ts` directly.
Test it against a recorded report stream before the real printer.
