// The last 15 minutes of weather readings, kept while the page is open, for the trends.
export interface WxSample { t: number; rain: number; wet: number | null; clouds: number | null; track: number; air: number; wind: number | null }

const KEEP_MS = 15 * 60_000, EVERY_MS = 2000;
let log: WxSample[] = [];

/** Adds a reading (at most one every 2 s) and returns the log. */
export function wxSample(s: WxSample): readonly WxSample[] {
  const last = log[log.length - 1];
  if (last && s.t < last.t) log = [];
  if (!last || s.t - last.t >= EVERY_MS) log = [...log.filter((x) => s.t - x.t <= KEEP_MS), s];
  return log;
}

/** Least squares slope of a value per minute; null with under 30 s of readings. */
export function slopePerMin(samples: readonly WxSample[], pick: (x: WxSample) => number): number | null {
  const pts = samples.map((x) => [x.t / 60_000, pick(x)] as const).filter(([, v]) => Number.isFinite(v));
  if (pts.length < 3 || pts[pts.length - 1]![0] - pts[0]![0] < 0.5) return null;
  const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  const num = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0), den = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  return den ? num / den : null;
}
