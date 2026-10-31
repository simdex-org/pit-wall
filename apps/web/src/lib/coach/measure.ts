// Corners found from the laps themselves: the slowest points seen in most laps. Each corner owns the zone from the end of the straight
// before it to the end of the straight after it, so the zones tile the lap exactly. A zone that crosses the line ends past the last bin.
export const NB = 400;

export interface Corner { n: number; start: number; end: number; apex: number }
export interface LapBins { speed: ArrayLike<number>; thr: ArrayLike<number>; brk: ArrayLike<number>; t: ArrayLike<number> }

const smooth = (a: number[], r: number) => a.map((_, i) => { let s = 0; for (let k = -r; k <= r; k++) s += a[(i + k + NB) % NB]!; return s / (2 * r + 1); });

export function findCorners(laps: LapBins[]): Corner[] {
  if (!laps.length) return [];
  const prof = smooth(Array.from({ length: NB }, (_, i) => { const v = laps.map((l) => l.speed[i]!).sort((a, b) => a - b); return v[v.length >> 1]!; }), 2);
  const top = Math.max(...prof);
  const apexes: number[] = [];
  for (let i = 0; i < NB; i++) {
    const v = prof[i]!;
    if (v > top * 0.85) continue;
    let isMin = true, hi = v;
    for (let k = -30; k <= 30; k++) { const w = prof[(i + k + NB) % NB]!; if (w < v || (w === v && k < 0)) isMin = false; hi = Math.max(hi, w); }
    if (isMin && hi - v > top * 0.12) apexes.push(i);
  }
  const kept: number[] = [];
  for (const a of apexes) { // chicanes: apexes close together are one corner, the slowest of them
    const last = kept[kept.length - 1];
    if (last !== undefined && a - last < 14) { if (prof[a]! < prof[last]!) kept[kept.length - 1] = a; } else kept.push(a);
  }
  if (kept.length > 1 && kept[0]! + NB - kept[kept.length - 1]! < 14) { if (prof[kept[0]!]! < prof[kept[kept.length - 1]!]!) kept.pop(); else kept.shift(); }
  if (!kept.length) return [];
  const edge = kept.map((a, k) => { // the fastest point between this apex and the next
    const b = kept[(k + 1) % kept.length]! + (k + 1 === kept.length ? NB : 0);
    let best = a, bv = -1;
    for (let i = a; i <= b; i++) if (prof[i % NB]! > bv) { bv = prof[i % NB]!; best = i; }
    return best % NB;
  });
  return kept.map((apex, k) => {
    const start = edge[(k + kept.length - 1) % kept.length]!, end = edge[k]!;
    return { n: k + 1, start, end: end < start ? end + NB : end, apex };
  });
}

const at = (a: ArrayLike<number>, i: number) => a[Math.min(NB - 1, Math.max(0, i))]!;

/** Seconds the lap spends in the zone. */
export function zoneTime(l: LapBins, z: Corner): number {
  return (z.end >= NB ? at(l.t, NB - 1) - at(l.t, z.start) + at(l.t, z.end - NB) : at(l.t, z.end) - at(l.t, z.start)) / 1000;
}

export interface Measure { brake: number | null; minSpeed: number; throttle: number | null }

/** Where the driver brakes, the slowest speed, and where the throttle comes back, as bins from the zone start. */
export function measure(l: LapBins, z: Corner): Measure {
  let brake: number | null = null, throttle: number | null = null, minSpeed = Infinity;
  for (let i = z.start; i <= z.end; i++) {
    const b = i % NB, k = i - z.start;
    if (brake === null && l.brk[b]! > 0.15) brake = k;
    if (i <= z.apex + (z.apex < z.start ? NB : 0) + 40 && l.speed[b]! < minSpeed) minSpeed = l.speed[b]!;
  }
  const apex = z.apex < z.start ? z.apex + NB : z.apex;
  for (let i = apex; i <= z.end; i++) if (l.thr[i % NB]! > 0.6) { throttle = i - z.start; break; }
  return { brake, minSpeed, throttle };
}
