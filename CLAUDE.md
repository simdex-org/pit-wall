# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pit Wall: a live browser dashboard for the race engineer watching a driver in Assetto Corsa Competizione, with remote pit stop control and timing for the whole field. Everything runs from this repo: the bridge reads ACC's shared memory and broadcasting API itself. It is a pnpm workspace in TypeScript:

- `packages/bridge` (`@pitwall/bridge`): the bridge, run by the driver on their PC.
- `packages/tracks` (`@pitwall/tracks`): the track drawings as JSON (24 GP layouts from OpenStreetMap, the Nordschleife traced from an image).
- `apps/web` (`@pitwall/web`): the page the engineer opens (Vite, React, Tailwind).
- `apps/launcher` (`@pitwall/launcher`): the Windows start window (Tauri). It runs the bridge as a child process with its own Node.
- `docs/`: architecture, development, user guide, README images and logos.

Git repo: github.com/simdex-org/pit-wall.

## Conventions

- Comments are rare. Write one only when the reason is not obvious from the code (an ACC quirk, a unit, a workaround). Never describe what the code plainly does, never leave TODO notes.
- Wording in code, logs, UI text, docs and commits is plain and human. No em-dashes, no filler, no marketing tone, no emoji.
- No speculative abstractions, flags or config. If a thing is not used yet, it does not exist.
- One concern per file. Keep folders by feature (`telemetry/`, `broadcast/`, `pit/`, `http/` in the bridge; `modules/`, `engine/`, `state/`, `shell/`, `draw/` in the page), not by kind.
- Anything with logic gets a test next to the others in the package (`test/` in the bridge, `*.test.ts` beside the file in the apps). `pnpm test` and `pnpm typecheck` must pass before a change is done.
- Use pnpm, never npm.

## Run

```
pnpm install
pnpm build                                                        # the page, then the bridge bundle
pnpm --filter @pitwall/bridge start --http 25.x.x.x:8765          # on the driver's PC, on its VPN address; without --http: 127.0.0.1 only
pnpm --filter @pitwall/bridge start --simulate-acc --key demo     # a pretend race, 20-car field and pit page, no game needed
pnpm --filter @pitwall/bridge start --simulate-acc --sim-session quali --key demo
pnpm --filter @pitwall/bridge start --simulate-acc --sim-track nordschleife --sim-speed 8 --key demo
pnpm --filter @pitwall/bridge start --enable-broadcast            # once, ACC closed: switch on ACC's broadcasting port (field timing)
pnpm --filter @pitwall/bridge start --probe                       # live session: print the not-yet-verified shared-memory fields
pnpm --filter @pitwall/web dev                                    # the page with hot reload; proxies the bridge on 127.0.0.1:8765
pnpm --filter @pitwall/launcher package                           # PitWall installer (needs Rust and the MSVC build tools)
pnpm --filter @pitwall/launcher package:portable                  # a single PitWall.exe, no install
pnpm test; pnpm typecheck
```

Node 22+, Windows for the game side. The bridge serves `apps/web/dist` (override with `PITWALL_WEB`), so run `pnpm --filter @pitwall/web build` after changing the page, or use the dev server. Bridge flags: `--http`, `--key`, `--pit-key`, `--key-ms`, `--vjoy [N]`, `--broadcast-port` (0 = field timing off), `--broadcast-password`, `--sim-session race|quali`, `--sim-track demo|nordschleife|monza|spa|…` (`sim-tracks.ts`), `--sim-speed N`, `--no-browser`, `--control-stdin` (the launcher stops the bridge by writing `quit`), `--bind-vjoy [N]`.

## Architecture

Data flow: ACC shared memory --> `telemetry/pages.ts` (30 Hz; 60 while a page streams at 60, `FAST`) and ACC broadcasting UDP --> `broadcast/client.ts` and `field.ts` --SSE `/events?hz=`--> the page; pit plans go back as POST /pit --> `pit/apply.ts` --> MFD key presses (or vJoy buttons).

### Bridge (`packages/bridge/src`)

