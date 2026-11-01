# Development

Needs Node 22 or newer and pnpm. The Tauri launcher also needs Rust and the MSVC build tools.

```
pnpm install
pnpm test          # all packages
pnpm typecheck
```

## Running the bridge

```
pnpm --filter @pitwall/bridge start -- --simulate-acc --key demo      # a pretend race, no game needed
pnpm --filter @pitwall/bridge start -- --http 25.x.x.x:8765           # on the driver's PC, on its VPN address
pnpm --filter @pitwall/bridge start -- --help
```

Other commands: `--enable-broadcast` (once, ACC closed), `--probe`, `--bind-vjoy`.

## Tests

Tests live in `packages/bridge/test`. The telemetry, broadcast and pit tests run a simulated session through the real code; the Windows test exercises shared memory, key injection and the keyboard hook without needing ACC.

## Graphify

`graphify-out/` is generated and ignored by git.

## The page

```
pnpm --filter @pitwall/web dev      # hot reload, proxies the bridge on 127.0.0.1:8765
pnpm --filter @pitwall/web build    # what the bridge serves
```

Start a simulated bridge (above) in another terminal, then open the dev server's address. Tests sit beside the files (`*.test.ts`). One checks that every built-in template uses only registered modules.

## The launcher

```
pnpm --filter @pitwall/launcher dev              # the UI alone, in a browser
pnpm --filter @pitwall/launcher package          # bundles Node, the bridge and the page, then builds the installer
pnpm --filter @pitwall/launcher package:portable # one PitWall.exe in apps/launcher/dist-portable, no install
```

The portable exe carries Node, the bridge and the page as a zip (`portable` cargo feature, `src-tauri/src/portable.rs`) and unpacks them into the app data folder on its first start. A new build unpacks beside the old one and removes it.

### Updates

Every push to `main` runs `.github/workflows/build.yml`: tests, typecheck and build. Releases are made by hand: publish a GitHub release with the installer (`Pit.Wall_x.y.z_x64-setup.exe`) and the portable exe (`PitWall.exe`) attached.

The launcher asks GitHub for the latest release. If its version is higher than the one it runs, it shows an Update button (disabled while the bridge runs). The button downloads the installer or the portable exe, whichever the launcher is (the portable build sets `PITWALL_PORTABLE=1` for the bridge), into the app data folder. The launcher then closes and runs the installer, or for the portable build swaps its own exe for the new one and starts it.

`--update-check` and `--update` do the same download from a terminal. Both need a build that came from the installer or the portable exe; from source there is nothing to update.
