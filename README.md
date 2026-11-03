<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="screenshots/logo.svg">
    <img src="screenshots/logo-light.svg" alt="Pit Wall" width="320">
  </picture>
</p>

<p align="center">
  Watch your driver live in Assetto Corsa Competizione, and set their next pit stop from your browser.
</p>

<p align="center">
  <a href="https://github.com/simdex-org/pit-wall/releases/latest"><b>Download</b></a> ·
  <a href="#get-started">Get started</a> ·
  <a href="#connect-the-pcs">Connect</a> ·
  <a href="#try-it-without-acc">Demo</a> ·
  <a href="docs/GUIDE.md">Guide</a>
</p>

<p align="center">
  <img src="screenshots/live.png" alt="The Live screen at Spa" width="100%">
</p>

## What it does

- **Live car and whole-field timing:** laps, fuel, tyres, damage, gaps, pit lane, flags, every car on the map.
- **Strategy done for you:** when to box, how much fuel, stops left, where you rejoin.
- **Remote pit stop:** set fuel, tyres, pressures, pads and repairs. Pit Wall enters them in the driver's game and checks they went in.
- **Lap coach:** shows corner by corner where a lap loses time.
- **Your layout:** drag-and-drop modules, five templates, works on a phone.
- **Private:** runs on the driver's PC over your own VPN. No account, no cloud.

<table>
  <tr>
    <td width="50%"><img src="screenshots/timing.png" alt="Timing"></td>
    <td width="50%"><img src="screenshots/pit.png" alt="Pit stop"></td>
  </tr>
  <tr>
    <td width="50%"><img src="screenshots/strategy.png" alt="Strategy"></td>
    <td width="50%"><img src="screenshots/analysis.png" alt="Analysis and lap coach"></td>
  </tr>
</table>

## Get started

**Driver (Windows):** download [Pit Wall](https://github.com/simdex-org/pit-wall/releases/latest) (installer or portable `PitWall.exe`), press **Start**, send the engineer the link it shows. Start ACC and drive.

**Engineer:** open the link in a browser. Nothing to install.

Only people with the key in the link can send pit plans. Everyone else just watches.

<details>
<summary>From source (Node.js 22+, pnpm)</summary>

```bash
git clone https://github.com/simdex-org/pit-wall
cd pit-wall
pnpm install
pnpm build
pnpm --filter @pitwall/bridge start --http 25.x.x.x:8765
```

Once, with ACC closed, switch on timing for the other cars: `pnpm --filter @pitwall/bridge start --enable-broadcast`. More in [development](docs/development.md).

</details>

## Connect the PCs

Both PCs join the same VPN (Hamachi, ZeroTier or Tailscale). Pit Wall uses the driver's VPN address, and nothing is opened to the internet. With Hamachi, run this once as administrator on the driver's PC, then allow Pit Wall on private networks only:

```powershell
Set-NetConnectionProfile -InterfaceAlias "Hamachi" -NetworkCategory Private
```

## Try it without ACC

```bash
pnpm --filter @pitwall/bridge start --simulate-acc --key demo
```

A full session with a 20-car field and a working pit page. Options such as `--sim-session quali` and `--sim-track spa` are in the [guide](docs/GUIDE.md).

## Good to know

- ACC must be the focused window while a plan goes in, which takes 15 to 30 seconds. Try it once in practice before a race.
- Everything else (modules, templates, vJoy, troubleshooting) is in the **[guide](docs/GUIDE.md)**.

## Credits

By [Simdex](https://github.com/simdex-org): William19D and Simplezes. [MIT License](LICENSE).