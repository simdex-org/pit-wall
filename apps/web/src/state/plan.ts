import { useSyncExternalStore } from "react";
import type { Ctx } from "../feed/store";
import type { Json } from "../feed/types";
import { isObj } from "../lib/text";
import { lsGet, lsRaw, lsSet } from "../lib/storage";
import { fv, unit, UnitChoice } from "../lib/units";

export const CORNERS = ["FL", "FR", "RL", "RR"];

export interface PitPlan {
  fuel: number;
  tyres: boolean;
  compound: "dry" | "wet";
  tyre_set: number;
  pressures: number[];
  brakes: boolean;
  front_pad: number;
  rear_pad: number;
  repair_suspension: boolean;
  repair_bodywork: boolean;
}

export const DEF_PLAN: PitPlan = {
  fuel: 0, tyres: false, compound: "dry", tyre_set: 1, pressures: [26.5, 26.5, 26.5, 26.5], brakes: false, front_pad: 1, rear_pad: 1,
  repair_suspension: true, repair_bodywork: true,
};

export type Block = "fuel" | "tyres" | "pressures" | "brakes" | "repairs";

type Row = { key: string; label: string; kind: "number" | "check" | "select" | "press"; min?: number; max?: number; step?: number; unit?: string; choices?: [string, string][] };
const PADS: [string, string][] = [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]];

export const GROUPS: { title: string; block: Block; rows: Row[] }[] = [
  { title: "Fuel", block: "fuel", rows: [{ key: "fuel", label: "Fuel to add", kind: "number", min: 0, max: 150, step: 1, unit: "L" }] },
  { title: "Tyres", block: "tyres", rows: [
    { key: "tyres", label: "Change tyres", kind: "check" },
    { key: "tyre_set", label: "Tyre set", kind: "number", min: 1, max: 50, step: 1 },
    { key: "compound", label: "Compound", kind: "select", choices: [["dry", "Dry"], ["wet", "Wet"]] },
  ] },
  { title: "Pressures", block: "pressures", rows: CORNERS.map((c, i) => ({ key: "p" + i, label: c, kind: "press" as const })) },
  { title: "Brakes", block: "brakes", rows: [
    { key: "brakes", label: "Change brakes", kind: "check" },
    { key: "front_pad", label: "Front pads", kind: "select", choices: PADS },
    { key: "rear_pad", label: "Rear pads", kind: "select", choices: PADS },
  ] },
  { title: "Repairs", block: "repairs", rows: [
    { key: "repair_suspension", label: "Repair suspension", kind: "check" },
    { key: "repair_bodywork", label: "Repair bodywork", kind: "check" },
  ] },
];

const ROWS = GROUPS.flatMap((g) => g.rows.map((r) => ({ ...r, block: g.block })));
export const LABEL: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r.key, r.label]));
export const BLOCK_OF: Record<string, Block> = Object.fromEntries(ROWS.map((r) => [r.key, r.block]));
export const RES: Record<string, string> = {
  fuel: "fuel", tyres: "tyres", compound: "compound", tyre_set: "tyre_set", p0: "fl", p1: "fr", p2: "rl", p3: "rr", brakes: "brakes",
  front_pad: "front_pad", rear_pad: "rear_pad", repair_suspension: "repairs", repair_bodywork: "repairs",
};
export const OK_RES = ["ok", "sent", "skipped", "switched on for the pressures", "sent (from page)", "sent (from car)"];
export const RES_TEXT: Record<string, [string, string]> = {
  "switched on for the pressures": ["on", "Tyre change switched on: ACC fits the pressures only with a tyre change"],
  "sent (from page)": ["sent", "ACC does not publish the pads: the start was what this page last sent"],
  "sent (from car)": ["sent", "ACC does not publish the pads: the start was the pads fitted on the car"],
  "sent (guessed 1)": ["guessed", "ACC does not publish the pads and the start was unknown, so pad 1 was assumed: check the MFD once"],
};

const KEYS: Record<Block, (keyof PitPlan)[]> = {
  fuel: ["fuel"], tyres: ["tyres", "compound", "tyre_set", "pressures"], pressures: ["pressures"], brakes: ["brakes", "front_pad", "rear_pad"], repairs: ["repair_suspension", "repair_bodywork"],
};

const isPress = (k: string) => /^p\d$/.test(k);
export const pv = (p: Partial<PitPlan>, k: string): unknown => (isPress(k) ? (p.pressures ?? [])[+k[1]!] : (p as Record<string, unknown>)[k]);

function cleanPressures(v: unknown): number[] {
  return Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === "number" && isFinite(x)) ? (v as number[]).slice() : DEF_PLAN.pressures.slice();
}

export function loadPlan(): PitPlan {
  const stored = lsGet<Record<string, unknown>>("pitwall.plan", {});
  const p = { ...DEF_PLAN, ...(isObj(stored) ? stored : {}) } as PitPlan;
  p.pressures = cleanPressures(p.pressures);
  return p;
}

class PlanStore {
  private plan = loadPlan();
  private subs = new Set<() => void>();
  private marked: ReadonlySet<string> = new Set();