- **`state.ts`** keeps one global `STATE`: the latest **reading** (30 Hz), **summary** (10 Hz: advice, debrief, stints, stops, `stint` laps, and `strategy`), the bridge's lap list, the **field** snapshot (every 250 ms when it changed, plus per-car slow fields by `seq`), the **entries** (roster, track), `bc` (field timing state), `config` (thresholds and strategy inputs, shared by every screen), the pit MFD snapshot and job, and the log. Node is single-threaded, so nothing is locked.
- **`http/server.ts`**: `/events?hz=5|10|15|30|60` pushes whatever changed since that client's last send (the reading on a fixed beat of 1/hz), plus a heartbeat with `*_age_ms`. Every **strategy** figure (box lap, fuel to add, stops needed, pit window, the stop options with `reach`/`more_stops`/`outside_window`, rejoin) is worked out once in `Telemetry.strategy()` so all screens agree; the page does no strategy maths except the fuel calculator, whose inputs are typed. A field bug never stops the telemetry loop (`fieldErr` logs it once). Endpoints: GET `/events`, `/lap?n=` (a lap's 400-point trace), `/field/laps?car=`, `/track`; POST `/pit`, `/config`, `/mfd/close` (all need `X-Pit-Key`). `http/static.ts` serves the page with no-cache and 304.
- **`telemetry/`**: `pages.ts` (shared memory, `AccPages`), `telemetry.ts` (the reading, summary, strategy, advice), `fake-pages.ts` and `sim-tracks.ts` (`--simulate-acc`).
- **`broadcast/`**: the broadcasting client (127.0.0.1 only, registers without the command password, sends only requests 9 to 11, never camera or HUD), `field.ts` (standings, gap and interval by distance with the interval from the two gaps to P1, relative, pits, lap history, net position, rejoin), `fake-field.ts`, `config.ts` (`--enable-broadcast` edits broadcasting.json).
- **`pit/`**: `acc-mfd.ts` sets ACC's pitstop MFD by sending scan-code key presses (pit key twice = cursor on the first row, then arrows) and reads `mfdFuelToAdd`/`mfdTyreSet`/`mfdTyrePressure*` back from the graphics page. `apply.ts` first discovers the layout with `probe()`, then steers each value; `only` sends one block. `fake-mfd.ts` mirrors the layout for the tests and `--simulate-acc`; keep it in step with `apply.ts`. Keys are only sent while `AC2-Win64-Shipping.exe` is the foreground window. With `--vjoy`, presses go to vJoy buttons (`vjoy.ts`). For keyboard drivers, each MFD key event waits until the driver holds no driving key, and a driving key pressed during the event is pressed again, watched by a low-level hook in `hook-worker.ts` (a worker thread).
- **`win/shm.ts`** is the koffi binding to Win32 (file mapping, SendInput, foreground window, known folders). koffi ships beside the bundle (`scripts/bundle.mjs`).
- **Security**: every request must be addressed to an IP or `localhost` (against DNS rebinding); POST /pit, /config and /mfd/close need `X-Pit-Key` (`--key`, 128-bit random per start).

### Page (`apps/web/src`)

