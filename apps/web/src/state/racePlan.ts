// The race plan: the stint plan picked in Fuel & stints, kept in this browser. Fuel to the flag, the pit plan and the planner itself read it.
import { useSyncExternalStore } from "react";
import type { Stint } from "../lib/fuelplan";
import { lsDel, lsGet, lsSet } from "../lib/storage";
import { isObj } from "../lib/text";

export interface RacePlan { total: number; fpl: number; tyres: boolean; stints: Stint[] }

const KEY = "pitwall.raceplan";
const num = (v: unknown) => typeof v === "number" && isFinite(v);

function clean(v: unknown): RacePlan | null {
  if (!isObj(v) || !num(v.total) || !num(v.fpl) || !Array.isArray(v.stints) || !v.stints.length) return null;
  const stints: Stint[] = [];
  for (const s of v.stints) {
    if (!isObj(s) || !num(s.n) || !num(s.laps) || !num(s.from) || !num(s.to) || !num(s.load) || !num(s.stat) || !(s.add == null || num(s.add))) return null;
    stints.push({ n: s.n as number, laps: s.laps as number, from: s.from as number, to: s.to as number, load: s.load as number, add: (s.add as number | null) ?? null, stat: s.stat as number });
  }
  return { total: v.total as number, fpl: v.fpl as number, tyres: v.tyres === true, stints };
}

let cur = clean(lsGet<unknown>(KEY, null));
const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());

export const racePlan = {
  get: (): RacePlan | null => cur,
  set(p: RacePlan): void { cur = p; lsSet(KEY, p); emit(); },
  clear(): void { cur = null; lsDel(KEY); emit(); },
};

export const useRacePlan = (): RacePlan | null => useSyncExternalStore((fn) => { subs.add(fn); return () => { subs.delete(fn); }; }, racePlan.get);

/** The next stop at or after this lap: the lap to box on and the litres to add. */
export function nextStop(p: RacePlan | null, lap: number | null): { lap: number; add: number; n: number } | null {
  if (!p || lap == null) return null;
  const s = p.stints.find((t) => t.add != null && t.from - 1 >= lap);
  return s ? { lap: s.from - 1, add: s.add!, n: s.n - 1 } : null;
}

/** Fuel the plan expects in the tank at the start of this lap. */
export function expectedFuel(p: { fpl: number; stints: Stint[] }, lap: number | null): number | null {
  if (lap == null) return null;
  const s = p.stints.find((t) => lap >= t.from && lap <= t.to);
  return s ? s.load - (lap - s.from) * p.fpl : null;
}
