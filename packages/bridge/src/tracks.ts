import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TRACK_DIR } from "./paths.js";
import type { Rec } from "./util.js";

export const trackFile = (name: string): string =>
  join(TRACK_DIR, [...String(name).toLowerCase()].map((c) => (/[\p{L}\p{N}_-]/u.test(c) ? c : "_")).join("").slice(0, 60) + ".json");

export function loadLayout(name: string): Rec | null {
  try { return JSON.parse(readFileSync(trackFile(name), "utf-8")); } catch { return null; }
}

export function saveLayout(name: string, lay: Rec): void {
  const old = loadLayout(name);
  let out: Rec = lay;
  if (!lay.line) {
    if (!lay.sec) return;
    out = old ? { ...old, sec: old.sec?.length ? old.sec : lay.sec } : { valid: false, ms: null, ...lay };
  } else if (old) {
    const a = [old.valid ? 0 : 1, old.ms ?? 9e9], b = [lay.valid ? 0 : 1, lay.ms];
    if (a[0]! < b[0]! || (a[0] === b[0] && a[1]! <= b[1]!)) return;
  }
  try {
    mkdirSync(TRACK_DIR, { recursive: true });
    writeFileSync(trackFile(name), JSON.stringify({ ...out, track: name }));
  } catch {  }
}
