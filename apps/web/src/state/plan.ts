// The pit plan draft. It lives in this browser; the bridge types it into the driver's MFD when it is sent.
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
  flip_suspension: boolean;
  flip_bodywork: boolean;
}

/** Only the fallback while nothing is stored and the MFD is not live. */
export const DEF_PLAN: PitPlan = {
  fuel: 0, tyres: false, compound: "dry", tyre_set: 1, pressures: [26.5, 26.5, 26.5, 26.5], brakes: false, front_pad: 1, rear_pad: 1,
  flip_suspension: false, flip_bodywork: false,
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
    { key: "flip_suspension", label: "Suspension (switch)", kind: "check" },
    { key: "flip_bodywork", label: "Bodywork (switch)", kind: "check" },
  ] },
];

const ROWS = GROUPS.flatMap((g) => g.rows.map((r) => ({ ...r, block: g.block })));
export const LABEL: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r.key, r.label]));
export const BLOCK_OF: Record<string, Block> = Object.fromEntries(ROWS.map((r) => [r.key, r.block]));
/** The key of each row in the bridge's result for a send. */
export const RES: Record<string, string> = {
  fuel: "fuel", tyres: "tyres", compound: "compound", tyre_set: "tyre_set", p0: "fl", p1: "fr", p2: "rl", p3: "rr", brakes: "brakes",
  front_pad: "front_pad", rear_pad: "rear_pad", flip_suspension: "flip_suspension", flip_bodywork: "flip_bodywork",
};
/** Results of a send that are not failures. */
export const OK_RES = ["ok", "sent", "skipped", "switched on for the pressures"];
export const RES_TEXT: Record<string, [string, string]> = { "switched on for the pressures": ["on", "Tyre change switched on: ACC fits the pressures only with a tyre change"] };

/** The plan keys each block sends. A block send fills the others with the bridge's placeholders, which are not a plan. */
const KEYS: Record<Block, (keyof PitPlan)[]> = {
  fuel: ["fuel"], tyres: ["tyres", "compound", "tyre_set", "pressures"], pressures: ["pressures"], brakes: ["brakes", "front_pad", "rear_pad"], repairs: [],
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
  /** Rows a "put in pit plan" just changed, marked until the next edit. */
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

  /** From race-plan, press-fix and the fuel calculator. */
  patch(patch: Partial<PitPlan>): void {
    const keys = Object.keys(patch).flatMap((k) => (k === "pressures" ? ["p0", "p1", "p2", "p3"] : [k]));
    this.set({ ...this.plan, ...patch }, keys);
  }

  /** No stored plan: the MFD as it is now, with the blocks the last send typed on top. True when seeded. */
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

// ---------- reading the MFD and the last send ----------

/** What ACC publishes of the MFD (live only); null = not published, undefined = no live MFD. */
export function nowOf(pit: Json | null, k: string): number | null | undefined {
  if (!pit || pit.status !== "live") return undefined;
  if (k === "fuel") return pit.fuel;
  if (k === "tyre_set") return pit.tyre_set;
  if (isPress(k)) return pit.pressures ? pit.pressures[+k[1]!] : null;
  return null;
}

/**
 * A field ACC does not publish: the value the latest send that typed it put in (undefined when none did or it failed), so a
 * switch that was sent and not changed since is no change, also after later sends of other blocks.
 */
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

/** What a send would change, as text: "Fuel 42 → 58 L". */
export function changes(p: PitPlan, pit: Json | null, only: Block | undefined, pitLog: Json[], units?: UnitChoice): string[] {
  const out: string[] = [];
  for (const g of GROUPS) {
    if (only && only !== g.block) continue;
    for (const { key: k } of g.rows) {
      if (k === "tyre_set" && p.compound === "wet") continue; // wet tyres have no sets in ACC: never typed
      const v = pv(p, k), n = nowOf(pit, k);
      const u = isPress(k) ? " " + unit("press", units).u : k === "fuel" ? " L" : "";
      if (n != null) {
        if (!same(k, n, v)) out.push(`${LABEL[k]} ${show(k, n, units)} → ${show(k, v, units)}${u}`);
      } else {
        const typed = v === true || (["compound", "front_pad", "rear_pad"].includes(k) && (only || p[k === "compound" ? "tyres" : "brakes"]));
        const sv = sentVal(pitLog, k);
        if (typed && !(sv !== undefined && same(k, sv, v))) out.push(`${LABEL[k]} → ${show(k, v, units)}`);
      }
    }
  }
  return out;
}

export interface RowResult { r: string; txt: string; cls: string; title: string }

/** What the last job did to row k; null when it did not touch it. */
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
