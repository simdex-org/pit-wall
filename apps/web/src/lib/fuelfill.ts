// Typical lap time and fuel per lap from the laps already driven, to fill the calculator.
export interface FillLap { n?: number; ms?: number; valid?: boolean; fuel?: number | null; out?: boolean; in?: boolean }

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1]! : null; };

/** Median time and fuel of the clean laps (valid, not in or out, within 107% of the best), as the calculator's text fields. */
export function fromLaps(laps: FillLap[]): { lap: string; fpl: string; n: number } {
  const ok = laps.filter((l) => l.valid !== false && !l.out && !l.in && (l.ms ?? 0) > 0);
  const best = Math.min(...ok.map((l) => l.ms!));
  const clean = ok.filter((l) => l.ms! <= best * 1.07);
  const ms = median(clean.map((l) => l.ms!)), fuel = median(clean.map((l) => l.fuel ?? 0).filter((f) => f > 0));
  const s = ms == null ? "" : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, "0")}`;
  return { lap: s, fpl: fuel == null ? "" : fuel.toFixed(2), n: clean.length };
}
