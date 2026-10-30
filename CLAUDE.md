# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pit Wall: a live browser dashboard for the race engineer watching a driver in Assetto Corsa Competizione, with remote pit stop control and timing for the whole field. Everything runs from this repo: the bridge reads ACC's shared memory and broadcasting API itself. Folders `server/` (bridge.py, acc_telemetry.py, acc_broadcast.py, acc_pit.py, launcher.py = PitWall.exe, which loads bridge.py from disk and updates the folder from main), `web/` (index.html, css/, js/, fonts/, data/tracks.js), `docs/` (README screenshots); no framework, no build, no package manager. Git repo: github.com/simdex-org/pit-wall.

## Run

```
python server/bridge.py --http 25.x.x.x:8765          # on the driver's PC, on its VPN address; without --http: 127.0.0.1 only
python server/bridge.py --simulate-acc --key demo     # a pretend race, 20-car field and pit page, no game needed
python server/bridge.py --simulate-acc --sim-session quali --key demo   # the same as qualifying (field ordered by best lap)
python server/acc_broadcast.py --enable               # once, ACC closed: switch on ACC's broadcasting port (field timing)
python server/acc_telemetry.py; python server/acc_broadcast.py; python server/acc_pit.py; python server/launcher.py --selftest   # self-tests, all must pass
python server/launcher.py                             # the start window (PitWall.exe: python -m PyInstaller --onefile --windowed --name PitWall server/launcher.py)
python server/acc_telemetry.py --probe                # live session: print the not-yet-verified shared-memory fields
```

Python 3.8+, stdlib only, Windows for the game side. Edit anything under `web/` and reload the page; only `server/` changes need a restart. Bridge flags: `--key`, `--pit-key`, `--key-ms`, `--vjoy [N]`, `--broadcast-port` (0 = field timing off), `--broadcast-password`, `--sim-session race|quali`, `--no-browser`.

## Architecture

Data flow: ACC shared memory --> `acc_telemetry.py` (30 Hz) and ACC broadcasting UDP --> `acc_broadcast.py` (both in `bridge.py`) --SSE `/events?hz=`--> the page; pit plans go back as POST /pit --> `acc_pit.py` --> MFD key presses (or vJoy buttons).

