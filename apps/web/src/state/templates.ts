// Templates: named sets of workspaces (tabs) of module instances. Built-ins are read-only data; the user's own live in
// localStorage. sanitize() rebuilds any template from scratch, copying only known keys; it is used for imports, for stored
// templates on load and to check the built-ins at start.
import { registry } from "../engine/registry";
import type { ModuleDef, OptionDef } from "../engine/types";
import { clamp } from "../lib/format";
import { lsGet, lsSet } from "../lib/storage";
import { BAD_KEYS, cleanText, deep, isObj, newId, slug } from "../lib/text";
import { BUILTIN_TEMPLATES } from "./builtins";

export interface ModuleInstance {
  id: string; type: string; x: number; y: number; w: number; h: number;
  hidden: boolean; header: boolean; title: string; linked: boolean;
  options: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
export interface Workspace { id: string; name: string; modules: ModuleInstance[] }
export interface Template {
  format: "pitwall-template"; schemaVersion: number; id: string; name: string; basedOn?: string; created: string; updated: string;
  workspaces: Workspace[]; appearance?: unknown;
}

export const SCHEMA = 1;
export const isBuiltin = (id: string | null | undefined): boolean => /^builtin-/.test(id ?? "");

// ---------- overlaps ----------
const occupied = (mods: ModuleInstance[], skip?: ModuleInstance): Set<number> => {
  const g = new Set<number>();
  for (const m of mods) if (m !== skip) for (let y = m.y; y < m.y + m.h; y++) for (let x = m.x; x < m.x + m.w; x++) g.add(y * 12 + x);
  return g;
};
const fits = (g: Set<number>, x: number, y: number, w: number, h: number): boolean => {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (g.has(yy * 12 + xx)) return false;
  return true;
};

/** A later module moves down to the first free row, in input order. No gravity otherwise. */
export function resolveOverlaps(mods: ModuleInstance[], fix: () => void): void {
  const placed: ModuleInstance[] = [];
  for (const m of mods) {
    const g = occupied(placed);
    if (!fits(g, m.x, m.y, m.w, m.h)) {
      let y = m.y;
      while (!fits(g, m.x, y, m.w, m.h)) y++;
      m.y = y;
      fix();
    }
    placed.push(m);
  }
}

/** First free spot of a size, scanning y then x; below everything when the grid is full above row 200. */
export function freeSpot(mods: ModuleInstance[], w: number, h: number): { x: number; y: number } {
  const g = occupied(mods);
  for (let y = 0; y + h <= 200; y++) for (let x = 0; x + w <= 12; x++) if (fits(g, x, y, w, h)) return { x, y };
  return { x: 0, y: mods.reduce((a, m) => Math.max(a, m.y + m.h), 0) };
}

// ---------- sanitising ----------
export function sanitizeOptions(def: ModuleDef, raw: unknown, fix: () => void): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const o: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  const src: Record<string, any> = isObj(raw) ? raw : {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const op of def.options as OptionDef[]) {
    if (BAD_KEYS.has(op.key)) continue;
    if (!Object.prototype.hasOwnProperty.call(src, op.key)) { o[op.key] = deep(op.def); continue; }
    const v = src[op.key];
    const vals = (op.choices ?? []).map((c) => (Array.isArray(c) ? c[0] : c));
    let r: unknown;
    if (op.type === "select") r = vals.includes(v) ? v : undefined;
    else if (op.type === "number") {
      if (typeof v === "number" && Number.isFinite(v)) {
        const st = op.step ?? 1, lo = op.min ?? -Infinity, hi = op.max ?? Infinity;
        let n = clamp(v, lo, hi);
        n = +(Math.round((n - (Number.isFinite(lo) ? lo : 0)) / st) * st + (Number.isFinite(lo) ? lo : 0)).toFixed(6);
        if (n !== v) fix();
        r = n;
      }
    } else if (op.type === "toggle") r = typeof v === "boolean" ? v : undefined;
    else if (op.type === "multi") {
      if (Array.isArray(v)) {
        const list = v.filter((x, i, a) => vals.includes(x) && a.indexOf(x) === i);
        if (list.length !== v.length) fix();
        r = list;
      }
    } else if (op.type === "text") {
      if (typeof v === "string") { const t = cleanText(v, 40); if (t !== v.trim()) fix(); r = t; }
    }
    if (r === undefined) { fix(); r = deep(op.def); }
    o[op.key] = r;
  }
  return o;
}

