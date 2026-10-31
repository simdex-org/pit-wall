// The race fuel and stint calculator. The live strategy figures come from the bridge; this one plans a whole race from typed
// inputs, so it is a pure function here. Laps are split evenly over the stints, a stop never changes the pace and the pit window is not planned.

export interface PlanInputs {
  raceMin: number | null;
  raceLaps: number | null;
  /** Laps after the timer reaches zero. */
  extra: number;
  lapS: number | null;
  /** Litres per lap. */
  fpl: number | null;
  /** Tank, litres; 0 or null = unknown. */
  cap: number | null;
  /** Laps of fuel kept at every stop and at the flag. */
  reserve: number;
  /** Fuel burnt before lap 1. */
  formL: number;
  mand: number;
  maxStintMin: number | null;
  /** Drive-through loss, seconds. */
  lossS: number;
  refuelSpl: number;
  tyreS: number;
  /** Tyres are changed at every stop. */
  tyres: boolean;
  /** Fuel, then tyres, instead of both at once. */
  seq: boolean;
  minStat: number;
  /** Seconds per lap per 10 L carried. */
  wt: number;
}

export interface Stint { n: number; laps: number; from: number; to: number; load: number; add: number | null; stat: number }
export interface StopOption { n: number; stints: Stint[]; start: number; stat: number; tank: boolean; rule: boolean; ok: boolean; timeS: number }
export interface FuelPlan {
  total: number | null;
  nMin: number;
  options: StopOption[];
  best: StopOption | null;
  save: { fpl: number; pct: number; gainS: number } | null;
}

export function fuelPlan(i: PlanInputs): FuelPlan {
  const timed = i.raceLaps == null;
  const cap = i.cap != null && i.cap > 0 ? i.cap : Infinity;
  const fpl = i.fpl ?? 0, lapS = i.lapS ?? 0;
  const res = i.reserve * fpl;
  const out: FuelPlan = { total: null, nMin: 0, options: [], best: null, save: null };
  if (!(fpl > 0) || !(lapS > 0) || !((timed ? i.raceMin ?? 0 : i.raceLaps ?? 0) > 0)) return out;
  const total = (out.total = timed ? Math.ceil(i.raceMin! * 60 / lapS - 1e-6) + (i.extra || 0) : Math.round(i.raceLaps!));
  const nMin = (out.nMin = Math.max(i.mand || 0, i.maxStintMin != null && i.maxStintMin > 0 ? Math.ceil(total * lapS / (i.maxStintMin * 60) - 1e-6) - 1 : 0));

  const make = (n: number): StopOption => {
    const k = n + 1, base = Math.floor(total / k), rem = total % k, stints: Stint[] = [];
    let from = 1, stat = 0, wt = 0;
    for (let s = 0; s < k; s++) {
      const laps = base + (s < rem ? 1 : 0), burn = laps * fpl, load = burn + res + (s ? 0 : i.formL || 0);
      const a = s ? burn * i.refuelSpl : 0, b = s && i.tyres ? i.tyreS : 0;
      const st = s ? Math.max(i.minStat || 0, i.seq ? a + b : Math.max(a, b)) : 0;
      stints.push({ n: s + 1, laps, from, to: from + laps - 1, load, add: s ? burn : null, stat: st });
      stat += st;
      wt += (laps * (i.wt || 0)) / 10 * (load - burn / 2);
      from += laps;
    }
    const tank = stints.every((s) => s.load <= cap + 1e-9);
    return { n, stints, start: stints[0]!.load, stat, tank, rule: n >= nMin, ok: tank && n >= nMin, timeS: total * lapS + n * i.lossS + stat + wt };
  };

  const all: StopOption[] = [];
  for (let n = 0; n <= 9; n++) all.push(make(n));
  const first = all.findIndex((o) => o.ok);
  if (first < 0) {
    out.options = all.slice(Math.max(0, Math.min(nMin, 9) - 1), Math.min(nMin, 9) + 3);
    return out;
  }
  out.options = all.slice(Math.max(0, first - 1), first + 3);
  out.best = all.filter((o) => o.ok).reduce((a, b) => (b.timeS < a.timeS ? b : a));
  const n = out.best.n;
  // The consumption that saves a stop: the heaviest stint of n-1 stops must fit the tank.
  if (n > 0 && n - 1 >= nMin && cap < Infinity) {
    const fmax = (cap - (i.formL || 0)) / (Math.ceil(total / n) + i.reserve);
    out.save = { fpl: fmax, pct: (1 - fmax / fpl) * 100, gainS: out.best.timeS - all[n - 1]!.timeS };
  }
  return out;
}
