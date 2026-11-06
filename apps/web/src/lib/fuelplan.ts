
export interface PlanInputs {
  raceMin: number | null;
  raceLaps: number | null;
  extra: number;
  lapS: number | null;
  fpl: number | null;
  cap: number | null;
  reserve: number;
  formL: number;
  mand: number;
  maxStintMin: number | null;
  lossS: number;
  refuelSpl: number;
  tyreS: number;
  tyres: boolean;
  seq: boolean;
  minStat: number;
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
  build: (stops: number[]) => StopOption;
  even: (n: number) => StopOption;
  full: (n: number) => StopOption;
  maxStops: number;
  maxStint: { first: number; rest: number };
}

export function fuelPlan(i: PlanInputs): FuelPlan {
  const timed = i.raceLaps == null;
  const cap = i.cap != null && i.cap > 0 ? i.cap : Infinity;
  const fpl = i.fpl ?? 0, lapS = i.lapS ?? 0;
  const res = i.reserve * fpl;
  const out: FuelPlan = { total: null, nMin: 0, options: [], best: null, save: null, build: () => { throw new Error("no plan"); }, even: () => { throw new Error("no plan"); }, full: () => { throw new Error("no plan"); }, maxStops: 0, maxStint: { first: Infinity, rest: Infinity } };
  if (!(fpl > 0) || !(lapS > 0) || !((timed ? i.raceMin ?? 0 : i.raceLaps ?? 0) > 0)) return out;
  const total = (out.total = timed ? Math.ceil(i.raceMin! * 60 / lapS - 1e-6) + (i.extra || 0) : Math.round(i.raceLaps!));
  const timeLaps = i.maxStintMin != null && i.maxStintMin > 0 ? Math.max(1, Math.floor(i.maxStintMin * 60 / lapS + 1e-9)) : Infinity;
  const nMin = (out.nMin = Math.max(i.mand || 0, timeLaps < Infinity ? Math.ceil(total / timeLaps) - 1 : 0));

  const build = (stops: number[]): StopOption => {
    const n = stops.length, bounds = [0, ...stops, total], stints: Stint[] = [];
    let stat = 0, wt = 0;
    for (let s = 0; s <= n; s++) {
      const from = bounds[s]! + 1, laps = bounds[s + 1]! - bounds[s]!, burn = laps * fpl, load = burn + res + (s ? 0 : i.formL || 0);
      const a = s ? burn * i.refuelSpl : 0, b = s && i.tyres ? i.tyreS : 0;
      const st = s ? Math.max(i.minStat || 0, i.seq ? a + b : Math.max(a, b)) : 0;
      stints.push({ n: s + 1, laps, from, to: from + laps - 1, load, add: s ? burn : null, stat: st });
      stat += st;
      wt += (laps * (i.wt || 0)) / 10 * (load - burn / 2);
    }
    const tank = stints.every((s) => s.load <= cap + 1e-9 && s.laps <= timeLaps);
    return { n, stints, start: stints[0]!.load, stat, tank, rule: n >= nMin, ok: tank && n >= nMin, timeS: total * lapS + n * i.lossS + stat + wt };
  };
  out.build = build;
  out.maxStint = { first: Math.min(timeLaps, Math.floor((cap - res - (i.formL || 0)) / fpl + 1e-9)), rest: Math.min(timeLaps, Math.floor((cap - res) / fpl + 1e-9)) };
  const make = (n: number): StopOption => {
    const k = n + 1, base = Math.floor(total / k), rem = total % k, stops: number[] = [];
    let at = 0;
    for (let s = 0; s < n; s++) { at += base + (s < rem ? 1 : 0); stops.push(at); }
    return build(stops);
  };

  const all: StopOption[] = [];
  const top = Math.min(total - 1, 150);
  out.even = make;
  out.full = (n) => {
    const { first, rest } = out.maxStint;
    if (!(first >= 1) || !(rest >= 1) || !isFinite(rest)) return make(n);
    return build(Array.from({ length: n }, (_, k) => Math.min(first + k * rest, total - (n - k))));
  };
  out.maxStops = top;
  for (let n = 0; n <= top; n++) all.push(make(n));
  const first = all.findIndex((o) => o.ok);
  if (first < 0) {
    const at = Math.min(nMin, top);
    out.options = all.slice(Math.max(0, at - 1), at + 3);
    return out;
  }
  out.best = all.filter((o) => o.ok).reduce((a, b) => (b.timeS < a.timeS ? b : a));
  out.options = all.slice(Math.max(0, first - 1), Math.max(first + 3, out.best.n + 1));
  const n = out.best.n;
  if (n > 0 && n - 1 >= nMin && cap < Infinity) {
    const fmax = (cap - (i.formL || 0)) / (Math.ceil(total / n) + i.reserve);
    out.save = { fpl: fmax, pct: (1 - fmax / fpl) * 100, gainS: out.best.timeS - all[n - 1]!.timeS };
  }
  return out;
}
