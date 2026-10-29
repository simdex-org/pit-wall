# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pit Wall: a live browser dashboard for the "engineer" watching a driver in Assetto Corsa Competizione, with remote pit stop control. Everything runs from this repo: the bridge reads ACC's shared memory itself. Folders `server/` (bridge.py, acc_telemetry.py, acc_pit.py), `web/` (index.html, css/app.css, js/*.js, data/tracks.js), `docs/` (README screenshots); no framework, no build, no package manager. Git repo: github.com/simdex-org/pit-wall.

## Run

```
python server/bridge.py --http 25.x.x.x:8765          # on the driver's PC, on its VPN address; without --http: 127.0.0.1 only
python server/bridge.py --simulate-acc --key demo     # a pretend session and pit page, no game needed
python server/acc_telemetry.py; python server/acc_pit.py   # self-tests
```

Python 3.8+, stdlib only, Windows for the game side. Edit anything under `web/` and reload the page; only `server/bridge.py` changes need a restart.

## Architecture

Data flow: ACC shared memory --> `acc_telemetry.py` (in `bridge.py`, 30 Hz) --SSE `/events`--> `web/index.html`; pit plans go back as POST /pit --> `acc_pit.py` --> MFD key presses.

- **bridge.py** keeps one global `STATE` (guarded by `LOCK`) holding the latest **reading** (30 Hz) and **summary** (10 Hz: advice, debrief, fuel/stint figures, and `stint`: each lap of the current stint with time, validity, fuel and pad millimetres, which the Degradation and Brake pads modules use), both built by `acc_telemetry.Telemetry` from `AccPages.read()` (or `FakePages` with `--simulate-acc`), and also serves `web/` statically (`/` -> `index.html`). The advice rules and the GT3 pressure windows live in `Telemetry.advice()`. `/events` pushes a payload whenever `STATE["ver"]` changes, plus a heartbeat every 1 s, including `*_age_ms` so the page can tell live from stale.
- **web/index.html** is markup; **css/app.css** styles; **js/** is plain scripts loaded in order, sharing globals: `util.js` (settings in localStorage, unit conversion, formatters), `recorder.js` (60 s trace buffer, per-lap 400-point recordings vs track position, tyre history, event log, laps import/export), `charts.js` (canvas: live rows, compare rows, G-force, map), `views.js` (one render fn per tab; the Strategy modules each have their own), `board.js` (the Strategy tab as a board: module order, size and visibility in `S.board`, theme in `S.theme`/`S.accent`, edit mode with drag/resize/tools; `MODS` lists every module's default and minimum size, and a module is a `<section class="mod" data-mod>` in index.html), `main.js` (tabs, welcome, SSE, render loop). `connect()` → `onReading()` (per-reading accumulation: throttle/brake/speed trace ring buffer, client-side lap list, learned track coordinates) → `render()` (idempotent DOM update from latest `reading`/`summary`/`ages`). `renderAdvice()` re-renders only when advice/debrief JSON changes. The reading payload is `reading.reading.{car,session,fixed,capabilities}`; optional UI rows are gated on `capabilities` flags.
- **web/data/tracks.js** defines `window.TRACKS`; currently only `nurburgring_24h` (`box`, `loop` = 800 uniformly spaced points with index 0 = start/finish in driving direction, plus `pit` and `labels`). The car is placed by `session.track_position` (0..1) indexed into `loop`. `trackFor()` in charts.js maps `fixed.track` names to entries; for unknown tracks the map is learned from `car_position_m` (x, z) as the car laps.

- **acc_pit.py** sets ACC's pitstop MFD by sending scan-code key presses (pit key twice = cursor on the first row, then arrows; Up wraps to the last row) and reads `mfdFuelToAdd`/`mfdTyreSet`/`mfdTyrePressure*` back from `Local\acpmf_graphics` (offsets at the top of the file). `apply()` first discovers the layout with `probe()` (one step and back, watching what changes), then steers each value. `FakeMfd` mirrors the layout for the self-test and `--simulate-acc`; keep it in step with `apply()`. Keys are only sent while `AC2-Win64-Shipping.exe` is the foreground window.
- Every request must be addressed to an IP or `localhost` (`host_ok`, against DNS rebinding). **POST /pit** needs the `X-Pit-Key` header (`--key`, 128-bit random per start); the page takes it from `?key=` and keeps it in localStorage. SSE payloads carry `pit` (MFD snapshot) and `pit_job` (running/done/error with per-field results). The pit panel is on the Strategy tab (`renderPit` in views.js).

## Notes

- `ALERT` defaults in util.js match the thresholds in acc_telemetry.py; keep them in step.
- Icons come from Lucide via unpkg (SRI-pinned) — the only network dependency. Dynamically added icons need `lucide.createIcons({nodes})`.
- `web/data/tracks.js` is large generated data; don't read it whole.
