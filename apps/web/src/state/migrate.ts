// Carries over what the first page version kept in this browser (engineer.*), once.
import { registry } from "../engine/registry";
import type { Ctx } from "../feed/store";
import { clamp } from "../lib/format";
import { lsDel, lsGet, lsRaw, lsSet } from "../lib/storage";
import { deep, isObj, newId } from "../lib/text";
import { UNITS } from "../lib/units";
import { DEFAULT_THRESHOLDS } from "../lib/states";
import { accessKey, post, say } from "./bridge";
import { appearance, BUILTIN_THEMES, HEX } from "./appearance";
import { BUILTIN_TEMPLATES } from "./builtins";
import { prefs } from "./prefs";
import { freeSpot, ModuleInstance, sanitize, SCHEMA } from "./templates";

const OLD_TH_DEF = { psiMin: 26.0, psiMax: 27.0, tMin: 65, tMax: 105, brakeMax: 750, padMin: 12, fuelLaps: 3 };

/** The old page's boards and their closest modules. */
const MAP: Record<string, string> = {
  timeline: "fuel-calc", fuel: "fuel", window: "race-plan", gaps: "battle", weather: "weather", tyres: "tyres", degradation: "degradation", brakes: "brakes",
  pitstop: "pit-plan", electronics: "electronics", damage: "damage",
};

function migrateBoard(board: unknown[], rows: string[] | null): void {
  const race = BUILTIN_TEMPLATES.find((b) => b.id === "builtin-race")!, t = deep(race);
  const mods: ModuleInstance[] = [];
  const add = (type: string, w: number, h: number, hidden: boolean) => {
    const def = registry.get(type), s = def ? def.size : { minW: 1, minH: 1, w: 4, h: 6 };
    w = clamp(Math.round(+w) || s.w, s.minW, 12);
    h = clamp(Math.max(s.minH, Math.round((h * 82 - 10 + 8) / 36)), 1, 60); // 72 px rows + 10 px gap became 28 px rows + 8 px gap
    const at = freeSpot(mods, w, h);
    const used = new Set(mods.map((m) => m.id));
    let id: string;
    do id = newId("m-"); while (used.has(id));
    mods.push({ id, type, x: at.x, y: at.y, w, h, hidden, header: true, title: "", linked: false, options: {} });
  };
  for (const r of board) if (Array.isArray(r) && MAP[r[0]]) add(MAP[r[0]]!, r[1], +r[2] || 4, r[3] === false);
  if (!mods.some((m) => m.type === "pit-plan")) add("pit-plan", 7, 8, false);
  t.workspaces.find((w) => w.id === "w-strategy")!.modules = mods;
  if (rows) for (const w of t.workspaces) for (const m of w.modules) if (m.type === "channels") m.options.rows = rows;
  Object.assign(t, { id: newId("t-"), name: "My layout (migrated)", basedOn: "builtin-race", created: new Date().toISOString() });
  const s = sanitize(t, { keepUnknown: true }).t;
  const st = lsGet<{ items?: unknown[] } | null>("pitwall.templates", null), items = st && Array.isArray(st.items) ? st.items : [];
  items.push({ ...s, updated: new Date().toISOString() });
  lsSet("pitwall.templates", { schemaVersion: SCHEMA, items });
  lsSet("pitwall.active", s.id);
}

function migrateTheme(theme: unknown, accent: unknown): void {
  if (lsRaw("pitwall.appearance") != null) return;
  const base = BUILTIN_THEMES.find((b) => b.id === ({ broadcast: "broadcast", endurance: "night" } as Record<string, string>)[String(theme)]) ?? BUILTIN_THEMES[0]!;
  if (typeof accent === "string" && HEX.test(accent)) {
    const t = { ...deep(base), id: "th-" + newId("t-").slice(2, 8), name: `${base.name} (custom)`, base: base.id, tokens: { accent: accent.toLowerCase() } };
    const st = lsGet<{ items?: unknown[] } | null>("pitwall.themes", null), items = st && Array.isArray(st.items) ? st.items : [];
    items.push(t);
    lsSet("pitwall.themes", { items });
    lsSet("pitwall.appearance", t);
  } else lsSet("pitwall.appearance", base);
}

/** Runs once, before the templates load: the old key, units, notes, pit plan, board and theme. */
export function migrate(): void {
  const k = lsRaw("engineer.pitkey");
  if (k && !lsRaw("pitwall.pitkey") && !lsRaw("pitwall.migrated")) { lsSet("pitwall.pitkey", k); accessKey.value = accessKey.value || k; }
  if (lsRaw("pitwall.migrated") || lsRaw("engineer.settings") == null) { if (k) lsSet("pitwall.migrated", "1"); return; }
  const S = lsGet<Record<string, any> | null>("engineer.settings", null); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (isObj(S)) {
    const units = { ...prefs.get().units };
    for (const key of ["speed", "temp", "press"] as const) if (UNITS[key][S[key] as keyof (typeof UNITS)[typeof key]]) (units as Record<string, string>)[key] = S[key];
    prefs.update({ units, ...(typeof S.sound === "boolean" ? { sound: S.sound } : {}) });
    if (typeof S.notes === "string" && S.notes && lsRaw("pitwall.notes") == null) lsSet("pitwall.notes", S.notes);
    if (isObj(S.pit) && lsRaw("pitwall.plan") == null) lsSet("pitwall.plan", S.pit);
    if (Array.isArray(S.board)) migrateBoard(S.board, Array.isArray(S.rows) ? S.rows.filter((x: unknown): x is string => typeof x === "string") : null);
    migrateTheme(S.theme, S.accent);
    const old: Record<string, number> = {};
    let diff = false;
    for (const [key, d] of Object.entries(OLD_TH_DEF)) {
      const v = S[key];
      old[key] = typeof v === "number" && isFinite(v) ? v : d;
      if (old[key] !== d) diff = true;
    }
    if (diff) lsSet("pitwall.oldThresholds", old);
  }
  lsSet("pitwall.migrated", "1");
}

export type OldThresholds = typeof OLD_TH_DEF;
export const oldThresholds = (): OldThresholds | null => { const o = lsGet<unknown>("pitwall.oldThresholds", null); return isObj(o) ? (o as OldThresholds) : null; };

/** Send the old thresholds to the bridge as GT3's, or forget them. Nothing is sent unasked. */
export async function resolveOldThresholds(send: boolean, c: Ctx): Promise<boolean> {
  const o = oldThresholds();
  if (send && o) {
    if (!accessKey.value) { say("Sending thresholds needs the access key: Settings › Connection", 1); return false; }
    const cold = c.th?.brake_c ?? DEFAULT_THRESHOLDS.brake_c;
    const r = await post("/config", {
      thresholds: { GT3: { dry_psi: [o.psiMin, o.psiMax], tyre_c: [o.tMin, o.tMax], brake_c: { front: [cold.front[0], o.brakeMax], rear: [cold.rear[0], o.brakeMax] }, pad_low_mm: o.padMin } },
      fuel_low_laps: o.fuelLaps,
    });
    if (!r.ok) { say(r.status === 403 ? "Wrong or missing access key" : `The bridge refused the thresholds: ${r.text.slice(0, 80)}`, 1); return false; }
    say("Thresholds sent to the bridge for GT3");
  }
  lsDel("pitwall.oldThresholds");
  return true;
}

void appearance;
