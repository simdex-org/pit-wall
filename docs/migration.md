# Migration to Node.js

The Python bridge, the plain-JS page and the customtkinter launcher were replaced by TypeScript: `packages/bridge`, `apps/web` (React and Tailwind) and `apps/launcher` (Tauri). The behaviour and the page protocol are the same.

## Status

| Part | State |
|---|---|
| Config validation, telemetry, strategy, advice | done, tested |
| Simulator (`--simulate-acc`), simulated field and pit page | done, tested |
| Broadcasting client and field standings | done, tested against the simulated field and the wire format |
| Pit page driver, key injection, vJoy | done; the driver is tested on every page layout, the key injection needs a real ACC session |
| HTTP server, SSE, static files, access key | done, checked against the Python bridge's payload keys |
| Page: shell, editor, settings, appearance, template manager | done |
| Page: all modules (timing, strategy, fuel calculator, pit plan, car, 3D car, charts, laps, analysis, log) | done, run against the simulated race on several tracks |
| Tauri launcher and installer | done, driven end to end through WebView2 |
| Python `server/`, old `web/`, `tools/` | to delete (see below) |

## Not carried over

- The launcher no longer updates itself from GitHub. The bridge ships inside the app, so an update is a new installer.
- The vendored three.js file is gone: the page imports it from the `three` package and loads it only when a 3D module opens.

## What needs a real ACC session

These parts cannot be proven without the game and should be checked by running `pnpm --filter @pitwall/bridge start` while driving:

- Shared-memory reading (`telemetry/pages.ts`). `--probe` prints the fields that were never verified.
- Keys reaching ACC and the pit page changing (`pit/acc-mfd.ts`), with the keyboard and with vJoy.
- The broadcasting registration against a live port (`broadcast/client.ts`).
