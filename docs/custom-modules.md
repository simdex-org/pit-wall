# Write your own module

The **HTML module** (Edit layout, Add module, group Custom) runs a single HTML file you write over the live data. Open its options to paste the source, load an example, or import and export it as an `.html` file. The source is saved with the layout, up to 100,000 characters.

Start from the examples in [apps/web/src/modules/examples](../apps/web/src/modules/examples): a fuel gauge drawn in SVG and a tyre temperature grid.

## What a module can and cannot do

The module runs in its own frame, locked away from the page:

- It gets the data, read only. It cannot send pit plans, change settings, or read the access key.
- No network: `fetch`, WebSocket, images, fonts and scripts from other addresses are all blocked, and so is the bridge itself. Put everything in the one file. Images must be `data:` URLs.
- It cannot reach the page, its storage or cookies, open windows, or navigate away.
- Scripts and styles go inline, in `<script>` and `<style>`.

Pit Wall removes WebRTC from the frame because browsers do not block it with the rules above. Only add modules from people you trust: a module can still show you misleading numbers.

## The `pitwall` helper

Every module gets a `pitwall` object before its own code runs.

```js
pitwall.on("update", (d) => { /* d has every kind below */ });
pitwall.on("reading", (r) => { /* only when the driver's data changes */ });
const off = pitwall.on("laps", draw); // off() stops it
pitwall.latest.summary; // the last value of each kind
```

`on(kind, fn)` calls `fn` at once if there is already a value, then on every change, at most 10 times a second. A listener that throws is logged and the others still run.

| Kind | What it holds |
| --- | --- |
| `reading` | The driver's car, `null` until the driver connects. `car`: `fuel_litres`, `speed_kmh`, `rpm`, `gear`, `tyre_core_temp_c` and `tyre_pressure_psi` (arrays FL, FR, RL, RR), `brake_temp_c`, `brake_pad_mm`, `damage` and more. `session`: `position`, `completed_laps`, `current_lap_ms`, `last_lap_ms`, `best_lap_ms`, `session_time_left_ms`, `fuel_per_lap`, `in_pit_lane`, `flag` and more. `fixed`: `car_model`, `track`, `max_fuel`, `track_length_m` and more. |
| `summary` | The bridge's working out: `fuel_per_lap`, `stint_laps`, `best_ms`, `advice`, `strategy`, `stints`, `stops`. |
| `field` | Every car: `cars` (each with `i`, `pos`, `laps`, `kmh`, `spl` the share of the lap done, and more), `me` (your car's `i`), `best`, `weather`, `track_m`. `null` when field timing is off. |
| `laps` | Your finished laps: `n`, `ms`, `s` (sector times), `valid`, `fuel`, `out`. |
| `units` | The units chosen in Settings: `speed` (`kmh` or `mph`), `temp` (`c` or `f`), `press` (`psi`, `bar` or `kpa`). The data itself is always km/h, °C and psi. |
| `theme` | The page colours. They are also set on the frame as CSS variables. |

To see every name, log it once: `pitwall.on("reading", (r) => console.log(r))`, then open the browser's developer tools.

## Matching the look

The page colours are set as CSS variables on the frame, so `color: var(--txt)` follows the chosen theme:

`--bg`, `--panel`, `--raise`, `--line`, `--line2`, `--txt` (text), `--mut` (secondary text), `--dim` (labels), `--acc` (accent), `--me` (your car), `--ok`, `--warn`, `--bad`, `--cold`, `--best`, `--pb`, `--slow`, `--inv`, the trace colours `--c-speed`, `--c-thr`, `--c-brk`, `--c-fl`, `--c-fr`, `--c-rl`, `--c-rr` and more, plus `--font`, `--num` and `--r` (corner radius).

Keep the body background `transparent` so the module sits on the panel like the others.
