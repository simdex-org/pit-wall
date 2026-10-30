# Pit Wall

A live race-engineer dashboard for **Assetto Corsa Competizione**, with **remote pit stop control**.
One person drives; the engineer, on another PC anywhere over Hamachi (or ZeroTier, or Tailscale),
watches the car in a browser and sets the next pit stop (fuel, tyres, compound, pressures, brake pads and repairs)
straight into the driver's game.

![Strategy workspace: stint timeline, the pit plan against the driver's MFD with what was verified, stop options, fuel to the flag, rejoin and stint rules](docs/pit-stop.png)

![Live workspace: track map with the field, standings, relative, fuel to the flag, tyres and the engineer's advice](docs/live.png)

Everything it needs is in this repository: it reads ACC's telemetry itself. No framework, no build,
nothing to install but Python.

---

## How it works, and what ACC allows

```
 DRIVER'S PC                                                          ENGINEER'S PC
 ACC ── shared memory ──> server/bridge.py (telemetry, advice, HTTP :8765) ══ Hamachi ══> browser
  ^                               │                                                        │
  └── MFD key presses (P, arrows) <── server/acc_pit.py <────── pit plan (with key) ──────┘
```

`server/bridge.py` runs on the driver's PC. It reads ACC's shared memory 30 times a second
(`server/acc_telemetry.py`), works out the laps, sectors, stint, fuel per lap and the engineer's advice,
and serves the dashboard to the engineer's browser.

ACC has **no API to write the pit strategy**. Its shared memory and its broadcasting API are read-only.
So pit control does what the driver would do with the keyboard: on the driver's PC it opens the
pitstop page of the MFD (the **P** key) and moves through it with the **arrow keys**.

What can be checked in the game afterwards is limited by what ACC publishes in its shared memory:

| MFD row | Set from the dashboard | Confirmed from the game |
|---|:---:|---|
| Fuel to add | ✅ | ✅ read back (`mfdFuelToAdd`) |
| Tyre set | ✅ | ✅ read back (`mfdTyreSet`) |
| Pressures FL / FR / RL / RR | ✅ | ✅ read back (`mfdTyrePressure*`) |
| Change tyres, compound (dry/wet) | ✅ | ✅ indirectly: by which MFD rows respond |
| Change brakes | ✅ | ✅ indirectly, the same way |
| Front / rear pad compound | ✅ | ❌ sent, not published by ACC |
| Repair suspension / bodywork | ✅ as a **switch** (yes ↔ no) | ❌ not published, so the dashboard cannot know the current state |
| Driver swap, pit strategy preset | ❌ | Not done: driver swap only exists in multi-driver events, and a strategy preset overwrites the values set here. |
| In-car electronics (TC, ABS, map, bias) | ❌ | Shown read-only in the Electronics module. ACC only changes them from the car's own controls. |

Limits, plainly:

- **ACC must be the focused window on the driver's PC.** Keys are only sent while it is. If focus changes
  mid-way, pit control stops before pressing anything else and the dashboard says so. It never types into another program.
- **Applying a plan takes about 15 to 30 seconds**: it first finds out how the pit page is laid out
  (Strategy row or not, tyres changing or not, wet or dry, brakes changing or not), then sets each value
  and reads it back. The driver sees the MFD moving; they should not use the MFD keys meanwhile.
- **Driving on keyboard and mouse**: use **vJoy** (below). Without it, a key typed into the MFD makes ACC forget the gas, brake and
  steering keys the driver is holding, so the program only types while the driver holds none of them (lifting before a braking zone, coasting into a corner) and waits
  otherwise; the dashboard then says *applying, waiting for the driver to lift*. A plan can take a lap or two to go in this way, so send
  it early. A driving key pressed in the middle of an MFD keypress is pressed again until it is let go. To know which keys are held,
  the program watches only those (W, A, S, D and the gas, brake and steering keys in ACC's `controls.json`) with a keyboard hook;
  nothing else typed is seen. A few antivirus programs dislike keyboard hooks. On a wheel nothing waits.
- **The arrow keys and P must be ACC's MFD keys** (they are by default), and Insert must be *Cycle MFD* (used by *Close pit
  page*). If the driver rebound the pitstop key, pass it with `--pit-key`. Arrow keys must not be bound to anything else.
- Changes apply **without the driver confirming**: the engineer presses *Send* and it happens.
- The engineer's advice uses GT3 numbers: hot pressures 26.0–27.0 psi dry and 29.5–31.0 psi wet, brakes hot above 750 °C,
  pads low under 12 mm. Other classes need their own (`server/acc_telemetry.py`).
- The pit page layout was taken from how ACC 1.9/1.10 lays out the pitstop MFD and how
  [Simulator Controller](https://github.com/SeriousOldMan/Simulator-Controller) describes driving it. Telemetry and pit control are
  tested against a simulated session and a simulated MFD covering every layout (the self-tests below), not yet in a live race.
  **Test it once in a practice session before a race.**

---

## Install

**Driver's PC** (Windows; ACC runs here), the easy way: download
**[PitWall.exe](https://github.com/simdex-org/pit-wall/releases/latest/download/PitWall.exe)** into an empty folder and open it.
It needs no Python. The first time, click **Download** to fetch Pit Wall into that folder. Windows may warn that the program is
unknown (it is not signed): *More info → Run anyway*. Each time it opens, it checks GitHub, and **Update** brings the folder up
to date with `main` (by `git pull` when the folder is a git clone).

Or, from a terminal:

1. [Python 3.8 or newer](https://www.python.org/downloads/) (the Microsoft Store build works too).
2. This repository: *Code → Download ZIP* and unzip it, or `git clone https://github.com/simdex-org/pit-wall`.

**Engineer's PC**: only a browser.

Both PCs: the VPN, below.

## Connecting the two PCs with Hamachi

The engineer's browser reaches the driver's PC on port **8765** over the VPN. Nothing is opened to the internet.

1. Install [LogMeIn Hamachi](https://vpn.net/) on **both** PCs and sign in.
2. **Driver:** *Network → Create a new network*. Choose a network ID and a password.
3. **Engineer:** *Network → Join an existing network* with that ID and password.
4. On the driver's PC, the **IPv4 address** at the top of the Hamachi window (`25.x.x.x`) is the address the engineer will use.
5. **Driver, Windows firewall:** Windows files the Hamachi network as *Public*, and opening Python to every public network
   (café Wi-Fi included) is not what you want. Mark only Hamachi as private instead, once, in PowerShell **run as administrator**:

   ```powershell
   Set-NetConnectionProfile -InterfaceAlias "Hamachi" -NetworkCategory Private
   ```

   Then, the first time `bridge.py` starts, allow Python on **Private** networks only. Hamachi may need the command again after it
   reinstalls its adapter. (ZeroTier's and Tailscale's adapters are named differently: `Get-NetConnectionProfile` lists them.)

Using **ZeroTier** instead: create a network at my.zerotier.com, join it from both PCs with its network ID, tick *Auth* for both
members, and use the driver's ZeroTier address. With **Tailscale**: sign both PCs into the same account (or share the machine)
and use the driver's `100.x.x.x` address. Everything else is the same.

## Driver: running it

**With PitWall.exe:** your Hamachi address (`25.x.x.x`) is already filled in, and you can pick another from the list. The port
(8765) and the key can be changed; the window remembers them. Tick *Press the pit page through vJoy* if you use vJoy (below).
Click **Start**: the window shows the link for the engineer, with **Copy**. Minimise it while you drive; closing it stops Pit
Wall. Any arguments given to the exe go to `bridge.py` (e.g. `PitWall.exe --simulate-acc` for the demo). Then step 2.

**From a terminal:**

1. Start the bridge on your Hamachi address (the `25.x.x.x` at the top of the Hamachi window), in a terminal in this folder:

   ```bash
   python server/bridge.py --http 25.40.144.183:8765
   ```

   It then listens on the VPN only, not on your other networks. (Started without `--http` it is reachable from this PC only,
   and it prints the exact command with your address.) It prints the link for the engineer:

   ```
   Engineer, open:   http://25.40.144.183:8765/?key=4oX0dSGyk-ZpSt5I3lZq0w
   ```

   Send the engineer that link. The **key** is what allows sending pit plans; it changes on every start unless you fix it
   with `--key something-long`. Without the key the dashboard can be watched by members of your VPN network but not used to change anything.

2. Start ACC and drive. The terminal says when it sees the session (`ACC: ferrari_296_gt3 at nurburgring_24h, … driving`).
   Keep ACC as the focused window.

### Field timing: the other cars

Standings, relative, battle, pit lane, rejoin and the cars on the map come from ACC's **broadcasting API**, which ACC only opens
when its `broadcasting.json` says so. Once, with ACC closed:

```bash
python server/acc_broadcast.py --enable
```

It sets `updListenerPort` in `Documents\Assetto Corsa Competizione\Config\broadcasting.json` (your real Documents folder, also
when OneDrive moved it; keeping a backup), and the bridge reads
the port and password from there. The bridge talks to that port on 127.0.0.1 only and only listens: it never moves the driver's
camera or HUD. `--broadcast-port 0` turns field timing off; the page then says so instead of showing the other cars.

### Driving on keyboard and mouse: vJoy

Keys the program types into the MFD reach ACC as another keyboard, and ACC then forgets the gas and brake keys the driver is
holding. A virtual controller avoids that: the MFD buttons are pressed on it, and the driver's keyboard is never touched.

1. Install [vJoy](https://github.com/BrunnerInnovation/vJoy/releases) (free, open source). In *Configure vJoy*, device 1 needs at least
   6 buttons (the default 8 is fine).
2. Bind ACC's MFD to it, once. In a terminal in this folder:

   ```bash
   python server/acc_pit.py --bind-vjoy
   ```

   Switch to ACC, *Options → Controls*, and find the MFD actions. After 10 seconds the program presses each vJoy button for 10 seconds,
   announced by beeps: 1 beep **MFD pitstop page** (button 1), 2 beeps **MFD up** (2), 3 **MFD down** (3), 4 **MFD left** (4),
   5 **MFD right** (5), 6 **Cycle MFD** (6, used by *Close pit page*). When you hear the beeps, click that action's binding in
   ACC; the button binds itself. Save the controls. Bound before *Close pit page* existed? Run `--bind-vjoy` again so
   button 6 (Cycle MFD) is bound too; until then that button does nothing.
3. Start the bridge with `--vjoy`:

   ```bash
   python server/bridge.py --http 25.x.x.x:8765 --vjoy
   ```

   The keyboard MFD keys stay bound too, so the driver can still use them.

## Engineer: using it

1. Open the link the driver sent (`http://25.x.x.x:8765/?key=…`). The key is remembered by the browser (Settings › Connection
   shows it, *Forget* removes it), so later the plain address works.
2. The page opens as soon as the driver is in a session. At the top: the **template** (a named set of workspaces) and its
   **workspace tabs**; under them the **KPI strip** (session, time left, lap, position, gaps, last and best lap, live delta, fuel,
   stint, flag, temperatures: Settings › Layout picks the cells and their order); at the bottom the **engineer bar** with the most
   important advice (click it, or press A, for all advice and the debrief of the last laps).

   It follows the conventions of real timing screens: purple and a ◆ for the session's best lap and sectors, ● for a personal best,
   struck-through grey and INV for invalid laps, OUT/IN/PIT tags, and a coloured bar at the left of a car's row for where it is
   (on track, pit lane, out-lap). Colour is never the only cue: every state also has a glyph or a word. Gaps between cars are shown
   without a sign: the row (above or below you) and the label (Ahead, Behind) say which way.

### Templates and workspaces

Four built-in templates, read-only:

| Template | Workspaces |
|---|---|
| **Race engineer** | Live, Timing, Strategy, Car, Laps, Analysis, Log |
| **Strategist** | Overview (standings, pit lane, map, stop options, battle, rejoin), Timing, Strategy, Laps, Log |
| **Driver coach** | Live (map, live channels, lap timer, inputs, tyres, G-G), Laps, Analysis, Car, Log |
| **Minimal** | Pit wall (map, relative, fuel to the flag, tyres), Pit (pit plan, fuel to the flag, pressure correction) |

Number keys 1–9 switch workspace, `[` and `]` step through them. Each browser tab keeps its own template and workspace in the
address bar (`#t=…&w=…`), so two tabs or two screens can show different things.

**Make your own:** press **E** (or *Edit* at the right of the KPI strip). The first change to a built-in makes your own copy of it,
*"Race engineer (custom)"*; only looking at edit mode changes nothing. In edit mode:

- drag a module by its header to move it, by its bottom-right corner to resize it (on a 12-column grid); or Tab to select a module,
  arrows to move it, Shift+arrows to resize, Delete to remove, D to duplicate, H to hide, O for its options;
- *+ Module* opens the catalogue of every module (search by name); a workspace tab's ⋯ menu renames, duplicates, moves or deletes it,
  and + adds a workspace;
- Ctrl+Z / Ctrl+Y undo and redo; *Save* (Ctrl+S, or E again) keeps it, *Discard* (Esc) drops everything since you entered.

Every module has **options** (the sliders button in its header, also outside edit mode): its title, whether it shows a header,
and its own settings (the standings' columns and their order, the map's labels, the traces' lanes…).

**Manage templates** (T, or the template menu): duplicate, rename, delete, **export** a template to a `.pitwall.json` file (optionally with the appearance in use) and **import** one. An imported file is
rebuilt field by field, keeping only what this version knows, and the page says what it left out; the access key is never written
into an export.

### Appearance

Settings › Appearance: four built-in looks (Pit Wall, Broadcast, Night stint for a dark room, Daylight for a bright one) and your own.
Every colour token can be changed (surfaces, accent, your car, timing colours, states, trace colours), each with its role and its
contrast against the background; density, font scale, corner radius, panel style (ruled, boxed, flat), number font and label case
too. As with templates, changing a built-in makes your own copy; appearances export and import as `.pitwall-theme.json`.

### The other drivers

With field timing on (below, *Field timing*), the page knows every car: **Standings** (gap, interval, last, best, sectors, pits, stint,
net position after the stops everyone still owes), **Relative** (the cars nearest on track), **Battle** (the cars ahead and behind with
the interval trend), **Pit lane** (who is in the lane now, and every stop made), and the cars on the **track map**.

Click a car (or ↑ ↓ then Enter in a table) to make it the **focus car**: the KPI strip shows *▶ FOCUS #14 A. Mori ✕*, and battle,
*You vs focus car* and the map follow it (and any Laps module set to *Whose laps: the focus car*, which then lists that car's laps). ✕, G or Esc goes back to your own car.
ACC shares no rival inputs, fuel or tyres; the page never pretends it does.

### The modules

| Group | Modules |
|---|---|
| Timing | Standings, Relative, Battle, Pit lane, You vs focus car, Session, Flags & penalties, Stint rules, Big number |
| Strategy | Fuel, Fuel to the flag, Stint timeline, Stop options, Rejoin, Pit stops, Track & weather, Pace |
| Pit | Pit stop (the plan), Pit sends (every send and its result), Pressure correction |
| Car | Track map, Driver inputs, Lap, Tyres, Tyre history, Brakes, Electronics, Damage & engine, G-G, Live channels |
| Laps / Analysis | Laps, Debrief, Lap picker, Traces, Where the time goes |
| Log | Event log, Notes |

Every strategy figure (box lap, fuel to add, stops, the stop options and where you rejoin) is worked out once on the bridge, so every
screen shows the same numbers. *Fuel to the flag* and *Stop options* agree on the best stop: options the fuel cannot reach are marked,
and the ranking puts the fewest stops to the flag first, then the rejoin position, then the time lost. In practice and qualifying the
page plans no fuel to a flag; it says how far the fuel goes. **ACC does not publish tyre wear**, so *Pace* shows what the tyres cost
in lap time instead.

### Pit stop

- **MFD now** is what the driver's pit page holds right now, read from the game. A new browser starts its plan from the MFD, with the
  blocks of the last send on top, so it opens with nothing to change.
- **Plan** is the next stop. *Copy MFD into plan* starts from the current values; *Put in pit plan* (Fuel to the flag) and *Use in pit
  plan* (Pressure correction) fill it from those modules. **Change** shows what a send would change.
- Each block (**Fuel**, **Tyres**, **Pressures**, **Brakes**, **Repairs**) has its own *Send* button, and only that block is touched
  on the driver's pit page. *Send whole plan* sends everything. With *Confirm before sending* (on by default) the page first lists
  the changes.
- **Result** then says, row by row: `✓ verified` (read back from the game), `sent` (pressed, but ACC does not publish it), or the
  problem. *Pit sends* keeps every send, by whom and what came back.
- *Repair suspension / bodywork* are switches: ticking one flips that row once (yes ↔ no), since ACC does not say which it currently is.
- Wet tyres have no sets in ACC: with *Compound* wet the tyre set is not sent, and its row says so.
- *Close pit page* takes the pit page off the driver's screen with ACC's Cycle MFD (Insert, or vJoy button 6); one press per 2 s (the
  bridge refuses a second, which would move the driver's MFD on to another page); the event log says when it was pressed.

The page also works on a phone (the driver checking the plan): the workspace stacks into one column and tables scroll sideways.
Edit mode needs a window at least 1100 px wide.

## Trying it without the game

```bash
python server/bridge.py --simulate-acc --key demo
python server/bridge.py --simulate-acc --sim-session quali --key demo   # qualifying: the field ordered by best lap
```

runs a pretend session (a Ferrari 296 GT3 on a made-up circuit), a pretend 20-car field and a pretend pit page, so the whole
page, pit stop included, can be used without ACC.

Self-tests:

- `python server/acc_telemetry.py` drives simulated laps through the telemetry: laps, sectors that add up to the lap time,
  fuel per lap, the debrief and the advice.
- `python server/acc_broadcast.py` decodes every broadcasting message kind, builds standings, gaps, intervals and pit stops from a
  pretend race and a pretend qualifying, and checks them.
- `python server/acc_pit.py` applies several plans to a simulated pit page in every layout ACC can show (with and without a
  Strategy row, tyres changing or not, dry or wet, brakes changing or not, with and without a Driver row) and checks the result.
- `python server/acc_telemetry.py --probe` prints, once a second from a live session, the shared-memory fields not yet checked
  against the game (pit window, mandatory stops, track length), to compare with what ACC shows.

## Command line

`python server/bridge.py [options]`

| Option | Default | What it is |
|---|---|---|
| `--http HOST:PORT` | `127.0.0.1:8765` | Where the dashboard is served. Give your VPN address (`25.x.x.x:8765`) so the engineer can connect; the default is this PC only. |
| `--key KEY` | new random key each start | Access key needed to send pit plans and to change the shared strategy inputs and thresholds. |
| `--pit-key KEY` | `p` | ACC's key for the pitstop MFD page: one character or `F1`–`F24`. |
| `--key-ms MS` | `40` | How long each key is held, and the pause after it. Raise it (60–80) if ACC misses presses at a low frame rate. |
| `--vjoy [N]` | off | Press the MFD through vJoy device N (1 if not given) instead of the keyboard. For keyboard-and-mouse drivers. |
| `--simulate-acc` | off | A pretend session, 20-car field and pit page instead of the game. |
| `--sim-session race\|quali` | `race` | With `--simulate-acc`: a race, or qualifying (ordered by best lap). |
| `--broadcast-port PORT` | from `broadcasting.json` | ACC's broadcasting port for field timing, on 127.0.0.1. `0` turns field timing off. |
| `--broadcast-password PW` | from `broadcasting.json` | ACC's broadcasting connection password. |
| `--no-browser` | off | Do not open the dashboard on this PC. |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Engineer's browser cannot connect | The bridge was started without `--http 25.x.x.x:8765`, Hamachi shows the driver offline, or the Hamachi network is still *Public* in Windows (see the firewall step). |
| *Use the PC's IP address* | The page was opened by a host name; open it by the IP address instead (`http://25.x.x.x:8765/…`). |
| Dashboard opens but stays on *Waiting for ACC* | ACC is not in a session (still in the menus), or the bridge runs on a different PC from ACC. The bridge's terminal says when it sees ACC. |
| *Next pit stop* says **ACC not running** | Same as above: the pit page is only there during a session. |
| *Failed: ACC is not the focused window* | The driver alt-tabbed, or a notification took focus. Click into ACC and send again. |
| *Failed: could not find the tyre rows* | The pitstop key opened something else. Check ACC's *Controls → MFD Pitstop* binding and pass it with `--pit-key`. |
| Values land one row off, or presses are missed | Raise `--key-ms` to 60 or 80. |
| *Close pit page* does nothing | Bind ACC's *Cycle MFD* to Insert (keyboard) or to vJoy button 6 (`python server/acc_pit.py --bind-vjoy`). |
| *Wrong or missing access key* | Open the link with `?key=…` the bridge printed this time; the key changes on every start unless `--key` is given. |
| Brake bias reads a few points off the in-game figure | ACC publishes the raw bias; the game adds a per-car offset to what it displays. |

## Project layout

```
server/bridge.py         the page, Server-Sent Events out (GET /events?hz=), GET /lap?n= (a lap's trace), GET /field/laps?car=
                         (another car's laps); POST /pit, POST /config and POST /mfd/close in (all need the X-Pit-Key header)
server/acc_telemetry.py  ACC shared memory: laps, sectors, stints, fuel, the strategy figures, advice and debrief; self-test, --probe
server/acc_broadcast.py  ACC broadcasting API: the field's standings, gaps, pits and lap history; --enable; self-test
server/acc_pit.py        ACC pit page: MFD key presses (or vJoy), reading it back, the plan logic; self-test
server/launcher.py       PitWall.exe: the start window and the update from GitHub; self-test. Build it with
                         python -m PyInstaller --onefile --windowed --name PitWall server/launcher.py
                         and attach dist/PitWall.exe to a GitHub release. Rebuild only when the launcher changes, or when the
                         server starts importing a standard-library module the launcher does not list.
web/                     index.html, css/ (app.css, modules-1.css, modules-2.css), js/ (one file per concern, below), data/tracks.js
docs/                    screenshots
```

`web/js`, loaded in this order: `util.js` (helpers, units, formatters), `workspaces.js` (the `Pit` API, the module registry, the
workspace grid and render scheduler), `templates.js` (built-in templates, `Tpl`), `appearance.js`, `editor.js` (edit mode, module
options), `manager.js` (template manager, import and export, migration), `settings.js`, `recorder.js`, `charts.js`, the modules
(`mod-timing.js`, `mod-strategy.js`, `mod-pit.js`, `mod-car.js`, `mod-laps.js`, `mod-log.js`), and `main.js` (the feed, the chrome, keys, boot).

The browser keeps its own things in `localStorage` under `pitwall.*`: templates, appearances, the active template, preferences,
the pit plan draft, notes and the access key. Settings › Data › Reset removes them all. Pages from before the redesign used
`engineer.*`; those are copied over once.

Python standard library only. Windows, since that is where ACC runs.

## Credits

- Fonts: [Barlow Semi Condensed](https://github.com/jpt/barlow) and [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), SIL Open Font License, in `web/fonts`.

- Shared memory layout: Kunos' *ACC Shared Memory Documentation* 1.8.12.
- How ACC's pitstop MFD is laid out and navigated: [Simulator Controller](https://github.com/SeriousOldMan/Simulator-Controller).
- Nürburgring 24h layout traced from Wikimedia Commons *Circuit Nürburgring-2002-24h.svg* (Pitlane02, CC BY-SA 3.0).