- **`feed/`**: `connection.ts` (the SSE link), `store.ts` (`FeedStore` merges every payload into one `Ctx`: `r` reading, `s` summary, `st` strategy, `laps`, `field`, `cars` merged by index with the slow fields and entries, `focus`, pit, log, config), `sanitize.ts` (`numbersOnly`: every feed string becomes a number unless its key is in `TEXT_KEYS`), `useFeed.ts`.
- **`engine/`**: `defineModule` (`registry.ts`) and `ModuleHost.tsx`. A module is `{type, title, group, blurb, size, multi, needs, requires, rate, options, tools, view, tool?}`. `view({ctx, opts, id})` may use hooks and returns `{info, alert, state, body, onKey}`. `useModuleCtx` hands the module a new `Ctx` only when a channel in `needs`/`requires` changed and at most `rate` times a second (the render scheduler); `requires` channels gate it to an "unavailable" state. Channels: `reading summary field entries laps config pit focus sel rec log tick units theme resize` (the last six, except the feed ones, are version counters in `versions.ts`). `Workspace.tsx` places modules on the 12-column grid (rows stretch to the window height; below 1100 px one column) and handles edit-mode dragging.
- **`modules/`**: one file per family (`timing`, `strategy`, `fuelcalc`, `pit`, `car`, `car3d`, `charts`, `laps`, `log`); importing a file registers its modules. `cars.tsx` holds the shared car-table pieces (`CarTr`, `useRowCursor`, `Spark`, `Kv`).
- **`state/`**: `templates.ts` (built-in templates are read-only data in `builtins.ts`; `sanitize` rebuilds any template from scratch), `editor.ts` (edit mode: undo, fork-on-first-change, save and discard), `nav.ts` (the tab's template and workspace live in the hash `#t=…&w=…`), `prefs.ts`, `appearance.ts`, `plan.ts` (the pit plan draft), `recorder.ts` (the 60 s trace ring, per-lap recordings, racing lines, laps import and export, `ensureLap` from GET /lap), `selection.ts` (REF/CMP/cursor), `migrate.ts` (the old `engineer.*` keys), `bridge.ts` (access key, POST, GET), `alerts.ts`, `ui.ts`.
- **`draw/`**: canvas drawing (`charts.ts` live channels, traces and G-G; `map.ts` the track map with zoom about the pointer, pan and follow; `car3d.ts` a generic GT3 from three.js geometry whose triangles name their part: ACC's five damage zones, `s0..s3` suspension, `b0..b3` brakes). three.js is loaded with `import()` only when a 3D module opens, and the track drawings only when a map opens.
- **`shell/`**: top bar, KPI strip, engineer bar and drawer, welcome screen, edit bar and module catalogue, module options, settings, appearance editor, template manager, confirm dialogs, keyboard shortcuts.
- **Sanitising contract**: strings from the feed reach the page only through React (escaped) after `numbersOnly`; templates and appearances from storage or files go through `sanitize` / `sanitizeTheme`. Keep both when adding keys or modules.
- **Styles**: `styles/base.css`, `modules-a.css`, `modules-b.css` carry the design tokens and classes (plain CSS variables on `:root`, which the appearance settings overwrite); Tailwind has no preflight and its colours point at the same variables (`styles/index.css`).

### Launcher (`apps/launcher`)

Tauri v2. The Rust side (`src-tauri/src/main.rs`) exposes `bridge_start`, `bridge_stop`, `bridge_running`, `bridge_tool` and `quit_app`; the bundle carries `node.exe`, the bridge bundle and the built page as resources. `build_root` prefers a downloaded build in the app data folder (`update/`, made by the bridge's `--update`, offered by `components/UpdateBar.tsx`) over the installed resources when its `app.json` is newer. The bridge runs with `--control-stdin`: Stop writes `quit` to its stdin and kills it after 3 s. The UI is React in `src/`.

## Notes

- Browser storage: `pitwall.templates`, `pitwall.active`, `pitwall.themes`, `pitwall.appearance`, `pitwall.prefs`, `pitwall.plan` (pit plan draft; seeded from the MFD with the blocks of the last send on top, so a new page has no changes), `pitwall.notes`, `pitwall.calc`, `pitwall.pitkey`, `pitwall.migrated`, `pitwall.oldThresholds`.
- The page takes the access key from `?key=`, removes it from the address bar and keeps it in `pitwall.pitkey`; Settings › Connection › Forget and Settings › Data › Reset delete it. Template exports never contain it.
- Threshold defaults in `lib/states.ts` match the bridge's `config.ts`; keep them in step. The bridge's `config.thresholds` overrides them per class.
- Fonts are self-hosted in `apps/web/public/fonts` (Barlow Semi Condensed for the UI, JetBrains Mono via `--num` for numbers; SIL OFL). Timing colours: `--best` with ◆ for session best, `--pb` with ● for a personal best, struck-through `--inv` with INV for invalid, `.tag` for OUT/IN/PIT. Colour is never the only cue. No gradients, no glow.
- Gaps between cars use `fmtRel` (unsigned; the row and the label carry the direction); lap and sector deltas use `Delta` / `fmtDelta` (▼ gain, ▲ loss, U+2212 minus).
- The track map draws the racing line of each recorded lap from `session.car_position_m`, over the drawn layout once `alignLayout` has fitted it to a line (rotation, scale, mirror and start-line shift from the lap fraction each point carries; refused when it does not fit). The drawings are only a fallback before the first whole lap. Field cars are placed on the best line (or the drawn layout), glide between the ~250 ms field updates, and are labelled by default with their on-track gap to you; labels are laid out so they never overlap.
- Icons are Lucide, imported by name in `lib/icons.tsx` (add a name there before using it in a module).
- `packages/tracks/tracks.json` is large generated data; don't read it whole.
- Details of the port from Python and what still needs a live ACC session: `docs/migration.md`.
