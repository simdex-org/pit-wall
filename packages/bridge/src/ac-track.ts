import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { loadLayout, saveLayout } from "./tracks.js";
import type { Rec } from "./util.js";

// AC ships each track's racing line as content/tracks/<track>[/<layout>]/ai/fast_lane.ai: a 16-byte header
// (version, point count, 2 unused) then 20 bytes per point: x, y, z, distance along the line, id.
export function parseFastLane(b: Buffer): Rec | null {
  if (b.length < 16) return null;
  const n = b.readInt32LE(4);
  if (n < 100 || b.length < 16 + 20 * n) return null;
  const total = b.readFloatLE(16 + 20 * (n - 1) + 12);
  if (!(total > 0)) return null;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const line: number[][] = [];
  for (let k = 0; k < n; k++) {
    const o = 16 + 20 * k;
    line.push([r1(b.readFloatLE(o)), r1(b.readFloatLE(o + 8)), Math.round((b.readFloatLE(o + 12) / total) * 1e5) / 1e5]);
  }
  return { valid: false, ms: null, sec: [], line };
}

// The timing gates are dummy nodes AC_TIME_<n>_<L|R> in the layout's .kn5 models (listed in models[_layout].ini):
// an int32 name length, the name, an int32 child count, a byte, then the node's 4x4 matrix (translation in the last row).
export function findGates(file: string): Map<string, [number, number]> {
  const gates = new Map<string, [number, number]>();
  const fd = openSync(file, "r"), CH = 1 << 23, buf = Buffer.alloc(CH + 256);
  try {
    for (let pos = 0, got = 1; got > 0; pos += CH) {
      got = readSync(fd, buf, 0, CH + 256, pos);
      for (let at = buf.indexOf("AC_TIME_"); at >= 0 && at < Math.min(got, CH); at = buf.indexOf("AC_TIME_", at + 1)) {
        const m = /^AC_TIME_(\d+)_([LR])/.exec(buf.toString("latin1", at, at + 14));
        if (!m || at < 4 || at + m[0].length + 69 > got || buf.readInt32LE(at - 4) !== m[0].length) continue;
        const o = at + m[0].length + 5, x = buf.readFloatLE(o + 48), y = buf.readFloatLE(o + 52), z = buf.readFloatLE(o + 56);
        if ([x, y, z].every((v) => Math.abs(v) < 1e5) && (Math.abs(x) > 1e-2 || Math.abs(z) > 1e-2) && !gates.has(m[0])) gates.set(m[0], [x, z]);
      }
    }
  } finally { closeSync(fd); }
  return gates;
}

// Where each timing gate after the start sits on the lap, from the nearest point of the line
export function gateSections(root: string, track: string, config: string, line: number[][]): number[] {
  const dir = join(root, "content", "tracks", track);
  let ini = "";
  try { ini = readFileSync(join(dir, config ? `models_${config}.ini` : "models.ini"), "utf-8"); } catch { return []; }
  const gates = new Map<string, [number, number]>();
  for (const f of ini.matchAll(/^FILE=(.+)$/gm)) {
    try { for (const [k, v] of findGates(join(dir, f[1]!.trim()))) if (!gates.has(k)) gates.set(k, v); } catch {  }
  }
  const out: number[] = [];
  for (let n = 1; gates.has(`AC_TIME_${n}_L`) && gates.has(`AC_TIME_${n}_R`); n++) {
    const [lx, lz] = gates.get(`AC_TIME_${n}_L`)!, [rx, rz] = gates.get(`AC_TIME_${n}_R`)!;
    const cx = (lx + rx) / 2, cz = (lz + rz) / 2;
    let best = line[0]!, d = Infinity;
    for (const q of line) { const e = (q[0]! - cx) ** 2 + (q[1]! - cz) ** 2; if (e < d) { d = e; best = q; } }
    out.push(best[2]!);
  }
  return out;
}

export function importTrack(root: string, track: string, config: string, name: string): void {
  try {
    let lay = loadLayout(name);
    if (!lay) {
      lay = parseFastLane(readFileSync(join(root, "content", "tracks", track, ...(config ? [config] : []), "ai", "fast_lane.ai")));
      if (lay) saveLayout(name, lay);
    }
    if (lay?.line && !lay.sec?.length) {
      const sec = gateSections(root, track, config, lay.line);
      if (sec.length) saveLayout(name, { sec });
    }
  } catch {  }
}
