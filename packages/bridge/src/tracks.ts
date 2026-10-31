// A track's layout kept between sessions: replaced only by a better one (valid beats invalid, then faster).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TRACK_DIR } from "./paths.js";
import type { Rec } from "./util.js";

export const trackFile = (name: string): string =>
  join(TRACK_DIR, [...String(name).toLowerCase()].map((c) => (/[\p{L}\p{N}_-]/u.test(c) ? c : "_")).join("").slice(0, 60) + ".json");

export function loadLayout(name: string): Rec | null {
  try { return JSON.parse(readFileSync(trackFile(name), "utf-8")); } catch { return null; }
}

/** Never throws. */
export function saveLayout(name: string, lay: Rec): void {
  const old = loadLayout(name);
  // old is at least as good: (not valid, ms) lexicographically no greater than the new one's
  if (old) {
    const a = [old.valid ? 0 : 1, old.ms ?? 9e9], b = [lay.valid ? 0 : 1, lay.ms];
    if (a[0]! < b[0]! || (a[0] === b[0] && a[1]! <= b[1]!)) return;
  }
  try {
    mkdirSync(TRACK_DIR, { recursive: true });
    writeFileSync(trackFile(name), JSON.stringify({ ...lay, track: name }));
  } catch { /* the layout is only a cache */ }
}