/** A type this version does not know: plain values are kept, so nothing is lost if it comes back. */
function looseOptions(raw: unknown): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const o: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw).slice(0, 30)) {
      if (BAD_KEYS.has(k) || !/^[a-zA-Z][a-zA-Z0-9]{0,23}$/.test(k)) continue;
      if (typeof v === "number" || typeof v === "boolean") o[k] = v;
      else if (typeof v === "string") o[k] = cleanText(v, 40);
      else if (Array.isArray(v)) o[k] = v.filter((x) => typeof x === "string").slice(0, 30).map((x) => cleanText(x, 24));
    }
  }
  return o;
}

function sanitizeModule(m: Record<string, any>, def: ModuleDef | undefined, mids: Set<string>, fix: () => void): ModuleInstance { // eslint-disable-line @typescript-eslint/no-explicit-any
  const size = def ? def.size : { w: 4, h: 6, minW: 1, minH: 1 };
  const int = (v: unknown, lo: number, hi: number, d: number): number => {
    if (v === undefined) return d;
    const n = Number.isInteger(v) ? (v as number) : (fix(), Math.round(+(v as number)) || 0);
    const c = clamp(n, lo, hi);
    if (c !== n) fix();
    return c;
  };
  let id = typeof m.id === "string" && /^m-[a-z0-9]{6}$/.test(m.id) ? m.id : (fix(), newId("m-"));
  while (mids.has(id)) { id = newId("m-"); fix(); }
  const x0 = int(m.x, 0, 11, 0);
  const minW = Math.min(size.minW, 12);
  let x = x0;
  if (x + minW > 12) { x = 12 - minW; fix(); } // too far right for its minimum width: moved left, not squeezed
  const w = Math.min(int(m.w, minW, 12 - x, size.w), 12 - x);
  const title = cleanText(m.title, 40);
  if (m.title !== undefined && title !== m.title) fix();
  if (m.hidden !== undefined && typeof m.hidden !== "boolean") fix();
  if (m.header !== undefined && typeof m.header !== "boolean") fix();
  return {
    id, type: m.type, x, y: int(m.y, 0, 199, 0), w, h: int(m.h, size.minH, 60, size.h),
    hidden: m.hidden === true, header: m.header !== false, title, linked: false,
    options: def ? sanitizeOptions(def, m.options, fix) : looseOptions(m.options),
  };
}

export interface Sanitized { t: Template; dropped: string[]; fixed: number }

export function sanitize(raw: unknown, o: { keepUnknown?: boolean; keepAppearance?: boolean } = {}): Sanitized {
  if (!isObj(raw)) throw new Error("Not a template.");
  let fixed = 0;
  const dropped: string[] = [];
  const fix = () => { fixed++; };
  const id = typeof raw.id === "string" && /^(t-[a-z0-9]{10}|builtin-[a-z0-9-]{1,20})$/.test(raw.id) ? raw.id : (fix(), newId("t-"));
  let name = cleanText(raw.name, 40);
  if (name !== raw.name) fix();
  if (!name) name = "Untitled";
  const t: Template = { format: "pitwall-template", schemaVersion: SCHEMA, id, name, created: "", updated: "", workspaces: [] };
  if (raw.basedOn != null) { if (BUILTIN_TEMPLATES.some((b) => b.id === raw.basedOn)) t.basedOn = raw.basedOn; else fix(); }
  const iso = (v: unknown) => (typeof v === "string" && v.length <= 40 && !isNaN(Date.parse(v)) ? v : new Date().toISOString());
  t.created = iso(raw.created);
  t.updated = iso(raw.updated);
  let wss: Record<string, any>[] = Array.isArray(raw.workspaces) ? raw.workspaces.filter(isObj) : (fix(), []); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (wss.length > 9) { wss = wss.slice(0, 9); fix(); }
  const wids = new Set<string>(), mids = new Set<string>();
  t.workspaces = wss.map((w) => {
    const wname = cleanText(w.name, 20) || "Workspace";
    if (wname !== w.name) fix();
    let wid: string = typeof w.id === "string" && /^w-[a-z0-9-]{1,12}$/.test(w.id) ? w.id : (fix(), "w-" + (slug(wname).slice(0, 12).replace(/-+$/, "") || "ws"));
    for (let k = 2, base = wid.slice(0, 11); wids.has(wid); k++) { wid = `${base.slice(0, 13 - String(k).length)}-${k}`; fix(); }
    wids.add(wid);
    let mods: Record<string, any>[] = Array.isArray(w.modules) ? w.modules.filter(isObj) : []; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (mods.length > 40) { mods = mods.slice(0, 40); fix(); }
    const out: ModuleInstance[] = [];
    for (const m of mods) {
      const def = registry.get(m.type);
      if (!def && !(o.keepUnknown && typeof m.type === "string" && /^[a-z][a-z0-9-]{1,23}$/.test(m.type))) { dropped.push(String(m.type).slice(0, 24)); continue; }
      if (def && def.multi === false && out.some((x) => x.type === m.type)) { fix(); continue; } // once per workspace (notes, pit plan share state)
      const r = sanitizeModule(m, def, mids, fix);
      mids.add(r.id);
      out.push(r);
    }
    resolveOverlaps(out, fix);
    return { id: wid, name: wname, modules: out };
  });
  if (!t.workspaces.length) { t.workspaces = [{ id: "w-workspace", name: "Workspace", modules: [] }]; fix(); }
  if (o.keepAppearance && isObj(raw.appearance)) t.appearance = raw.appearance; // checked by the appearance sanitiser before any use
  return { t, dropped, fixed };
}

