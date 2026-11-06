import { useSyncExternalStore } from "react";
import { lsGet, lsSet } from "../lib/storage";

export interface Team {
  names: string[];
  drivers: number;
  spd: number;
  first: number;
  maxStintMin: number | null;
}

const KEY = "pitwall.team";
const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);

export function clean(o: unknown): Team {
  const r = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const drivers = int(Array.isArray(r.names) ? r.names.length : r.drivers, 1, 10, 1);
  const raw = Array.isArray(r.names) ? r.names : [];
  const names = Array.from({ length: drivers }, (_, i) => (typeof raw[i] === "string" ? raw[i].replace(/[\u0000-\u001f<>]/g, "").slice(0, 20) : ""));
  const m = r.maxStintMin;
  return { names, drivers, spd: int(r.spd, 1, 10, 1), first: int(r.first, 0, drivers - 1, 0), maxStintMin: typeof m === "number" && m > 0 && m <= 1440 ? Math.round(m) : null };
}

// Before this module existed Fuel & stints kept drivers and stints per driver in pitwall.calc.
function load(): Team {
  const t = lsGet<unknown>(KEY, null);
  if (t) return clean(t);
  const o = lsGet<Record<string, unknown>>("pitwall.calc", {});
  const n = (k: string) => parseFloat(String(o?.[k] ?? "").replace(",", "."));
  return clean({ drivers: n("drivers"), spd: n("spd"), maxStintMin: n("maxStint") });
}

let cur = load();
const subs = new Set<() => void>();

export const team = {
  get: (): Team => cur,
  set(p: Partial<Team>): void {
    cur = clean({ ...cur, ...p });
    lsSet(KEY, cur);
    subs.forEach((fn) => fn());
  },
};

export const useTeam = (): Team => useSyncExternalStore((fn) => { subs.add(fn); return () => { subs.delete(fn); }; }, team.get);

export const nameOf = (t: Team, i: number): string => t.names[i] || `D${i + 1}`;

export const driverOf = (t: Team, stint: number): number => (Math.floor((stint - 1) / t.spd) + t.first) % t.drivers;

// Stop k ends stint k; the driver changes when the next stint belongs to someone else.
export const swapAt = (t: Team, stop: number): { from: number; to: number } | null => {
  const from = driverOf(t, stop), to = driverOf(t, stop + 1);
  return from === to ? null : { from, to };
};
