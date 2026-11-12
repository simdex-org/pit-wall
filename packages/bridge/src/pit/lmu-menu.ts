import { Rec } from "../util.js";
import { Mfd, MfdSnapshot } from "./mfd.js";
import { CORNERS, Plan } from "./plan.js";

// Le Mans Ultimate's pit menu is read and written whole through the game's own REST API (the same calls CrewChief and
// Simulator Controller use): GET receivePitMenu gives the rows, POST loadPitMenu takes them back with new choices.
export interface MenuRow { name: string; currentSetting: number; settings: { text: string; type?: string; isUsed?: boolean }[] }

const BASE = "http://localhost:6397/rest/garage/PitMenu/";
const PRESS = CORNERS.map((c) => `${c.toUpperCase()} PRESS:`);
const TIRE = CORNERS.map((c) => `${c.toUpperCase()} TIRE:`);
const NOT_HERE = "not in Le Mans Ultimate";

const row = (menu: MenuRow[], name: string): MenuRow | undefined => menu.find((r) => r.name === name);
const num = (text: string): number | null => { const m = /-?\d+(?:[.,]\d+)?/.exec(text); return m ? Number(m[0].replace(",", ".")) : null; };
const litres = (text: string): number | null => {
  const m = /(\d+(?:[.,]\d+)?)\s*(l|gal)\b/i.exec(text);
  return m ? Number(m[1]!.replace(",", ".")) * (m[2]!.toLowerCase() === "gal" ? 3.785411 : 1) : null;
};
const psi = (text: string): number | null => { const n = num(text); return n === null ? null : n > 50 ? n / 6.894757 : n; };
const closest = (r: MenuRow, value: (t: string) => number | null, want: number): number => {
  let best = r.currentSetting, gap = Infinity;
  r.settings.forEach((s, k) => { const v = value(s.text); if (v !== null && Math.abs(v - want) < gap) { gap = Math.abs(v - want); best = k; } });
  return best;
};

// litres in the car after the stop, as the menu is set now
export function menuFuel(menu: MenuRow[]): number | null {
  const ve = row(menu, "VIRTUAL ENERGY:"), ratio = row(menu, "FUEL RATIO:");
  const r = ratio && num(ratio.settings[ratio.currentSetting]?.text ?? "");
  if (ve && r) return (num(ve.settings[ve.currentSetting]?.text ?? "") ?? ve.currentSetting) * r;
  const f = row(menu, "FUEL:");
  return f ? litres(f.settings[f.currentSetting]?.text ?? "") : null;
}

export function menuSnapshot(menu: MenuRow[], car: Rec): Pick<MfdSnapshot, "fuel" | "pressures"> {
  const after = menuFuel(menu);
  return {
    fuel: after === null ? 0 : Math.max(0, after - (car.fuel ?? 0)),
    pressures: PRESS.map((n, k) => { const r = row(menu, n); return (r && psi(r.settings[r.currentSetting]?.text ?? "")) ?? car.pressure?.[k] ?? 0; }),
  };
}

