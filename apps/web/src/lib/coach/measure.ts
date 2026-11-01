// Corners of a track found from the laps themselves, and what the driver did in each one.
// Bins are positions along the lap (NB of them). A bin number of NB or more is the same lap seen across the line, so a corner
// near the finish can own the straight over it and the corner zones tile the lap exactly.
import { LapData, NB } from "../../state/recorder";

export const wrap = (u: number): number => (u < NB ? u : u - (NB - 1));
/** Time at an unwrapped bin: the line is bin 0 and bin NB - 1. */
export const timeAt = (d: LapData, u: number): number => (u < NB ? d.t[u]! : d.t[NB - 1]! + d.t[u - (NB - 1)]!);
export const binMOf = (len: number): number => (len > 0 ? len / (NB - 1) : 12.5);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export interface Corner {
  n: number;
  /** The first slowest point (a chicane has several) and the one the corner is known by. */
  lead: number; apex: number;
  /** The zone this corner owns: from just before its braking to just before the next corner's. */
  start: number; end: number;
  vApex: number; cls: "slow" | "medium" | "fast";
}

const smooth3 = (a: Float32Array): Float32Array => a.map((_, i) => (a[Math.max(0, i - 1)]! + a[i]! + a[Math.min(NB - 1, i + 1)]!) / 3);
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1]! : 0; };
const pct = (xs: number[], q: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(q * (s.length - 1))] ?? 0; };

/** The slowest points of one lap: a dip of 10 km/h and 6 % against the faster stretches on both sides. */
function apexes(d: LapData, win: number, far: number): number[] {
  const v = smooth3(d.speed), out: number[] = [];
  for (let i = 2; i < NB - 2; i++) {
    let lo = Infinity;
    for (let k = Math.max(0, i - win); k <= Math.min(NB - 1, i + win); k++) lo = Math.min(lo, v[k]!);
    if (v[i]! > lo) continue;
    let pre = 0, post = 0;
    for (let k = Math.max(0, i - far); k <= i; k++) pre = Math.max(pre, v[k]!);
    for (let k = i; k <= Math.min(NB - 1, i + far); k++) post = Math.max(post, v[k]!);
    if (Math.min(pre, post) - v[i]! < Math.max(10, 0.06 * Math.max(pre, post))) continue;
    const last = out[out.length - 1];
    if (last != null && i - last <= win) { if (v[i]! < v[last]!) out[out.length - 1] = i; } else out.push(i);
  }
  return out;
}

/** Where braking (or, with no brake, the speed drop) begins before a slowest point, searching back no further than `lo`. */
function entryBin(d: LapData, lo: number, apex: number): { e: number; braked: boolean } {
  let end = -1, start = -1;
  for (let u = apex + 2; u >= lo; u--) {
    if (d.brk[wrap(u)]! > 0.1) { if (end < 0) end = u; start = u; } else if (end >= 0 && start - u > 6) break;
  }
  if (end >= 0 && end >= apex - 60) return { e: start, braked: true };
  let i = apex;
  while (i > lo && d.speed[wrap(i - 1)]! >= d.speed[wrap(i)]! - 0.5) i--;
  return { e: i, braked: false };
}

/**
 * The corners of a track from several laps (best first): slowest points seen in at least half of them, chicanes joined, and the
 * zone of each corner cut where the laps are still at speed before the next braking.
 */
export function findCorners(laps: LapData[], binM: number): Corner[] {
  if (!laps.length) return [];
  const win = clamp(Math.round(90 / binM), 3, 8), far = clamp(Math.round(500 / binM), 20, 60), tol = Math.max(4, win);
  const seen: number[] = [];
  for (const d of laps) seen.push(...apexes(d, win, far));
  seen.sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const b of seen) { const g = groups[groups.length - 1]; if (g && b - g[g.length - 1]! <= tol) g.push(b); else groups.push([b]); }
  const need = Math.ceil(laps.length / 2), v0 = smooth3(laps[0]!.speed), gap = Math.max(25, Math.round(300 / binM));
  const cs = groups.filter((g) => g.length >= need).map((g) => { const m = median(g); return { apex: m, lead: m }; });
  for (let k = 0; k + 1 < cs.length; ) { // slowest points close together with no real straight between them are one corner
    const a = cs[k]!, b = cs[k + 1]!;
    let top = 0;
    for (let i = a.apex; i <= b.apex; i++) top = Math.max(top, v0[i]!);
    if (b.apex - a.apex < gap && top - Math.max(v0[a.apex]!, v0[b.apex]!) < 18) { cs[k] = { apex: v0[a.apex]! <= v0[b.apex]! ? a.apex : b.apex, lead: a.lead }; cs.splice(k + 1, 1); } else k++;
  }
  const starts = cs.map((c, k) => {
    const prev = k ? cs[k - 1]!.apex : 0, es = laps.map((d) => entryBin(d, Math.max(0, prev + 2), c.lead).e);
    return clamp(pct(es, 0.1) - 3, prev + 2, c.lead - 2);
  });
  const vs = cs.map((c) => median(laps.map((d) => d.speed[c.apex]!))), sorted = [...vs].sort((a, b) => a - b);
  const cls = (v: number): Corner["cls"] => (sorted.length < 3 ? "medium" : v <= sorted[Math.floor(sorted.length / 3)]! ? "slow" : v >= sorted[Math.floor((2 * sorted.length) / 3)]! ? "fast" : "medium");
  return cs.map((c, k) => ({ n: k + 1, lead: c.lead, apex: c.apex, start: starts[k]!, end: k + 1 < cs.length ? starts[k + 1]! : starts[0]! + (NB - 1), vApex: vs[k]!, cls: cls(vs[k]!) }));
}