  get = (): PitPlan => this.plan;
  flash = (): ReadonlySet<string> => this.marked;
  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };

  private emit() { this.subs.forEach((fn) => fn()); }

  set(p: PitPlan, flash: string[] = []): void {
    this.plan = { ...p, pressures: cleanPressures(p.pressures) };
    this.marked = new Set(flash);
    lsSet("pitwall.plan", this.plan);
    this.emit();
  }

  patch(patch: Partial<PitPlan>): void {
    const keys = Object.keys(patch).flatMap((k) => (k === "pressures" ? ["p0", "p1", "p2", "p3"] : [k]));
    this.set({ ...this.plan, ...patch }, keys);
  }

  seed(c: Ctx): boolean {
    if (lsRaw("pitwall.plan") != null) return false;
    const job = c.pitJob, p = c.pit;
    let q: PitPlan | null = null;
    if (p && p.status === "live") {
      q = { ...DEF_PLAN, fuel: Math.round(p.fuel), tyre_set: p.tyre_set || 1, pressures: Array.isArray(p.pressures) ? p.pressures.map((v: number) => +v.toFixed(1)) : DEF_PLAN.pressures.slice() };
    }
    if (job && isObj(job.plan)) {
      q = q ?? { ...DEF_PLAN };
      const blocks = (Array.isArray(job.only) ? job.only : Object.keys(KEYS)) as Block[];
      for (const g of blocks) for (const k of KEYS[g] ?? []) if (job.plan[k] !== undefined) (q as unknown as Record<string, unknown>)[k] = job.plan[k];
    }
    if (!q) return false;
    this.set(q);
    return true;
  }
}

export const planStore = new PlanStore();
export const usePlan = (): PitPlan => useSyncExternalStore(planStore.subscribe, planStore.get);
export const usePlanFlash = (): ReadonlySet<string> => useSyncExternalStore(planStore.subscribe, planStore.flash);


export function nowOf(pit: Json | null, k: string): number | null | undefined {
  if (!pit || pit.status !== "live") return undefined;
  if (k === "fuel") return pit.fuel;
  if (k === "tyre_set") return pit.tyre_set;
  if (isPress(k)) return pit.pressures ? pit.pressures[+k[1]!] : null;
  return null;
}

export function sentVal(pitLog: Json[], k: string): unknown {
  for (let i = pitLog.length - 1; i >= 0; i--) {
    const e = pitLog[i];
    if (!e || e.state !== "done" || !isObj(e.plan) || !e.res) continue;
    const r = e.res[RES[k]!];
    if (r == null || r === "skipped") continue;
    return OK_RES.includes(r) ? pv(e.plan as Partial<PitPlan>, k) : undefined;
  }
  return undefined;
}

export function repairNow(pitLog: Json[], k: string): boolean {
  const sv = sentVal(pitLog, k);
  if (typeof sv === "boolean") return sv;
  const mem = lsGet<boolean[] | null>("pitwall.repairs", null);
  return Array.isArray(mem) ? mem[k === "repair_bodywork" ? 1 : 0] === true : true;
}

export function show(k: string, v: unknown, units?: UnitChoice): string {
  if (v == null) return "–";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (isPress(k)) return fv("press", v as number, units);
  return k === "fuel" ? String(Math.round(v as number)) : String(v);
}

export function same(k: string, a: unknown, b: unknown): boolean {
  if (isPress(k)) return Math.abs((a as number) - (b as number)) < 0.05;
  if (k === "fuel") return Math.round(a as number) === Math.round(b as number);
  return a === b;
}

export interface ChangeRow { label: string; from?: string; to: string; unit: string }

export function changeRows(p: PitPlan, pit: Json | null, only: Block | undefined, pitLog: Json[], units?: UnitChoice): ChangeRow[] {
  const out: ChangeRow[] = [];
  for (const g of GROUPS) {
    if (only && only !== g.block) continue;
    for (const { key: k } of g.rows) {
      if (k === "tyre_set" && p.compound === "wet") continue;
      const v = pv(p, k), n = nowOf(pit, k);
      const unitText = isPress(k) ? unit("press", units).u : k === "fuel" ? "L" : "";
      if (n != null) {
        if (!same(k, n, v)) out.push({ label: LABEL[k]!, from: String(show(k, n, units)), to: String(show(k, v, units)), unit: unitText });
      } else {
        if (k.startsWith("repair_")) { if (v !== repairNow(pitLog, k)) out.push({ label: LABEL[k]!, to: String(show(k, v, units)), unit: "" }); continue; }
        const typed = v === true || (k === "compound" && (only || p.tyres)) || ((k === "front_pad" || k === "rear_pad") && p.brakes);
        const sv = sentVal(pitLog, k);
        if (typed && !(sv !== undefined && same(k, sv, v))) out.push({ label: LABEL[k]!, to: String(show(k, v, units)), unit: unitText });
      }
    }
  }
  return out;
}

export const changes = (p: PitPlan, pit: Json | null, only: Block | undefined, pitLog: Json[], units?: UnitChoice): string[] =>
  changeRows(p, pit, only, pitLog, units).map((r) => (r.from != null ? `${r.label} ${r.from} → ${r.to}` : `${r.label} → ${r.to}`) + (r.unit ? " " + r.unit : ""));

export interface RowResult { r: string; txt: string; cls: string; title: string }

export function resOf(job: Json | null, k: string, P: PitPlan, units?: UnitChoice): RowResult | null {
  if (!job || job.state !== "done" || !job.res) return null;
  const r = job.res[RES[k]!];
  if (r == null || r === "skipped") return null;
  const jv = isObj(job.plan) ? pv(job.plan as Partial<PitPlan>, k) : undefined;
  const mine = jv == null || same(k, jv, pv(P, k));
  if (!mine) return { r, txt: `sent ${show(k, jv, units)}${job.by ? " by " + job.by : ""}`, cls: "s-dim", title: "The last send typed a different value from this plan" };
  const t = RES_TEXT[r];
  return { r, txt: t ? t[0] : r === "ok" ? "✓ verified" : r === "sent" ? "sent" : "✗ " + r, cls: r === "ok" ? "s-ok" : OK_RES.includes(r) ? "" : "s-bad", title: t ? t[1] : "" };
}