// ---------- storage ----------
export class TemplateStore {
  builtins: Template[] = [];
  items: Template[] = [];

  /** Built-ins are normalised (defaults filled) once every module type has registered. */
  init(): void {
    this.builtins = BUILTIN_TEMPLATES.map((b) => {
      const strict = sanitize(b);
      if (strict.fixed || strict.dropped.length) console.error(`Built-in template '${b.name}': ${strict.fixed} fixes, ${strict.dropped.length} unknown module types`, [...new Set(strict.dropped)]);
      return sanitize(b, { keepUnknown: true }).t;
    });
    this.load();
  }

  load(): void {
    const raw = lsGet<{ items?: unknown[] } | null>("pitwall.templates", null);
    const items = raw && Array.isArray(raw.items) ? raw.items : [];
    this.items = items
      .map((t) => { try { return sanitize(t, { keepUnknown: true, keepAppearance: true }).t; } catch (e) { console.error("stored template dropped", e); return null; } })
      .filter((t, i, a): t is Template => !!t && !isBuiltin(t.id) && a.findIndex((x) => x && x.id === t.id) === i);
  }

  persist(): boolean { return lsSet("pitwall.templates", { schemaVersion: SCHEMA, items: this.items }); }
  list(): Template[] { return [...this.builtins, ...this.items]; }
  get(id: string | null | undefined): Template | null { return this.list().find((t) => t.id === id) ?? null; }

  save(t: Template): Template {
    t.updated = new Date().toISOString();
    const i = this.items.findIndex((x) => x.id === t.id);
    if (i >= 0) this.items[i] = t; else this.items.push(t);
    this.persist();
    return t;
  }

  remove(id: string): void { this.items = this.items.filter((t) => t.id !== id); this.persist(); }

  uniqueName(name: string, skipId?: string): string {
    const taken = new Set(this.list().filter((t) => t.id !== skipId).map((t) => t.name));
    let n = name.slice(0, 40), k = 2;
    while (taken.has(n)) n = `${name.slice(0, 34)} (${k++})`;
    return n;
  }

  /** A user-owned deep copy; built-ins are never edited in place. `mem` lists it without storing it until it is saved. */
  fork(t: Template, name?: string, mem?: boolean): Template {
    const c = deep(t), now = new Date().toISOString();
    c.id = newId("t-");
    c.name = this.uniqueName(name || `${t.name} (custom)`);
    c.basedOn = isBuiltin(t.id) ? t.id : t.basedOn;
    if (!c.basedOn) delete c.basedOn;
    c.created = c.updated = now;
    delete c.appearance;
    if (mem) { this.items.push(c); return c; }
    return this.save(c);
  }
}

export const templates = new TemplateStore();
