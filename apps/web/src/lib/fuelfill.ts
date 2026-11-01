import { fmtLap } from "./format";

export interface FillLap { ms: number; valid: boolean; out?: boolean; in?: boolean; fuel?: number | null }

const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;

/** Race pace and fuel per lap from the clean laps of every session so far: the laps within 3 % of the best clean one. */
export function fromLaps(laps: FillLap[]): { lap: string | null; fpl: string | null; n: number } {
  const clean = laps.filter((l) => l.valid && !l.out && !l.in && l.ms > 0);
  if (!clean.length) return { lap: null, fpl: null, n: 0 };
  const best = Math.min(...clean.map((l) => l.ms));
  const pace = clean.filter((l) => l.ms <= best * 1.03), fuel = pace.filter((l) => (l.fuel ?? 0) > 0);
  return { lap: fmtLap(mean(pace.map((l) => l.ms))), fpl: fuel.length ? mean(fuel.map((l) => l.fuel!)).toFixed(2) : null, n: pace.length };
}