// The rows set to the plan, and what each part of it came to. The menu is copied, never changed in place.
export function planMenu(menu0: MenuRow[], plan: Plan, car: Rec): { menu: MenuRow[]; res: Record<string, string> } {
  const menu: MenuRow[] = JSON.parse(JSON.stringify(menu0));
  const res: Record<string, string> = {};
  const only = new Set<string>(plan.only);
  const set = (name: string, k: number) => { const r = row(menu, name); if (r && k >= 0 && k < r.settings.length) r.currentSetting = k; return !!r; };

  if (only.has("fuel")) {
    const want = (car.fuel ?? 0) + plan.fuel;
    const ve = row(menu, "VIRTUAL ENERGY:"), ratio = row(menu, "FUEL RATIO:"), f = row(menu, "FUEL:");
    const r = ratio && num(ratio.settings[ratio.currentSetting]?.text ?? "");
    if (ve && r) {
      const pct = (t: string) => num(t);
      ve.currentSetting = ve.settings.some((s) => pct(s.text) !== null) ? closest(ve, pct, want / r) : Math.min(ve.settings.length - 1, Math.round(want / r));
      res.fuel = `ok (virtual energy ${ve.settings[ve.currentSetting]?.text ?? ve.currentSetting})`;
    } else if (f) {
      const opts = f.settings.map((s, k) => [k, litres(s.text)] as const).filter((o): o is readonly [number, number] => o[1] !== null);
      const enough = opts.filter((o) => o[1] >= want - 0.5);
      const pick = enough.length ? enough.reduce((a, o) => (o[1] < a[1] ? o : a)) : opts.length ? opts.reduce((a, o) => (o[1] > a[1] ? o : a)) : null;
      if (pick) f.currentSetting = pick[0];
      res.fuel = !pick ? "the fuel row has no litres in it" : enough.length ? "ok" : "tank full";
    } else res.fuel = "no fuel row in the pit menu";
  }

  const tyres = row(menu, "TIRES:");
  if (only.has("tyres")) {
    if (!tyres) res.tyres = "no tyre row in the pit menu";
    else if (!plan.tyres) { set("TIRES:", 0); TIRE.forEach((n) => set(n, 0)); res.tyres = "sent"; }
    else {
      const now = String(car.compound ?? "").toLowerCase();
      const fits = (s: MenuRow["settings"][number], k: number) => k > 0 && !s.isUsed && !/invalid/i.test(s.text) && (plan.compound === "wet" ? s.type === "Wet" : s.type !== "Wet");
      const pick = (r: MenuRow) => {
        const ok = r.settings.map((s, k) => (fits(s, k) ? k : -1)).filter((k) => k > 0);
        return ok.find((k) => now && (r.settings[k]!.type ?? "").toLowerCase() === now) ?? ok[0] ?? -1;
      };
      const k = pick(tyres);
      if (k < 0) res.compound = `no new ${plan.compound} tyres in the pit menu`;
      else {
        set("TIRES:", k);
        const type = tyres.settings[k]!.type;
        TIRE.forEach((n) => { const r = row(menu, n); if (r) set(n, r.settings.findIndex((s, j) => j > 0 && !s.isUsed && s.type === type)); });
        res.compound = "ok"; res.tyres = "sent";
      }
      res.tyre_set = NOT_HERE;
    }
  }

  if (only.has("pressures") || (only.has("tyres") && plan.tyres)) {
    CORNERS.forEach((c, k) => { const r = row(menu, PRESS[k]!); if (r) r.currentSetting = closest(r, psi, plan.pressures[k]!); res[c] = r ? "ok" : "no pressure row in the pit menu"; });
  }

  if (only.has("brakes")) {
    res.brakes = set("REPLACE BRAKES:", plan.brakes ? 1 : 0) ? "ok" : "no brake row in the pit menu";
    if (plan.brakes) res.front_pad = res.rear_pad = NOT_HERE;
  }

  if (only.has("repairs")) {
    const d = row(menu, "DAMAGE:");
    if (!d || d.settings.length < 2) res.repairs = "nothing to repair";
    else { d.currentSetting = plan.repair_suspension ? d.settings.length - 1 : plan.repair_bodywork ? 1 : 0; res.repairs = "sent"; }
  }
  return { menu, res };
}

async function rest(path: string, body?: unknown): Promise<unknown> {
  const r = await fetch(BASE + path, {
    method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(3000),
    headers: { "Content-Type": "application/json", Accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Le Mans Ultimate answered ${r.status} on ${path}`);
  const text = await r.text();
  return text.trim() ? JSON.parse(text) : null;
}

const isMenu = (v: unknown): v is MenuRow[] =>
  Array.isArray(v) && v.every((r) => r && typeof r.name === "string" && Number.isInteger(r.currentSetting) && Array.isArray(r.settings));

export class LmuPit implements Mfd {
  private menu: MenuRow[] | null = null;
  private at = 0;
  private timer: NodeJS.Timeout;

  constructor(private car: () => Rec | null) {
    this.timer = setInterval(() => { if (this.live()) void this.fetch().catch(() => {}); }, 2000);
    this.timer.unref();
  }

  private live(): boolean { const s = this.car()?.status; return s === 2 || s === 3; }

  private async fetch(): Promise<MenuRow[]> {
    let m: unknown;
    try { m = await rest("receivePitMenu"); } catch (e) {
      throw new Error(`Le Mans Ultimate's REST API on port 6397 is not answering (${(e as Error).message})`);
    }
    if (!isMenu(m)) throw new Error("Le Mans Ultimate sent a pit menu Pit Wall does not understand");
    this.menu = m; this.at = Date.now();
    return m;
  }

  read(): MfdSnapshot {
    const car = this.car() ?? {};
    const fresh = !!this.menu && Date.now() - this.at < 6000 && this.live();
    return { status: fresh ? "live" : "off", ...(this.menu ? menuSnapshot(this.menu, car) : { fuel: 0, pressures: car.pressure ?? [0, 0, 0, 0] }),
      tyre_set: 1, current_set: 1, strategy_set: 1, in_pit_lane: !!car.pit_lane };
  }

  // no keys: the menu is set through the REST API, and there is no page to open or close
  press(): void {}

  async apply(plan: Plan): Promise<Record<string, string>> {
    if (!this.live()) throw new Error("Le Mans Ultimate is not in a live session on the driver's PC");
    const before = await this.fetch();
    const { menu, res } = planMenu(before, plan, this.car()!);
    await rest("loadPitMenu", menu);
    await new Promise((r) => setTimeout(r, 400));
    const back = await this.fetch();
    const missed = menu.filter((r, k) => r.currentSetting !== before[k]!.currentSetting && row(back, r.name)?.currentSetting !== r.currentSetting)
      .map((r) => r.name.replace(/:$/, "").toLowerCase());
    if (missed.length) res.check = `the game kept its own value for ${missed.join(", ")}`;
    return res;
  }

  close(): void { clearInterval(this.timer); }
}
