# P1S Virtual Screen

A 320 × 240 touchscreen for a **Bambu Lab P1S + AMS** that shows **your real printer's live data**,
plus a development console. It is the reference implementation for a future ESP32-S3 + LVGL
hardware display: screens, state model and command rules are proven here first, then ported.

## Connect your printer

```bash
npm install
npm run dev            # then open http://localhost:3000 on the same computer
```

1. In **Printer connection**, sign in with the Bambu account your P1S is bound to (the one you use
   in Bambu Handy). Use your password, or **Email me a code** and type the code Bambu sends.
2. Your printers appear in the list. Pick one:
   - **View via Bambu Cloud**: works from anywhere, **read-only** (current firmware rejects
     control commands from third-party apps over the cloud).
   - **Connect via LAN**: enter the printer's IP (printer screen → Settings → Network). Pause,
     resume, stop, speed, temperatures and light need **LAN Only + Developer Mode** enabled on
     the printer.
3. The display shows live temperatures, progress, AMS trays, errors… Open `/display` for the screen
   alone.

No Bambu account? Use **LAN only, without a Bambu account** with the IP, serial number and access
code shown on the printer.

You don't need to "Bind with PIN code" again: that Handy step links a printer to an account once,
and your printer is already bound. Credentials stay on this computer: the password is forwarded once
to Bambu and never stored, and the session token is saved in `.data/` (git-ignored, owner-only).
See [docs/bridge-api.md](docs/bridge-api.md).

> **Status:** the live connection is implemented and tested against a real MQTT broker with a
> simulated P1S, and against mocked Bambu cloud responses. It has **not** yet been run against a
> physical printer — please report what you see on yours.

| URL                           | What                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/`                           | Console: the display at 1×/2×/3×/physical size, printer setup, live state JSON, event/telemetry/command logs |
| `/display`                    | Display only (kiosk). Integer scale that fits the window, or `?scale=1`                                      |
| `/?demo=1`, `/display?demo=1` | Development only: simulated printer with fault injection                                                     |

**Run it locally for your printer.** The live connection keeps an MQTT session open and stores your
Bambu session on disk, which serverless hosting (e.g. the Vercel preview deployments of this repo)
cannot do, and a public URL must not expose printer control. Hosted deployments therefore only
serve demo mode (`/?demo=1`); the setup routes answer with an explanation.

## What's inside

- **Screens:** home (job, progress, ETA, temperatures, active filament), temperature control,
  AMS trays, print control (pause/resume, stop with confirmation, speed presets, light, refresh),
  printer info, settings (simulated brightness, timeout/sleep, rotation, contrast theme, touch
  sound), notifications.
- **States:** offline, connecting, idle, preparing, printing, paused, finished, cancelled/failed,
  error, stale telemetry.
- **Server bridge (`src/server`):** Bambu Cloud sign-in (password, email code, 2FA), printer list,
  MQTT session (cloud or LAN with verified TLS), state accumulation for P1 partial reports, command
  relay with printer acknowledgements, SSE stream to any number of displays.
- **Protocol layer:** zod-validated parser for Bambu MQTT reports, partial-report merge, verified
  command payloads.
- **Demo simulator** (development only): heaters, preparation stages, speed-dependent progress,
  faults, network loss, frozen telemetry.

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

See `.env.example`. Nothing secret is ever read by the frontend; the server keeps the Bambu session
in `.data/`. To use the display from another device (phone, Raspberry Pi), set
`P1S_ALLOW_LAN_CLIENTS=1` and start with `npm run dev -- -H 0.0.0.0` on a trusted network.

## Project layout

```text
src/
  app/                      Next.js routes: / (console), /display (kiosk), /api/* (bridge)
  server/                   Bambu cloud client, MQTT link, session store (server-only)
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

- Not yet run against a physical P1S (see Status above).
- Bambu Cloud connections are read-only; control requires LAN + Developer Mode.
- Bambu's API sits behind Cloudflare and occasionally blocks non-browser clients; the console then
  shows "Blocked by Bambu's Cloudflare protection" — retry later or use LAN.
- AMS load/unload and starting prints are intentionally not available (unverified payloads).
- No job thumbnails or camera (not available over MQTT on the P1S).
- Brightness, sleep and sound are browser simulations of hardware features.
