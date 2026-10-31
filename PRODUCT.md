# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
TypeScript: a Node bridge, a React and Tailwind page (Vite) and a Tauri launcher, in a pnpm workspace.

## Users
A dedicated race engineer at a full PC, watching a driver in Assetto Corsa live, reading data and advice, and comparing laps between stints.

## Product Purpose
Live browser dashboard for the engineer: track map with the car, car state, tyres and brakes, fuel and strategy, the engineer's advice, laps and debrief, and the next pit stop set straight into the driver's game. Fed by the bridge over SSE, which reads ACC's shared memory on the driver's PC (30 Hz reading, 10 Hz summary).

## Capabilities and Constraints
- No network dependency beyond Lucide icons; no build step.
- ALERT thresholds match the bridge's advice thresholds.
- Reading payload optional rows are gated on `capabilities` flags.
- Redesign is UI first; the rest of the tool (bridge, data) is to be redesigned later.

## Brand Commitments
User-pinned: clean design; no gradients; nothing that looks AI-generated.

## Product Principles
- Glanceable live state, deep detail one tab away.
- Engineer advice is always visible, whichever tab is open.
- Stale or missing data is shown honestly, never faked.

## Accessibility & Inclusion
Do not rely on colour alone for alert states.
