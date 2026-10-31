import { useSyncExternalStore } from "react";
import type { Stint } from "../lib/fuelplan";
import { lsDel, lsGet, lsSet } from "../lib/storage";

export interface RacePlan { total: number; fpl: number; tyres: boolean; stints: Stint[] }

const KEY = "pitwall.raceplan";
const valid = (p: unknown): p is RacePlan => {
  const r = p as RacePlan | null;
  return !!r && Number.isFinite(r.total) && Number.isFinite(r.fpl) && Array.isArray(r.stints) && r.stints.every((s) => Number.isFinite(s.from) && Number.isFinite(s.load));
};

let plan: RacePlan | null = (() => { const p = lsGet<unknown>(KEY, null); return valid(p) ? p : null; })();
const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());

export const racePlan = {
  get: () => plan,
  set(p: RacePlan) { plan = p; lsSet(KEY, p); emit(); },
  clear() { plan = null; lsDel(KEY); emit(); },
  subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
};

export const useRacePlan = (): RacePlan | null => useSyncExternalStore(racePlan.subscribe, racePlan.get);

/** The next stop after `done` stops: the lap to box on and the fuel to add. */
export function nextStop(p: RacePlan | null, done: number): { n: number; lap: number; add: number } | null {
  const t = p?.stints.filter((s) => s.add != null)[done];
  return t ? { n: done + 1, lap: t.from - 1, add: t.add! } : null;
}

/** Litres the plan expects in the tank at the start of `lap`; null outside the race. */
export function expectedFuel(p: RacePlan, lap: number | null): number | null {
  if (lap == null) return null;
  const s = p.stints.find((t) => lap >= t.from && lap <= t.to);
  return s ? Math.max(0, s.load - p.fpl * (lap - s.from)) : null;
}
