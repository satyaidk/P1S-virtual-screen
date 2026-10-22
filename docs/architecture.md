# Architecture

## Goal

A browser reference implementation of a 320 × 240 printer touchscreen whose state model, command
rules and navigation can later be re-implemented in C/LVGL on an ESP32-S3.

## Layers

```text
┌──────────────────────────── Browser ─────────────────────────────┐
│  Virtual display (React, fixed 320×240)    Development console    │
│        │  usePrinter(selector)                    │               │
│        ▼                                          ▼               │
│  zustand store  ◄── PrinterRuntime ──► EventLog, telemetry history │
│                        │      │                                   │
│               CommandManager  │ subscribe / getState              │
│                        ▼      ▼                                   │
│                   PrinterProvider (interface)                     │
│           ┌────────────────┴──────────────────┐                   │
│ SimulatedPrinterProvider              LanPrinterProvider          │
│   SimulationEngine (deterministic)    ConnectionManager (WS)      │
│                                       parseReport → mergeTelemetry│
└───────────────────────────────────────────┬──────────────────────┘
                                            │ WebSocket (bridge-api.md)
                                   Local bridge (not in this repo)
                                            │ MQTT over TLS :8883
                                       Bambu Lab P1S
```

| Module                                 | Responsibility                                                                                     | Depends on React? |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------- |
| `src/printer/types.ts`                 | Normalized `PrinterState`; `null` = unknown                                                        | No                |
| `src/printer/state.ts`                 | Defaults, freshness, `deriveDisplayStatus`, P1S limits, speed presets                              | No                |
| `src/printer/commands.ts`              | `PrinterCommand` union, specs (destructive/idempotent), `validateCommand`, `commandEffectObserved` | No                |
| `src/printer/schemas.ts`               | zod schemas for Bambu report fields                                                                | No                |
| `src/printer/protocol/*`               | Topics, wire constants, `parseReport`, `mergeTelemetry`, command builders, bridge message schema   | No                |
| `src/printer/simulation/*`             | `SimulationEngine`, scenarios, injectable `Clock` / `ManualClock`                                  | No                |
| `src/printer/providers/*`              | `PrinterProvider` interface, simulated & LAN providers, factory                                    | No                |
| `src/printer/command-manager.ts`       | validate → pending → send → ack → observe → settle; retries only idempotent commands               | No                |
| `src/printer/runtime.ts`               | Composition root; logs transitions; structural sharing                                             | No                |
| `src/display/*`                        | Navigation model, display settings, status → colour mapping, display UI store                      | Store only        |
| `src/hooks/*`                          | React binding (`PrinterRuntimeProvider`, `usePrinter`, `useNow`)                                   | Yes               |
| `src/components/virtual-display/*`     | The 320×240 UI                                                                                     | Yes               |
| `src/components/development-console/*` | Simulation controls, inspector, logs, connection                                                   | Yes               |

Everything under `src/printer` and `src/display` (except the zustand store) is plain TypeScript and
is the part meant to be ported.

## Data flow

**Telemetry.** Provider produces a frozen `PrinterState` → runtime applies `replaceEqualDeep`
(unchanged sub-trees keep identity) → logs transitions (connection, print status, alerts) and the
changed paths → zustand store → components subscribe to narrow slices, so a temperature tick does
not re-render the AMS screen.

**Commands.**

1. A control calls `runtime.execute(command)`; controls are disabled using the same
   `validateCommand` the manager runs.
2. `CommandManager` rejects unsupported/invalid/duplicate commands before sending.
3. It records a `pending` request (the UI shows "Pausing…").
4. `provider.sendCommand` resolves with the printer's (or bridge's) acknowledgement.
5. The manager then waits until telemetry satisfies `commandEffectObserved` (e.g. status becomes
   `paused`). Ack without the effect → `timeout`. Negative ack → `failed`.
6. Only idempotent, non-destructive commands are re-sent after an ack timeout. `stop`, `pause`,
   `resume` and `start_sample_job` are never retried automatically.

`stop` additionally carries `confirmed: true`, which only the confirmation dialog sets; validation
rejects it otherwise.

## Display status priority

`deriveDisplayStatus`: disconnected → connecting → stale → error (unless paused) → print status.
The status bar, main screen and info screen all use this single function.

## Simulation

The engine is deterministic: no timers, no randomness. `step(ms)` integrates heaters (first-order
lag towards target or ambient), the preparation sequence (bed preheat → leveling → hotend), print
progress scaled by the speed preset, filament consumption and faults. The provider drives it with a
`Clock` interval at a configurable speed multiplier; tests use `ManualClock`.

The engine models the **printer**, which keeps printing when Wi-Fi drops; the provider stops
publishing while the link is down, so the display's values freeze until reconnection — the same
behaviour as a real network outage.

## Trade-offs

- **Client-only runtime.** Nothing printer-related renders on the server. Simpler hydration, and the
  display is a client device anyway.
- **One simulation per tab.** `/` and `/display` in two tabs run independent simulators. Sharing
  would need a backend, which the bridge will provide in LAN mode.
- **zod in the browser** costs bundle size but gives per-field validation identical to what the
  bridge can run.
- **Draft-then-apply temperatures** avoid a command per +/- tap on the constrained P1 link.

## Testing

| Level       | Location            | Covers                                                                                                                                                                                                   |
| ----------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `tests/unit`        | Parser, merge, validation, builders, engine, helpers                                                                                                                                                     |
| Integration | `tests/integration` | Runtime + simulated provider + command manager; LAN provider with a fake bridge socket                                                                                                                   |
| End-to-end  | `tests/e2e`         | Real browser: layout bounds, readability, print lifecycle, pause/resume, cancel confirmation, AMS, sparse data, connectivity, staleness, failures, shared state, navigation, settings, display-only mode |
