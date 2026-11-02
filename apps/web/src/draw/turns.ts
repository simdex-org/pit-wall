type Pt = [number, number];
const wrap = (a: number): number => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a);
const WINDOW_M = 20, RATE_MIN = (0.2 * Math.PI) / 180, TURN_MIN = (20 * Math.PI) / 180, JOIN_M = 10;

/**
 * The corners of a drawn loop, found from its own shape: stretches that keep turning the same way at more than 0.2 degrees a metre
 * and add up to 20 degrees or more. Stretches under 10 m apart are one turn (a long sweeper). `k` is the vertex of
 * the tightest point, in driving order from the start line.
 */
export function findTurns(loop: Pt[]): number[] {
  const pts = loop.length > 1 && loop[0]![0] === loop[loop.length - 1]![0] && loop[0]![1] === loop[loop.length - 1]![1] ? loop.slice(0, -1) : loop, n = pts.length;
  if (n < 20) return [];
  const at = (i: number): Pt => pts[((i % n) + n) % n]!;
  const heading = (i: number) => Math.atan2(at(i + 1)[1] - at(i)[1], at(i + 1)[0] - at(i)[0]);
  let tot = 0;
  for (let i = 0; i < n; i++) tot += Math.hypot(at(i + 1)[0] - at(i)[0], at(i + 1)[1] - at(i)[1]);
  const ds = tot / n, w = Math.max(2, Math.round(WINDOW_M / ds));
  const turn = Array.from({ length: n }, (_, i) => wrap(heading(i) - heading(i - 1)));
  const rate = Array.from({ length: n }, (_, i) => { let s = 0; for (let j = -w; j <= w; j++) s += turn[(((i + j) % n) + n) % n]!; return s / (2 * w * ds); });
  const start = rate.findIndex((r) => Math.abs(r) < RATE_MIN);
  if (start < 0) return [];
  interface Run { sign: number; from: number; to: number }
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (let s = 0; s < n; s++) {
    const r = rate[(start + s) % n]!, sign = r > 0 ? 1 : -1;
    if (Math.abs(r) >= RATE_MIN) {
      if (cur && cur.sign === sign) cur.to = s;
      else { if (cur) runs.push(cur); cur = { sign, from: s, to: s }; }
    } else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  const joined: Run[] = [];
  for (const r of runs) {
    const last = joined[joined.length - 1];
    if (last && (r.from - last.to) * ds < JOIN_M) { last.to = r.to; if (last.sign !== r.sign) last.sign = 0; } else joined.push({ ...r });
  }
  const ks: number[] = [];
  for (const r of joined) {
    let sum = 0, abs = 0, k = (start + r.from) % n;
    for (let s = r.from; s <= r.to; s++) {
      const i = (start + s) % n;
      sum += turn[i]!; abs += Math.abs(turn[i]!);
      if (Math.abs(rate[i]!) > Math.abs(rate[k]!)) k = i;
    }
    if ((r.sign ? Math.abs(sum) : abs) >= TURN_MIN) ks.push(k);
  }
  return ks.sort((a, b) => a - b);
}
