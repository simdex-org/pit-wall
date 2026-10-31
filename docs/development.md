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
pnpm --filter @pitwall/launcher dev        # the UI alone, in a browser
pnpm --filter @pitwall/launcher package    # bundles Node, the bridge and the page, then builds the installer
```