export interface Metrics {
  e: number; braked: boolean; r: number; a: number; p: number; x: number;
  brakeM: number; peak: number; trailM: number; coastM: number; rampM: number; lifts: number;
  vEntry: number; vMin: number; vExit: number; vTop: number;
  steerPeak: number; steerWork: number; gear: number;
  gLat: number | null; steerPerG: number | null; tcM: number | null; absM: number | null;
}

/** What one lap did in one corner's zone. */
export function measure(d: LapData, c: Corner, binM: number): Metrics {
  const W = Math.max(4, Math.round(90 / binM)), v = (u: number) => d.speed[wrap(u)]!, thr = (u: number) => d.thr[wrap(u)]!, brk = (u: number) => d.brk[wrap(u)]!;
  const { e, braked } = entryBin(d, c.start, c.lead);
  let a = c.apex;
  for (let u = c.lead - 2; u <= c.apex + W; u++) if (v(u) < v(a)) a = u;
  let r = e;
  if (braked) for (let u = e; u <= a + 2; u++) if (brk(u) > 0.05) r = u;
  r = Math.min(r, a);
  let p = a, x = Math.min(c.end, a + Math.round(300 / binM));
  const sustained = (from: number, lim: number, ok: (u: number) => boolean) => { for (let u = from; u <= lim - 2; u++) if (ok(u) && ok(u + 1) && ok(u + 2)) return u; return -1; };
  const pu = sustained(a, c.end, (u) => thr(u) >= 0.2 && brk(u) < 0.05);
  if (pu >= 0) p = pu;
  const xu = sustained(p, c.end, (u) => thr(u) >= 0.95);
  if (xu >= 0) x = xu;
  x = Math.max(x, p);
  let peak = 0, trail = 0, coast = 0, lifts = 0, top = 0, st = 0, steerMax = 0.05, run = thr(p), tc = 0, ab = 0;
  for (let u = e; u <= r; u++) { peak = Math.max(peak, brk(u)); if (d.abs && d.abs[wrap(u)]! > 0.05) ab++; }
  for (let u = 0; u < NB; u++) steerMax = Math.max(steerMax, Math.abs(d.steer[u]!));
  for (let u = e; u <= a; u++) if (brk(u) > 0.05 && Math.abs(d.steer[wrap(u)]!) >= 0.3 * steerMax) trail++;
  for (let u = e; u <= x; u++) if (thr(u) < 0.05 && brk(u) < 0.05) coast++;
  for (let u = p; u <= x; u++) { run = Math.max(run, thr(u)); if (thr(u) < run - 0.15) { lifts++; run = thr(u); } if (d.tc && d.tc[wrap(u)]! > 0.05) tc++; }
  for (let u = x; u <= c.end; u++) top = Math.max(top, v(u));
  let sp = 0;
  for (let u = a - 6; u <= a + 6; u++) sp = Math.max(sp, Math.abs(d.steer[wrap(Math.max(0, u))]!));
  for (let u = a; u < x; u++) st += Math.abs(d.steer[wrap(u + 1)]! - d.steer[wrap(u)]!);
  st = Math.max(0, st - Math.abs(d.steer[wrap(a)]! - d.steer[wrap(x)]!)); // what is left once the one smooth movement is taken out: the corrections
  let gl: number | null = null;
  if (d.glat) { gl = 0; for (let u = a - 4; u <= a + 4; u++) gl = Math.max(gl, Math.abs(d.glat[wrap(Math.max(0, u))]!)); }
  return {
    e, braked, r, a, p, x, brakeM: (r - e) * binM, peak, trailM: trail * binM, coastM: coast * binM, rampM: (x - p) * binM, lifts,
    vEntry: v(e), vMin: v(a), vExit: v(Math.min(c.end, a + Math.round(200 / binM))), vTop: top, steerPeak: sp, steerWork: sp > 0 ? st / sp : 0, gear: d.gear[wrap(a)]!,
    gLat: gl, steerPerG: gl && gl > 0.2 ? sp / gl : null, tcM: d.tc ? tc * binM : null, absM: d.abs ? ab * binM : null,
  };
}
