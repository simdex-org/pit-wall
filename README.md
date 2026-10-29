# Pit Wall

A live race-engineer dashboard for **Assetto Corsa Competizione**, with **remote pit stop control**.
One person drives; the engineer, on another PC anywhere over Hamachi (or ZeroTier, or Tailscale),
watches the car in a browser and sets the next pit stop (fuel, tyres, compound, pressures, brake pads and repairs)
straight into the driver's game.

![Next pit stop: the driver's MFD as read from the game, the engineer's plan, and what was confirmed](docs/pit-stop.png)

![Live view: gear, speed, pedals, lap timing, fuel, channel traces, track map and the engineer's advice](docs/live.png)

No framework, no build, no install beyond Python. Telemetry comes from
[Pro Engineer](https://github.com/Rgosh/ac-pro-engineer), which runs on the driver's PC.

---

## How it works, and what ACC allows

```
 DRIVER'S PC                                                     ENGINEER'S PC
 ACC ── shared memory ──> Pro Engineer ──UDP 127.0.0.1:9001──> server/bridge.py ══ Hamachi ══> browser
  ^                                                              │  (HTTP :8765)                  │
  └──── MFD key presses (P, arrows) <── server/acc_pit.py <──────┘ <──── pit plan (with key) ─────┘
```

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
| In-car electronics (TC, ABS, map, bias) | ❌ | Shown read-only on the Strategy tab. ACC only changes them from the car's own controls. |

Limits, plainly:

- **ACC must be the focused window on the driver's PC.** Keys are only sent while it is. If focus changes
  mid-way, pit control stops before pressing anything else and the dashboard says so. It never types into another program.
- **Applying a plan takes about 15 to 30 seconds**: it first finds out how the pit page is laid out
  (Strategy row or not, tyres changing or not, wet or dry, brakes changing or not), then sets each value
  and reads it back. The driver sees the MFD moving; they should not use the MFD keys meanwhile.
- **The arrow keys and P must be ACC's MFD keys** (they are by default). If the driver rebound them,
  pass the pitstop key with `--pit-key`. Arrow keys must not be bound to anything else.
- Changes apply **without the driver confirming**: the engineer presses *Send to driver* and it happens.
- The page layout was taken from how ACC 1.9/1.10 lays out the pitstop MFD and how
  [Simulator Controller](https://github.com/SeriousOldMan/Simulator-Controller) drives it. It is tested
  against a simulated MFD covering every layout (`python server/acc_pit.py`). **Test it once in a practice session before a race.**

---

## Install

**Driver's PC** (Windows; ACC runs here):

1. [Python 3.8 or newer](https://www.python.org/downloads/) (the Microsoft Store build works too).
2. [Pro Engineer](https://github.com/Rgosh/ac-pro-engineer/releases) with the game set to *Assetto Corsa Competizione* on its launcher.
3. This repository: *Code → Download ZIP* and unzip it, or `git clone https://github.com/simdex-org/pit-wall`.

**Engineer's PC**: only a browser.

Both PCs: the VPN, below.

## Connecting the two PCs with Hamachi

The engineer's browser reaches the driver's PC on port **8765** over the VPN. Nothing is opened to the internet.

1. Install [LogMeIn Hamachi](https://vpn.net/) on **both** PCs and sign in.
2. **Driver:** *Network → Create a new network*. Choose a network ID and a password.
3. **Engineer:** *Network → Join an existing network* with that ID and password.
4. On the driver's PC, the **IPv4 address** at the top of the Hamachi window (`25.x.x.x`) is the address the engineer will use.
5. **Driver, Windows firewall:** Windows usually files the Hamachi network as *Public*. The first time `bridge.py` starts,
   Windows asks whether to allow Python: tick **Public** as well as Private. If the question was dismissed:
   *Windows Security → Firewall → Allow an app through firewall → Python → tick Public*.

Using **ZeroTier** instead: create a network at my.zerotier.com, join it from both PCs with its network ID, tick *Auth* for both
members, and use the driver's ZeroTier address. With **Tailscale**: sign both PCs into the same account (or share the machine)
and use the driver's `100.x.x.x` address. Everything else is the same.

## Driver: running it

1. In Pro Engineer's config file, `%APPDATA%\RaceEngineer\RaceEngineer\config\config.json`, send the session to this PC
   and leave Pro Engineer's own receiver off, so port 9001 is free for the bridge:

   ```json
   "overlay": { "broadcast_to": "127.0.0.1:9001", "broadcast_enabled": true, "receive_enabled": false },
   "lan": { "mode": "Share" }
   ```

   (Before, it may have pointed at the engineer's Hamachi address. Now the engineer connects to you instead.)

2. Start the bridge, in a terminal in this folder:

   ```bash
   python server/bridge.py --udp 127.0.0.1:9001 --http 0.0.0.0:8765
   ```

   It prints the links for the engineer, one per network address, for example:

   ```
   Engineer, open one of these (the Hamachi one is 25.x.x.x):
       http://25.40.144.183:8765/?key=Xq3v9MFa
   ```

   Send the engineer the `25.x.x.x` link. The **key** is what allows sending pit plans; it changes on every start unless you fix it
   with `--key something-long`. Without the key the dashboard can be watched but not used to change anything.

3. Start Pro Engineer and ACC, and drive. Keep ACC as the focused window.

## Engineer: using it

1. Open the link the driver sent (`http://25.x.x.x:8765/?key=…`). The key is remembered by the browser, so later the plain address works.
2. The dashboard opens as soon as the driver is on track: **Live**, **Tyres & brakes**, **Strategy**, **Laps**, **Compare**, **Log & notes**. Number keys 1–7 switch tabs.
3. **Strategy → Next pit stop:**
   - **MFD now** is what the driver's pit page holds right now, read from the game.
   - **Plan** is the next stop. *Copy MFD into plan* starts from the current values; *use fuel to finish* takes the
     figure from the *Fuel to finish* calculator above it.
   - **Send to driver** sets it in the driver's game. **Last sent** then says, row by row: `ok` (read back from the game),
     `sent` (pressed, but ACC does not publish it), or the problem (`stopped at 120` when a value hit the game's limit).
   - *Repair suspension / bodywork* are switches: ticking one flips that row once (yes ↔ no), since ACC does not say which it currently is.
     The driver sees the result on their MFD.
4. Every applied or failed plan is also written to **Log & notes**.

The dashboard also works on a phone or tablet.

## Trying it without the game

```bash
python server/bridge.py --simulate-acc --key demo
```

opens the dashboard against a pretend pit page, so the whole pit stop panel can be used without ACC. Telemetry
still needs Pro Engineer sending to UDP 9001.

`python server/acc_pit.py` is the self-test: it applies several plans to a simulated pit page in every layout ACC can
show (with and without a Strategy row, tyres changing or not, dry or wet, brakes changing or not, with and without a Driver row)
and checks the result.

## Command line

`python server/bridge.py [options]`

| Option | Default | What it is |
|---|---|---|
| `--udp HOST:PORT` | `0.0.0.0:9001` | Where Pro Engineer's UDP arrives. On the driver's PC: `127.0.0.1:9001`. |
| `--http HOST:PORT` | `127.0.0.1:8765` | Where the dashboard is served. `0.0.0.0:8765` makes it reachable over the VPN. |
| `--key KEY` | new random key each start | Access key needed to send pit plans. |
| `--pit-key KEY` | `p` | ACC's key for the pitstop MFD page: one character or `F1`–`F24`. |
| `--key-ms MS` | `40` | How long each key is held, and the pause after it. Raise it (60–80) if ACC misses presses at a low frame rate. |
| `--simulate-acc` | off | A pretend pit page instead of the game. |
| `--no-browser` | off | Do not open the dashboard on this PC. |

The older setup still works: run `python server/bridge.py` on the engineer's PC and point Pro Engineer's `broadcast_to`
at it. That only watches; pit control needs the bridge on the driver's PC.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Engineer's browser cannot connect | The bridge was started without `--http 0.0.0.0:8765`, Hamachi shows the driver offline, or the firewall blocks Python on Public networks (see above). |
| Dashboard opens but says *Waiting for the driver* | Pro Engineer is not sending to `127.0.0.1:9001`, or another program owns port 9001. The bridge's terminal says every 5 s whether anything arrives. |
| *Next pit stop* says **ACC not running** | ACC is not in a session on the driver's PC, or the bridge runs on a different PC from ACC. |
| *Failed: ACC is not the focused window* | The driver alt-tabbed, or a notification took focus. Click into ACC and send again. |
| *Failed: could not find the tyre rows* | The pitstop key opened something else. Check ACC's *Controls → MFD Pitstop* binding and pass it with `--pit-key`. |
| Values land one row off, or presses are missed | Raise `--key-ms` to 60 or 80. |
| *Wrong or missing access key* | Open the link with `?key=…` the bridge printed this time; the key changes on every start unless `--key` is given. |

## Project layout

```
server/bridge.py     UDP in, dashboard + Server-Sent Events out, POST /pit
server/acc_pit.py    ACC pit page: shared memory reader, MFD key presses, the plan logic, self-test
web/                 index.html, css/app.css, js/*.js, data/tracks.js
docs/                screenshots
```

Python standard library only, Windows for pit control (watching works anywhere).

## Credits

- Telemetry and advice: [Pro Engineer](https://github.com/Rgosh/ac-pro-engineer) by Rgosh.
- How ACC's pitstop MFD is laid out and navigated: [Simulator Controller](https://github.com/SeriousOldMan/Simulator-Controller).
- Shared memory layout: Kunos' *ACC Shared Memory Documentation* 1.8.12.
- Nürburgring 24h layout traced from Wikimedia Commons *Circuit Nürburgring-2002-24h.svg* (Pitlane02, CC BY-SA 3.0).
