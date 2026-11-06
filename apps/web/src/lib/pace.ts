interface PaceLap { out?: unknown; in?: unknown }

// Laps that show the car's pace: not an out or in lap, and within 7% of the stint's median (traffic, yellows, spins).
// An invalid lap still counts, its time is real.
export function paceLaps<T extends PaceLap>(laps: T[], v: (l: T) => number): T[] {
  const base = laps.filter((l) => !l.out && !l.in);
  if (!base.length) return [];
  const med = base.map(v).sort((a, b) => a - b)[(base.length - 1) >> 1]!;
  return base.filter((l) => v(l) <= med * 1.07);
}
