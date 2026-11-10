// Teammates sharing one car: each driver's laps, pace and the lap of theirs to compare
import type { Json } from "../feed/types";

export type Basis = "best" | "typical";

export interface DriverPace {
  name: string;
  laps: number;
  best: Json | null;
  typical: number | null;
  spread: number | null;
  pick: Json | null;
}

// a flying lap: valid, timed, not leaving or entering the pits
const flying = (l: Json): boolean => !!l.valid && l.ms > 0 && !l.out && !l.in;
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[(s.length - 1) >> 1]!; };
const fastest = (ls: Json[]): Json | null => (ls.length ? ls.reduce((a, l) => (l.ms < a.ms ? l : a)) : null);

// laps within 7 % of the driver's best: their race pace, without laps lost to traffic or an off
export const PACE_WINDOW = 1.07;

export function paceOf(name: string, laps: Json[], basis: Basis): DriverPace {
  const fly = laps.filter(flying), best = fastest(fly);
  const pool = best ? fly.filter((l) => l.ms <= best.ms * PACE_WINDOW) : [];
  const typical = pool.length ? median(pool.map((l) => l.ms as number)) : null;
  const spread = pool.length >= 3 ? median(pool.map((l) => Math.abs(l.ms - typical!))) : null;
  const traced = pool.filter((l) => l.trace);
  const pick = basis === "best" ? fastest(traced) : traced.length ? traced.reduce((a, l) => (Math.abs(l.ms - typical!) < Math.abs(a.ms - typical!) ? l : a)) : null;
  return { name, laps: laps.length, best, typical, spread, pick };
}

// every driver with laps in this session, in the order they first drove
export function driversOf(laps: Json[], basis: Basis = "best"): DriverPace[] {
  // the game and broadcasting can write the same name in different case: one driver either way, named as first seen
  const by = new Map<string, { name: string; laps: Json[] }>();
  for (const l of laps) {
    const d = typeof l.driver === "string" ? l.driver.trim() : "", k = d.toLowerCase();
    if (!d) continue;
    if (!by.has(k)) by.set(k, { name: d, laps: [] });
    by.get(k)!.laps.push(l);
  }
  return [...by.values()].map((g) => paceOf(g.name, g.laps, basis));
}

// the two drivers to compare: the chosen pair if both drove, else the first two; the faster one on the basis is the benchmark
export function pairOf(ds: DriverPace[], basis: Basis, want: [string, string] | null): { bench: DriverPace; other: DriverPace } | null {
  const named = want ? want.map((n) => ds.find((d) => d.name === n)) : [];
  const [a, b] = named.length === 2 && named[0] && named[1] && named[0] !== named[1] ? named as DriverPace[] : ds;
  if (!a || !b) return null;
  const time = (d: DriverPace) => (basis === "best" ? d.best?.ms : d.typical) ?? Infinity;
  return time(b) < time(a) ? { bench: b, other: a } : { bench: a, other: b };
}
