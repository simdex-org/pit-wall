# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pit Wall: a live browser dashboard for the "engineer" watching a driver in Assetto Corsa Competizione (Pro Engineer app), with remote pit stop control. Folders `server/` (bridge.py, acc_pit.py), `web/` (index.html, css/app.css, js/*.js, data/tracks.js), `docs/` (README screenshots); no framework, no build, no package manager. Git repo: github.com/simdex-org/pit-wall.

## Run

```
python server/bridge.py                                              # UDP 0.0.0.0:9001 -> http://127.0.0.1:8765, opens browser
python server/bridge.py --udp 0.0.0.0:9005 --http 127.0.0.1:8080 --no-browser
```

On the driver's PC (pit control): `python server/bridge.py --udp 127.0.0.1:9001 --http 0.0.0.0:8765`. Without the game: `--simulate-acc --key demo`. Self-test of the pit logic: `python server/acc_pit.py`.

Python 3.8+, stdlib only. The terminal app's LAN listener must be off first (two programs can't bind UDP 9001). Edit anything under `web/` and reload the page; only `server/bridge.py` changes need a restart.

## Architecture

Data flow: driver app --UDP JSON--> `server/bridge.py` --SSE `/events`--> `web/index.html`.

- **bridge.py** keeps one global `STATE` (guarded by `LOCK`) holding the latest datagram of each stream, and also serves `web/` statically (`/` -> `index.html`). Two datagram kinds are distinguished by shape: `what == "pro-engineer/session"` is the 30 Hz **reading**; `magic == "acpe"` is the 10 Hz **summary** (advice, debrief, fuel/stint figures). Anything else is dropped. `/events` pushes a payload whenever `STATE["ver"]` changes, plus a heartbeat every 1 s, including `*_age_ms` so the page can tell live from stale.
- **web/index.html** is markup; **css/app.css** styles; **js/** is plain scripts loaded in order, sharing globals: `util.js` (settings in localStorage, unit conversion, formatters), `recorder.js` (60 s trace buffer, per-lap 400-point recordings vs track position, tyre history, event log, laps import/export), `charts.js` (canvas: live rows, compare rows, G-force, map), `views.js` (one render fn per tab), `main.js` (tabs, welcome, SSE, render loop). `connect()` → `onReading()` (per-reading accumulation: throttle/brake/speed trace ring buffer, client-side lap list, learned track coordinates) → `render()` (idempotent DOM update from latest `reading`/`summary`/`ages`). `renderAdvice()` re-renders only when advice/debrief JSON changes. The reading payload is `reading.reading.{car,session,fixed,capabilities}`; optional UI rows are gated on `capabilities` flags.
- **web/data/tracks.js** defines `window.TRACKS`; currently only `nurburgring_24h` (`box`, `loop` = 800 uniformly spaced points with index 0 = start/finish in driving direction, plus `pit` and `labels`). The car is placed by `session.track_position` (0..1) indexed into `loop`. `trackFor()` in charts.js maps `fixed.track` names to entries; for unknown tracks the map is learned from `car_position_m` (x, z) as the car laps.

- **acc_pit.py** sets ACC's pitstop MFD by sending scan-code key presses (pit key twice = cursor on the first row, then arrows; Up wraps to the last row) and reads `mfdFuelToAdd`/`mfdTyreSet`/`mfdTyrePressure*` back from `Local\acpmf_graphics` (offsets at the top of the file). `apply()` first discovers the layout with `probe()` (one step and back, watching what changes), then steers each value. `FakeMfd` mirrors the layout for the self-test and `--simulate-acc`; keep it in step with `apply()`. Keys are only sent while `AC2-Win64-Shipping.exe` is the foreground window.
- **POST /pit** needs the `X-Pit-Key` header (`--key`, random per start); the page takes it from `?key=` and keeps it in localStorage. SSE payloads carry `pit` (MFD snapshot) and `pit_job` (running/done/error with per-field results). The pit panel is on the Strategy tab (`renderPit` in views.js).

## Notes

- `ALERT` thresholds in util.js mirror the desktop application's defaults; keep them in sync with it.
- Icons come from Lucide via unpkg (SRI-pinned) — the only network dependency. Dynamically added icons need `lucide.createIcons({nodes})`.
- `web/data/tracks.js` is large generated data; don't read it whole.
