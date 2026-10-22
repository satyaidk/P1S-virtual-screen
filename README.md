# P1S Virtual Screen

A virtual 320 × 240 touchscreen for a **Bambu Lab P1S + AMS**, with a deterministic printer
simulator and a development console. It is the reference implementation for a future
ESP32-S3 + LVGL hardware display: the screens, state model and command rules are designed here
first and then ported.

> **Status:** the simulator and UI are complete and tested. The real-printer path
> (`LanPrinterProvider` + local bridge) is implemented against a documented contract and
> unit-tested with a fake bridge, but has **not** been tested with a physical P1S.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

| URL        | Mode                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`        | Development console: the display at 1×/2×/3×/physical size + simulation controls, state inspector, event/telemetry/command logs, connection panel |
| `/display` | Display only (kiosk). Integer scale that fits the window, or `?scale=1`                                                                           |

No printer or credentials are needed. Click **Start sample print** on the display (or **Start** in
the console), then use the speed buttons (e.g. 60×) to watch a full job.

## What's inside

- **Screens:** home (job, progress, ETA, temperatures, active filament), temperature control,
  AMS trays, print control (pause/resume, stop with confirmation, speed presets, light, refresh),
  printer info, settings (simulated brightness, timeout/sleep, rotation, contrast theme, touch
  sound), notifications.
- **States:** offline, connecting, idle, preparing, printing, paused, finished, cancelled/failed,
  error, stale telemetry.
- **Simulator:** heaters, preparation stages, speed-dependent progress, filament use, faults
  (runout, heater fault, AMS humidity, rejected/ignored commands), Wi-Fi/MQTT loss, frozen telemetry.
  Four scenarios: standard, mid-print, no AMS, sparse telemetry.
- **Protocol layer:** zod-validated parser for Bambu MQTT reports, partial-report merge, verified
  command payloads, bridge WebSocket client with backoff.

## Scripts

| Command                           | What it does                                                         |
| --------------------------------- | -------------------------------------------------------------------- |
| `npm run dev`                     | Development server                                                   |
| `npm run typecheck`               | `tsc --noEmit` (strict)                                              |
| `npm run lint`                    | ESLint (Next.js core-web-vitals + TypeScript)                        |
| `npm run format` / `format:check` | Prettier                                                             |
| `npm test`                        | Vitest unit + integration tests                                      |
| `npm run build`                   | Production build                                                     |
| `npm run test:e2e`                | Playwright end-to-end tests (builds must exist; starts `next start`) |
| `npm run check`                   | typecheck + lint + tests + build                                     |

If Chromium is pre-installed (e.g. in a container), point Playwright at it:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome npm run test:e2e`. Otherwise run
`npx playwright install chromium` once.

## Configuration

See `.env.example`. Only non-secret values are read by the frontend. Printer credentials (LAN
access code) belong exclusively to the bridge — see `docs/bridge-api.md`.

## Project layout

```text
src/
  app/                      Next.js routes: / (console), /display (kiosk)
  components/virtual-display/  320×240 UI (screens, status bar, nav, dialogs)
  components/development-console/  simulation controls, inspector, logs
  display/                  navigation model, display settings, status colours
  hooks/                    React binding to the runtime
  printer/                  framework-free core: types, state, commands, runtime
    protocol/               Bambu MQTT parsing, merging, payload builders, bridge schema
    providers/              PrinterProvider, simulated + LAN implementations
    simulation/             deterministic engine, scenarios, clock
tests/{unit,integration,e2e}
docs/                       research, architecture, protocol, bridge API, hardware porting
```

## Branches and workflow

- `production` — stable, release branch. Changes arrive only through reviewed pull requests.
- `dev` — integration branch. Work is pushed here first.
- Flow: commit → push to `dev` → open PR `dev → production` → CI (typecheck, lint, format, unit,
  build, e2e) + review → merge.

## Documentation

- [docs/research.md](docs/research.md) — sources, verified facts, open questions
- [docs/architecture.md](docs/architecture.md) — layers, data flow, trade-offs
- [docs/protocol-notes.md](docs/protocol-notes.md) — field mapping and command payloads
- [docs/bridge-api.md](docs/bridge-api.md) — bridge contract, env vars, security
- [docs/hardware-porting.md](docs/hardware-porting.md) — ESP32-S3/LVGL mapping

## Limitations

- Real P1S connectivity is unverified; the bridge service is specified but not implemented.
- AMS load/unload and starting prints are intentionally not available (unverified payloads).
- No job thumbnails or camera (not available over MQTT on the P1S).
- Brightness, sleep and sound are browser simulations of hardware features.