- **bridge.py** keeps one global `STATE` (guarded by `LOCK`): the latest **reading** (30 Hz), **summary** (10 Hz: advice, debrief, stints, stops, `stint` laps, and `strategy`), the bridge's lap list, the **field** snapshot (every 250 ms when it changed, plus per-car slow fields by `seq`), the **entries** (roster, track), `bc` (field timing state), `config` (thresholds and strategy inputs, shared by every screen), the pit MFD snapshot and job, and the log. `/events` pushes whatever changed since that client's last send, plus a heartbeat with `*_age_ms`. Every **strategy** figure (box lap, fuel to add, stops needed, pit window, the stop options with `reach`/`more_stops`/`outside_window` (a stop outside the pit window is not the mandatory one), rejoin) is worked out once in `Telemetry.strategy()` so all screens agree; the page does no strategy maths. A field bug never stops the telemetry thread (`field_err` logs it once). Endpoints: GET `/events`, `/lap?n=` (a lap's 400-point trace), `/field/laps?car=`; POST `/pit`, `/config`, `/mfd/close` (all need `X-Pit-Key`).
- **acc_broadcast.py**: the broadcasting client (127.0.0.1 only, registers without the command password, sends only requests 9–11, never camera/HUD), `Field` (standings, gap/interval by distance with the interval from the two gaps to P1, relative, pits, lap history, net position, rejoin), `FakeField` for `--simulate-acc`, `--enable` to edit broadcasting.json.
- **web/index.html** is the shell; scripts load in this order and share globals:
  - `util.js` — DOM/escaping (`esc`), storage (`lsGet/lsSet/lsRaw/lsDel`, all try/catch), enums, units (`un`, `fv`, `fvu`), formatters (`fmtLap`, `fmtDelta`, `fmtGap`, `fmtRel` = the one unsigned car-to-car gap rule, `plural`, `MINUS`), state functions (`pressState`, `tyreState`, …), and the helpers every module uses (`setHtml`, `kvHtml`, `deltaHtml`, `carRow`, `rowKey`, `clickFocus`, `sparkSvg`).
  - `workspaces.js` — **`Pit`** (the API modules use: `ctx`, `prefs`, `key`, `focus`, `module()`, `on/emit`, `dirty(channel)`, `setFocus`, `select`, `setCursor`, `post`, `get`, `log`, `say`, `tokens()`, `carName`) and **`WS`** (mounts a workspace of the tab's template into `#ws`, keeps instances whose id and type are unchanged, places them on the 12-column grid whose rows stretch to the window height; below 1100 px a flex column; the render scheduler calls a module only when one of its `needs` channels is dirty, at most `rate` times a second; `requires` channels gate it to an "unavailable" state).
  - `templates.js` — built-in templates (read-only data) and **`Tpl`** (load/save in `pitwall.templates`, `fork`, `use`, and `Tpl.sanitize`, which rebuilds any template from scratch).
  - `appearance.js` — **`Appearance`**: colour tokens and layout settings applied as CSS variables on `<html>`; built-ins fork on the first change; `Appearance.sanitize` for imports.
  - `editor.js` — **`Editor`**: edit mode (drag/resize/keyboard, undo/redo, workspaces, catalogue drawer) and the module options dialog. A built-in forks lazily on the first real change; Discard drops that fork and reloads a template saved meanwhile in another tab.
  - `manager.js` — **`Manager`**: template manager, import/export (`.pitwall.json`, never containing the access key), and `migrate()` from the old `engineer.*` keys.
  - `settings.js` — **`Settings`**: connection (key), units, layout (KPI strip cells), appearance, thresholds and strategy inputs (POST /config), data.
  - `recorder.js` (`REC`: 60 s trace ring, per-lap recordings, racing lines, laps import/export, `ensureLap` from GET /lap), `charts.js` (canvas drawing: live channels, lap traces, G-G, the track map with `bindMapControls` zoom about the pointer/pan/follow).
  - the modules: `mod-timing.js`, `mod-strategy.js`, `mod-pit.js`, `mod-car.js`, `mod-laps.js`, `mod-log.js`.
  - `main.js` — the feed (`onPayload` → `ctx`), the chrome (tabs, KPI strip with the focus chip, engineer bar and drawer), keyboard shortcuts, boot.
- **A module** is `Pit.module({type, title, group, blurb, size:{w,h,minW,minH}, multi, linkable, needs, requires, rate, options, tools, build(el, inst), render(ctx, inst), destroy?, resize?, key?, tool?})` (`linkable`, and `linked` in templates, are reserved: nothing reads them since the *Follow the focus car* option was removed). `render` must be idempotent; use `inst.setInfo(text)` for the header line, `inst.setState('empty'|'na', msg, action?)` instead of drawing nothing, `inst.setAlert(level, count)` (0–2; feeds the tab badge and marks the module), `inst.opts` (frozen, already sanitised), `inst.state` (scratch). Channels: `reading summary field entries laps config pit focus sel rec log tick units theme resize`.
- **Sanitising contract**: `numbersOnly()` in main.js turns every feed string into a number unless its key is in `TEXT_KEYS`; any string put into `innerHTML` goes through `esc()`; templates and appearances from storage or files go through `Tpl.sanitize` / `Appearance.sanitize`. Keep all four when adding keys or modules.
- **acc_pit.py** sets ACC's pitstop MFD by sending scan-code key presses (pit key twice = cursor on the first row, then arrows) and reads `mfdFuelToAdd`/`mfdTyreSet`/`mfdTyrePressure*` back from `Local\acpmf_graphics`. `apply()` first discovers the layout with `probe()`, then steers each value; `only` sends one block. `FakeMfd` mirrors the layout for the self-test and `--simulate-acc`; keep it in step with `apply()`. Keys are only sent while `AC2-Win64-Shipping.exe` is the foreground window. With `--vjoy`, presses go to vJoy buttons (`VJOY_BUTTONS`, bound with `acc_pit.py --bind-vjoy`). Otherwise, for keyboard drivers, each MFD key event waits (`_lift`) until the driver holds no driving key; a driving key pressed during the event is re-pressed (`_repress`), watched by a low-level hook (`_watch_keyboard`).
- **Security**: every request must be addressed to an IP or `localhost` (`host_ok`, against DNS rebinding); POST /pit, /config and /mfd/close need `X-Pit-Key` (`--key`, 128-bit random per start). The page takes the key from `?key=`, removes it from the address bar and keeps it in `pitwall.pitkey`; Settings › Connection › Forget and Settings › Data › Reset delete it (and the old `engineer.pitkey`).

## Notes

- Browser storage: `pitwall.templates`, `pitwall.active`, `pitwall.themes`, `pitwall.appearance`, `pitwall.prefs`, `pitwall.plan` (pit plan draft; seeded from the MFD with the blocks of the last send on top, so a new page has no changes), `pitwall.notes`, `pitwall.pitkey`, `pitwall.migrated`, `pitwall.oldThresholds`. The tab's template and workspace are in the hash `#t=…&w=…`.
- `ALERT`/threshold defaults (`DEF_TH` in util.js) match `acc_telemetry.py`; keep them in step. The bridge's `config.thresholds` overrides them per class.
- Fonts are self-hosted in `web/fonts` (Barlow Semi Condensed for the UI, JetBrains Mono via `--num` for numbers; SIL OFL). Timing colours: `--best` with ◆ for session best, `--pb` with ● for a personal best, struck-through `--inv` with INV for invalid, `.tag` for OUT/IN/PIT. Colour is never the only cue. No gradients, no glow.
- Gaps between cars use `fmtRel` (unsigned; the row and the label carry the direction); lap/sector deltas use `fmtDelta`/`deltaHtml` (▼ gain, ▲ loss, U+2212 minus).
- The track map draws the racing line of each recorded lap from `session.car_position_m`; the Nürburgring layout in tracks.js is only a fallback before the first whole lap. Field cars are placed by spline on the best line; labels are laid out so they never overlap.
- Icons come from Lucide via unpkg (SRI-pinned), the only network dependency. Dynamically added icons need `refreshIcons(root)`.
- `web/data/tracks.js` is large generated data; don't read it whole.
