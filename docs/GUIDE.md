# Pit Wall guide

The details behind the [README](../README.md).

## What pit control can and cannot do

ACC has **no API to write the pit strategy**: its shared memory and broadcasting API are read-only. So Pit Wall does what the driver would do on the keyboard: on the driver's PC it opens the pit page of the MFD (**P**) and moves through it with the arrow keys.

| MFD row | Set from the dashboard | Confirmed from the game |
|---|:---:|---|
| Fuel to add, tyre set, pressures | ✅ | ✅ read back from the game |
| Change tyres, compound (dry/wet), change brakes | ✅ | ✅ indirectly, by which rows respond |
| Front / rear pad compound | ✅ | ❌ sent, not published by ACC |
| Repair suspension / bodywork | ✅ as a switch | ❌ ACC does not publish the current state |
| Driver swap, strategy preset, electronics | ❌ | Not done (electronics are shown read-only) |

- **ACC must be the focused window.** Keys are only sent while it is, and never to another program.
- **Applying a plan takes 15 to 30 seconds**, and the driver sees the MFD moving.
- **Changes apply without the driver confirming.** The engineer presses *Send* and it happens.
- **Keyboard drivers:** use [vJoy](#vjoy-for-keyboard-and-mouse-drivers). Without it, the program types only while the driver holds no driving key, so a plan can take a lap or two to go in.
- **Not yet tested in a live race**, only against a simulated session and MFD. Try it once in practice before a race.

<details>
<summary><b>vJoy for keyboard-and-mouse drivers</b></summary>

<br>

Keys typed into the MFD reach ACC as a second keyboard, and ACC then forgets the gas and brake keys the driver is holding. A virtual controller avoids that: the MFD buttons are pressed on it, and the driver's keyboard is never touched.

1. Install [vJoy](https://github.com/BrunnerInnovation/vJoy/releases). Device 1 needs at least 6 buttons.
2. Bind ACC's MFD to it, once:

   ```bash
   pnpm --filter @pitwall/bridge start --bind-vjoy
   ```

   In ACC, *Options → Controls*, find the MFD actions. After 10 seconds each vJoy button is pressed for 10 seconds, announced by beeps: 1 **MFD pitstop page**, 2 **MFD up**, 3 **MFD down**, 4 **MFD left**, 5 **MFD right**, 6 **Cycle MFD**. On each beep set, click that action's binding in ACC. Save the controls.
3. Start the bridge with `--vjoy`. The keyboard MFD keys stay bound too.

</details>

<details>
<summary><b>Templates, workspaces and appearance</b></summary>

<br>

| Template | Workspaces |
|---|---|
| **Race engineer** | Live, Timing, Strategy, Car, Damage, Laps, Analysis, Log |
| **Strategist** | Overview, Timing, Strategy, Laps, Log |
| **Driver coach** | Live, Laps, Analysis, Car, Log |
| **Minimal** | Pit wall, Pit |

- Number keys **1–9** switch workspace, `[` and `]` step through them. Each browser tab keeps its own template and workspace in the address bar.
- Press **E** to edit: drag modules by the header, resize from the corner (12-column grid), or use Tab / arrows / Delete / D / H / O from the keyboard. *+ Module* opens the catalogue. Ctrl+Z / Ctrl+Y undo and redo; Ctrl+S saves, Esc discards. The first change to a built-in makes your own copy.
- **T** manages templates: duplicate, rename, delete, export and import `.pitwall.json`. Imports are rebuilt field by field and exports never contain the access key.
- *Settings › Appearance*: four looks (Pit Wall, Broadcast, Night stint, Daylight) and every colour token, density, font scale, corner radius and panel style. Export and import as `.pitwall-theme.json`.
- Click a car (or ↑ ↓ then Enter in a table) to make it the **focus car**; battle, the map and *You vs focus car* follow it. ✕, G or Esc goes back to your own car.

**Modules**

| Group | Modules |
|---|---|
| Timing | Standings, Relative, Battle, Pit lane, You vs focus car, Session, Flags & penalties, Stint rules, Big number |
| Strategy | Fuel, Fuel to the flag, Stint timeline, Stop options, Rejoin, Pit stops, Track & weather, Pace |
| Pit | Pit stop (the plan), Pit sends, Pressure correction |
| Car | Track map, Driver inputs, Lap, Tyres, Tyre history, Brakes, Electronics, Damage & engine, Car damage 3D, G-G, Live channels |
| Laps / Analysis | Laps, Debrief, Lap picker, Traces, Where the time goes |
| Log | Event log, Notes |

ACC does not publish rival inputs, fuel or tyre wear, and the page never pretends it does. *Pace* shows what the tyres cost in lap time instead.

</details>

<details>
<summary><b>The pit stop page</b></summary>

<br>

- **MFD now** is what the driver's pit page holds, read from the game. **Plan** is the next stop.
- Blocks (**Fuel**, **Tyres**, **Pressures**, **Brakes**, **Repairs**) each have a *Send* button that touches only that block. *Send whole plan* sends everything. *Confirm before sending* is on by default.
- **Result** says row by row: `✓ verified` (read back), `sent` (pressed, not published by ACC), or the problem.
- Repairs are switches: ticking one flips that row once, since ACC does not say which state it is in.
- Wet tyres have no sets in ACC, so with *Compound* wet the tyre set is not sent.
- *Close pit page* sends Cycle MFD (Insert, or vJoy button 6), at most once every 2 s.

</details>

<details>
<summary><b>Bridge options</b></summary>

<br>

`pnpm --filter @pitwall/bridge start [options]`

| Option | Default | What it is |
|---|---|---|
| `--http HOST:PORT` | `127.0.0.1:8765` | Where the dashboard is served. Give your VPN address so the engineer can connect. |
| `--key KEY` | random each start | Access key to send pit plans and change shared thresholds. |
| `--pit-key KEY` | `p` | ACC's key for the pitstop MFD page: one character or `F1`–`F24`. |
| `--key-ms MS` | `40` | How long each key is held. Raise to 60–80 if ACC misses presses. |
| `--vjoy [N]` | off | Press the MFD through vJoy device N instead of the keyboard. |
| `--broadcast-port PORT` | from `broadcasting.json` | ACC's broadcasting port. `0` turns field timing off. |
| `--broadcast-password PW` | from `broadcasting.json` | ACC's broadcasting password. |
| `--simulate-acc` | off | A pretend session, field and pit page instead of the game. |
| `--sim-session race\|quali` | `race` | With `--simulate-acc`. |
| `--sim-track TRACK` | `demo` | With `--simulate-acc`: `demo`, `nordschleife` or a real layout. |
| `--sim-speed N` | `1` | With `--simulate-acc`: run N times faster. |
| `--no-browser` | off | Do not open the dashboard on this PC. |
| `--enable-broadcast [PORT]` | | Switch ACC's broadcasting on in `broadcasting.json`, then exit. |
| `--probe` | | Print the not-yet-verified shared-memory fields from a live session. |
| `--bind-vjoy [N]` | | Guided binding of ACC's MFD actions to vJoy buttons, then exit. |

Live rate (5, 10, 15, 30 or 60 Hz) is set in *Settings › Connection*. A page uses about 46 KB/s at 5 Hz, 136 KB/s at 30 and 220 KB/s at 60 of the driver's upload.

</details>

<details>
<summary><b>Troubleshooting</b></summary>

<br>

| Symptom | Cause and fix |
|---|---|
| Engineer's browser cannot connect | Bridge started without `--http 25.x.x.x:8765`, Hamachi shows the driver offline, or the Hamachi network is still *Public* in Windows. |
| *Use the PC's IP address* | Open the page by IP address, not by host name. |
| Stays on *Waiting for ACC* | ACC is still in the menus, or the bridge runs on a different PC from ACC. |
| *ACC is not the focused window* | The driver alt-tabbed. Click into ACC and send again. |
| *Could not find the tyre rows* | The pitstop key opened something else. Check ACC's *MFD Pitstop* binding and pass it with `--pit-key`. |
| Values land one row off | Raise `--key-ms` to 60 or 80. |
| *Close pit page* does nothing | Bind ACC's *Cycle MFD* to Insert, or to vJoy button 6. |
| *Wrong or missing access key* | Open the link the bridge printed this time; the key changes on every start. |
| Brake bias is a few points off | ACC publishes the raw bias; the game adds a per-car offset to what it shows. |

</details>

<details>
<summary><b>Project layout and tests</b></summary>

<br>

```
packages/bridge/   the Node bridge: ACC shared memory, broadcasting UDP, pit control, HTTP and Server-Sent Events
packages/tracks/   the track drawings the map uses
apps/web/          the dashboard: React, Tailwind, Vite
apps/launcher/     the Pit Wall start window (Tauri)
docs/              this guide, architecture and development notes, screenshots and logo
```

```bash
pnpm test          # all packages
pnpm typecheck
```

Security: every request must be addressed to an IP or `localhost` (against DNS rebinding), and POST `/pit`, `/config` and `/mfd/close` need the `X-Pit-Key` header. The browser keeps templates, appearances, plan draft, notes and the key in `localStorage` under `pitwall.*`; *Settings › Data › Reset* removes them.

</details>

