import { useSyncExternalStore } from "react";
import { aux } from "../engine/versions";
import { lsGet, lsSet } from "../lib/storage";
import { BAD_KEYS, isObj } from "../lib/text";
import { DEFAULT_UNITS, UNITS, UnitChoice } from "../lib/units";

export const KPI_IDS = ["session", "left", "lap", "pos", "ahead", "behind", "last", "best", "delta", "fuel", "stint", "flag", "temps", "grip", "rain", "penalty", "stintTime", "boxIn"] as const;
export type KpiId = (typeof KPI_IDS)[number];
export const HZ = [5, 10, 15, 30, 60] as const;

export interface Prefs {
  units: UnitChoice;
  sound: boolean;
  hz: (typeof HZ)[number];
  kpi: KpiId[];
  kpiOn: boolean;
  lastWs: Record<string, string>;
}

// Time left is the top bar's clock; rain and temperatures are off so the default fits 1440 px.
export const DEFAULT_PREFS: Prefs = {
  units: DEFAULT_UNITS, sound: false, hz: 30,
  kpi: ["session", "lap", "pos", "ahead", "behind", "last", "best", "delta", "fuel", "boxIn", "stint", "flag"],
  kpiOn: true, lastWs: {},
};

export function cleanPrefs(raw: unknown): Prefs {
  const o = isObj(raw) ? raw : {};
  const p: Prefs = structuredClone(DEFAULT_PREFS);
  if (isObj(o.units)) for (const k of ["speed", "temp", "press"] as const) if (o.units[k] in UNITS[k]) (p.units as Record<string, string>)[k] = o.units[k];
  if (typeof o.sound === "boolean") p.sound = o.sound;
  if ((HZ as readonly number[]).includes(o.hz)) p.hz = o.hz;
  if (Array.isArray(o.kpi)) p.kpi = o.kpi.filter((k: unknown, i: number, a: unknown[]) => (KPI_IDS as readonly unknown[]).includes(k) && a.indexOf(k) === i);
  if (typeof o.kpiOn === "boolean") p.kpiOn = o.kpiOn;
  if (isObj(o.lastWs)) for (const [k, v] of Object.entries(o.lastWs)) if (!BAD_KEYS.has(k) && typeof v === "string") p.lastWs[k] = v.slice(0, 16);
  return p;
}

class PrefsStore {
  private p: Prefs = cleanPrefs(lsGet("pitwall.prefs", {}));
  private subs = new Set<() => void>();

  get = (): Prefs => this.p;

  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  };

  update(patch: Partial<Prefs>): void {
    const unitsChanged = !!patch.units;
    this.p = { ...this.p, ...patch };
    lsSet("pitwall.prefs", this.p);
    for (const fn of this.subs) fn();
    if (unitsChanged) aux.bump("units");
  }

  rememberWorkspace(templateId: string, wsId: string): void {
    if (this.p.lastWs[templateId] !== wsId) this.update({ lastWs: { ...this.p.lastWs, [templateId]: wsId } });
  }
}

export const prefs = new PrefsStore();
export const usePrefs = (): Prefs => useSyncExternalStore(prefs.subscribe, prefs.get);
