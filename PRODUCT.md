# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Static HTML/CSS/JS, no framework or build (existing: index.html, tracks.js, bridge.py).

## Users
A dedicated race engineer at a full PC, watching a driver in Assetto Corsa live, reading data and advice, and comparing laps between stints.

## Product Purpose
Live browser dashboard for the engineer: track map with the car, car state, tyres and brakes, fuel and strategy, the driver-side engineer's advice, laps and debrief. Fed by bridge.py over SSE from the driver's Pro Engineer app (30 Hz reading, 10 Hz summary).

## Capabilities and Constraints
- No network dependency beyond Lucide icons; no build step.
- ALERT thresholds mirror the desktop application's defaults.
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
