# Architecture

## Data flow

```
ACC shared memory --> telemetry/pages.ts --> telemetry/telemetry.ts --+
ACC broadcasting UDP --> broadcast/client.ts --> broadcast/field.ts --+--> state.ts --SSE /events--> page
page --POST /pit--> pit/apply.ts --> pit/acc-mfd.ts --> MFD key presses (or vJoy buttons)
```

`state.ts` holds the one global `STATE` that every connected page receives a diff of. The bridge runs on a single thread, so a loop tick or a request always finishes before the next starts and nothing is locked.

## Bridge modules

| Path | Job |
|---|---|
| `main.ts` | command line, wiring, shutdown |
| `loops.ts` | the telemetry loop (30 Hz, 60 while a page streams at 60) and the field feed |
| `state.ts` | `STATE`, the log, the pit and field handles |
| `config.ts` | thresholds and strategy inputs, validated as a whole |
| `telemetry/` | raw pages, the reading and summary, the strategy maths, the simulator |
| `broadcast/` | ACC's broadcasting protocol, standings, the simulated field |
| `pit/` | plan validation, the page driver, key and vJoy output, the simulated page |
| `http/` | endpoints, the SSE stream, static files |
| `win/` | Windows shared memory |

Every strategy figure (box lap, fuel to add, stops needed, pit window, stop options, rejoin) is computed once in `Telemetry.strategy()`. The page does no strategy maths.

## Endpoints

| Method and path | Needs key | Purpose |
|---|---|---|
| `GET /events?hz=5\|10\|15\|30\|60` | no | SSE stream; sends only what changed since the client's last message |
| `GET /lap?n=` | no | one lap's 400-point trace and racing line |
| `GET /field/laps?car=` | no | another car's lap history |
| `GET /track` | no | saved layout of the track being driven |
| `POST /pit` | yes | apply a pit plan |
| `POST /config` | yes | change thresholds and strategy inputs |
| `POST /mfd/close` | yes | close the pit page on the driver's screen |

The key goes in the `X-Pit-Key` header. Every request must be addressed to an IP or `localhost`, which stops DNS rebinding.

## Pit control

ACC has no write API, so the bridge presses the MFD keys the way the driver would, only while `AC2-Win64-Shipping.exe` has focus, and reads the fuel, tyre set and pressures back from shared memory to confirm. On a keyboard it waits until the driver holds no driving key, and presses a driving key again if one went down during an MFD press. With vJoy the presses go to a virtual controller and nothing waits.

## The page

`apps/web` is a React app. `feed/` turns every SSE message into one context object; each module reads it through a scheduler that re-renders it only when a channel it needs changed, and at most `rate` times a second. Modules are registered with `defineModule` and placed on a 12-column grid by templates. Canvas drawing (live channels, lap traces, G-G, the track map, the 3D car) is in `draw/`, and what the page keeps between readings (the 60 s trace ring, recorded laps and racing lines) is in `state/recorder.ts`.

## The launcher

`apps/launcher` is a Tauri window that starts and stops the bridge. The installer carries Node, the bridge bundle and the built page; the Rust side runs the bridge with `--control-stdin` and stops it by writing `quit`, killing it after three seconds.
