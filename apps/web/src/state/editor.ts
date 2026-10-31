// Edit mode and module options. The editor changes the tab's template in memory; every change is an undo step and a new
// template object, so the page re-renders. Save writes it to storage, Discard goes back to the snapshot taken on entry.
// Built-ins are never edited: the first real change forks them, and Discard drops that fork again.
import { useSyncExternalStore } from "react";
import { registry } from "../engine/registry";
import { cleanText, deep, newId } from "../lib/text";
import { lsGet, lsSet } from "../lib/storage";
import { ask } from "../shell/confirm";
import { say } from "./bridge";
import { BUILTIN_TEMPLATES } from "./builtins";
import { nav } from "./nav";
import { freeSpot, isBuiltin, ModuleInstance, sanitizeOptions, Template, templates, Workspace } from "./templates";

export interface EditState {
  active: boolean;
  sel: string | null;
  drawer: boolean;
  canUndo: boolean;
  canRedo: boolean;
  optId: string | null;
  /** Counts every change, so a view knows to read again. */
  ver: number;
}

const overlaps = (mods: ModuleInstance[], self: ModuleInstance, x: number, y: number, w: number, h: number) =>
  mods.some((o) => o !== self && x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h);

const uniqueModId = (t: Template, extra: ModuleInstance[] = []) => {
  const used = new Set([...t.workspaces.flatMap((w) => w.modules), ...extra].map((m) => m.id));
  let id: string;
  do id = newId("m-"); while (used.has(id));
  return id;
};
const uniqueWsId = (t: Template, base: string) => {
  const used = new Set(t.workspaces.map((w) => w.id));
  base = base.slice(0, 11);
  let id = base, k = 2;
  while (used.has(id)) id = `${base}-${k++}`;
  return id;
};

class Editor {
  private s: EditState = { active: false, sel: null, drawer: false, canUndo: false, canRedo: false, optId: null, ver: 0 };
  private subs = new Set<() => void>();
  private snap: Template | null = null;
  private undoStack: Template[] = [];
  private redoStack: Template[] = [];
  /** The id of the copy of a built-in made by this edit session. */
  private forked: string | null = null;

  get = (): EditState => this.s;
  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };

  private set(patch: Partial<EditState>): void {
    this.s = { ...this.s, ...patch, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, ver: this.s.ver + 1 };
    this.subs.forEach((fn) => fn());
  }

  get cur(): Template { return nav.get().tpl; }
  get ws(): Workspace { return nav.workspace(); }

  private changed(): boolean {
    if (!this.snap) return false;
    // A fork made by this session differs in id, name and dates only: compare its layout, so a no-op fork is no change.
    return this.forked ? JSON.stringify(this.cur.workspaces) !== JSON.stringify(this.snap.workspaces) : JSON.stringify(this.cur) !== JSON.stringify(this.snap);
  }

  /** The tab's template made user-owned: a built-in is forked once, with no dialog. */
  private own(): void {
    const t = this.cur;
    if (!isBuiltin(t.id)) return;
    // In edit mode the copy stays in memory until Save: a tab closed mid-edit leaves no copy behind.
    const f = templates.fork(t, `${t.name} (custom)`, this.s.active);
    if (this.s.active) this.forked = f.id; else lsSet("pitwall.active", f.id);
    nav.replace(f);
    say(`Built-ins are read-only: editing your copy '${f.name}'`);
  }

  toggle(): void { if (this.s.active) void this.save(); else this.enter(); }

  enter(): void {
    if (this.s.active) return;
    this.forked = null;
    this.snap = deep(this.cur);
    this.undoStack = []; this.redoStack = [];
    this.set({ active: true, sel: null });
  }

  private exit(): void {
    this.snap = null; this.forked = null; this.undoStack = []; this.redoStack = [];
    this.set({ active: false, sel: null, drawer: false });
  }

  async save(): Promise<boolean> {
    const t = this.cur, raw = lsGet<{ items?: Template[] } | null>("pitwall.templates", null);
    const stored = raw && Array.isArray(raw.items) ? raw.items.find((x) => x && x.id === t.id) : null;
    if (stored && this.snap && this.snap.id === t.id && stored.updated !== this.snap.updated
      && (await ask("This template was changed in another tab. Overwrite it?", [["ow", "Overwrite", true], ["", "Cancel"]])) !== "ow") return false;
    if (this.forked && !this.changed()) { this.discard(); return true; } // forked, then undone or a no-op: no identical copy
    if (this.changed()) { templates.save(t); lsSet("pitwall.active", t.id); say(`Saved '${t.name}'`); }
    this.exit();
    return true;
  }

  discard(): void {
    const had = this.changed(), snap = this.snap;
    if (!snap) { this.exit(); return; }
    let r: Template | null = null;
    if (this.forked) { // the built-in this session forked: drop the fork, back to the built-in
      templates.remove(this.forked);
      r = templates.get(snap.id) ?? templates.get("builtin-race");
      if (r) lsSet("pitwall.active", r.id);
    } else {
      const raw = lsGet<{ items?: Template[] } | null>("pitwall.templates", null);
      const stored = raw && Array.isArray(raw.items) ? raw.items.find((x) => x && x.id === snap.id) : null;
      if (stored && stored.updated !== snap.updated) { templates.load(); r = templates.get(snap.id); } // saved in another tab meanwhile: that version
      if (!r) {
        r = deep(snap);
        const i = templates.items.findIndex((x) => x.id === r!.id);
        if (i >= 0) templates.items[i] = r;
      }
    }
    const wsId = nav.get().wsId;
    nav.replace(r!, r!.workspaces.some((w) => w.id === wsId) ? wsId : r!.workspaces[0]!.id);
    if (had) say("Changes discarded");
    this.exit();
  }

  /** Esc, or switching template while editing. */
  async leave(): Promise<boolean> {
    if (!this.s.active) return true;
    if (this.changed() && (await ask("Discard changes?", [["d", "Discard", true], ["", "Keep editing"]])) !== "d") return false;
    this.discard();
    return true;
  }

  /** Every change: an undo snapshot, the change on a fresh copy, the tab re-rendered. */
  change(fn: (t: Template, w: Workspace) => boolean | void, sel?: string | null): boolean {
    this.own();
    const before = deep(this.cur);
    const next = deep(this.cur);
    const wsId = nav.get().wsId;
    if (fn(next, next.workspaces.find((w) => w.id === wsId) ?? next.workspaces[0]!) === false) return false;
    if (this.s.active) { this.undoStack.push(before); if (this.undoStack.length > 50) this.undoStack.shift(); this.redoStack = []; }
    this.commit(next);
    this.set(sel !== undefined ? { sel } : {});
    return true;
  }

  private commit(next: Template): void {
    const i = templates.items.findIndex((x) => x.id === next.id);
    if (i >= 0) templates.items[i] = next;
    const wsId = nav.get().wsId;
    nav.replace(next, next.workspaces.some((w) => w.id === wsId) ? wsId : next.workspaces[0]!.id);
  }

  step(dir: "undo" | "redo"): void {
    const from = dir === "undo" ? this.undoStack : this.redoStack, to = dir === "undo" ? this.redoStack : this.undoStack;
    const t = from.pop();
    if (!t) return;
    to.push(deep(this.cur));
    this.commit(t);
    this.set({});
  }

  // ---------- modules ----------
  find(id: string): ModuleInstance | undefined { return this.ws.modules.find((m) => m.id === id); }

  /** Refused when it would overlap or leave the grid. */
  move(id: string, x: number, y: number, w: number, h: number): boolean {
    const m = this.find(id);
    if (!m) return false;
    const def = registry.get(m.type), s = def ? def.size : { minW: 1, minH: 1 };
    if (x < 0 || y < 0 || y > 199 || w < s.minW || h < s.minH || x + w > 12 || h > 60) return false;
    if (overlaps(this.ws.modules, m, x, y, w, h)) return false;
    if (m.x === x && m.y === y && m.w === w && m.h === h) return false;
    return this.change((_, ws) => { Object.assign(ws.modules.find((q) => q.id === id)!, { x, y, w, h }); }, id);
  }

  canMove(id: string, x: number, y: number, w: number, h: number): boolean {
    const m = this.find(id);
    return !!m && !overlaps(this.ws.modules, m, x, y, w, h);
  }

  add(type: string): void {
    const def = registry.get(type), ws = this.ws;
    if (!def) return;
    if (def.multi === false && ws.modules.some((m) => m.type === type)) { say(`${def.title} is already in this workspace`, 1); return; }
    if (ws.modules.length >= 40) { say("A workspace holds at most 40 modules", 1); return; }
    const id = uniqueModId(this.cur), at = freeSpot(ws.modules, def.size.w, def.size.h);
    this.change((_, w) => { w.modules.push({ id, type, x: at.x, y: at.y, w: def.size.w, h: def.size.h, hidden: false, header: true, title: "", linked: false, options: sanitizeOptions(def, {}, () => {}) }); }, id);
  }

  dup(id: string): void {
    const m = this.find(id);
    if (!m) return;
    const def = registry.get(m.type);
    if (def && def.multi === false) { say(`${def.title} can be in a workspace only once`, 1); return; }
    const nid = uniqueModId(this.cur), at = freeSpot(this.ws.modules, m.w, m.h);
    this.change((_, w) => { w.modules.push({ ...deep(m), id: nid, x: at.x, y: at.y }); }, nid);
  }

  remove(id: string): void { this.change((_, w) => { const i = w.modules.findIndex((m) => m.id === id); if (i < 0) return false; w.modules.splice(i, 1); }, null); }
  hide(id: string): void { this.change((_, w) => { const m = w.modules.find((q) => q.id === id); if (!m) return false; m.hidden = !m.hidden; }, id); }
  select(id: string | null): void { this.set({ sel: id }); }
  setDrawer(open: boolean): void { this.set({ drawer: open }); }

  // ---------- workspaces ----------
  addWs(): void {
    if (this.cur.workspaces.length >= 9) return;
    const id = uniqueWsId(this.cur, "w-workspace");
    this.change((t) => { t.workspaces.push({ id, name: "Workspace", modules: [] }); });
    nav.showWorkspace(id);
  }

  rename(name: string): void {
    const n = cleanText(name, 20) || "Workspace";
    this.change((_, w) => { if (w.name === n) return false; w.name = n; });
  }

  async wsAction(act: "dup" | "left" | "right" | "del", wsId: string): Promise<void> {
    const t = this.cur, i = t.workspaces.findIndex((w) => w.id === wsId);
    if (i < 0) return;
    const w = t.workspaces[i]!;
    if (act === "dup") {
      if (t.workspaces.length >= 9) { say("A template holds at most 9 workspaces", 1); return; }
      const c = deep(w);
      c.id = uniqueWsId(t, w.id); c.name = `${w.name.slice(0, 13)} (copy)`;
      c.modules.forEach((m) => { m.id = uniqueModId(t, c.modules); });
      this.change((tt) => { tt.workspaces.splice(i + 1, 0, c); });
      nav.showWorkspace(c.id);
    } else if (act === "left" || act === "right") {
      const j = i + (act === "left" ? -1 : 1);
      if (j < 0 || j >= t.workspaces.length) return;
      this.change((tt) => { tt.workspaces.splice(j, 0, tt.workspaces.splice(i, 1)[0]!); });
    } else {
      if (t.workspaces.length < 2) { say("The last workspace cannot be deleted", 1); return; }
      if ((await ask(`Delete the workspace '${w.name}' and its ${w.modules.length} modules?`, [["del", "Delete", true], ["", "Cancel"]])) !== "del") return;
      const was = nav.get().wsId === wsId, nb = t.workspaces[i > 0 ? i - 1 : 1]!.id; // the neighbour, taken before the change
      this.change((tt) => { tt.workspaces.splice(tt.workspaces.findIndex((x) => x.id === wsId), 1); });
      if (was) nav.showWorkspace(nb);
    }
  }

  async resetWs(): Promise<void> {
    const cur = this.cur, bid = isBuiltin(cur.id) ? cur.id : cur.basedOn, ws = this.ws;
    const b = bid ? BUILTIN_TEMPLATES.find((x) => x.id === bid) : undefined, src = b?.workspaces.find((w) => w.id === ws.id);
    if ((await ask(src ? `Put '${ws.name}' back as in ${b!.name}?` : `Empty the workspace '${ws.name}'?`, [["r", src ? "Reset" : "Empty", true], ["", "Cancel"]])) !== "r") return;
    const base = src ? templates.builtins.find((x) => x.id === b!.id)?.workspaces.find((w) => w.id === ws.id) : null;
    this.change((t, w) => {
      w.modules = [];
      if (base) for (const m of base.modules) w.modules.push({ ...deep(m), id: uniqueModId(t, w.modules) });
    }, null);
  }

  // ---------- keyboard: the editor gets first refusal while active ----------
  key(e: KeyboardEvent): boolean {
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, tag = (e.target as HTMLElement).tagName;
    if (ctrl && (k === "s" || k === "S")) { e.preventDefault(); void this.save(); return true; }
    if (ctrl && !e.shiftKey && (k === "z" || k === "Z")) { e.preventDefault(); this.step("undo"); return true; }
    if (ctrl && (k === "y" || k === "Y" || (e.shiftKey && (k === "z" || k === "Z")))) { e.preventDefault(); this.step("redo"); return true; }
    if (k === "Escape") {
      e.preventDefault();
      if (this.s.drawer) { this.setDrawer(false); return true; }
      if (/^(input|textarea|select)$/i.test(tag)) { (e.target as HTMLElement).blur(); return true; }
      void this.leave();
      return true;
    }
    if (/^(input|textarea|select)$/i.test(tag) || ctrl || e.altKey) return false;
    const mods = this.ws.modules.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    if (k === "Tab" && mods.length) {
      e.preventDefault();
      const i = mods.findIndex((m) => m.id === this.s.sel), n = mods.length;
      this.select(mods[i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + n) % n]!.id);
      return true;
    }
    if (k === "e" || k === "E") { e.preventDefault(); void this.save(); return true; }
    const m = this.s.sel ? this.find(this.s.sel) : undefined;
    if (!m) return false;
    const arrows = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[k];
    if (arrows) {
      e.preventDefault();
      const [dx, dy] = arrows, r: [number, number, number, number] = e.shiftKey ? [m.x, m.y, m.w + dx, m.h + dy] : [m.x + dx, m.y + dy, m.w, m.h];
      if (!this.move(m.id, ...r)) say(!this.canMove(m.id, ...r) ? "Occupied: move the other module first" : e.shiftKey ? "That is this module's size limit" : "That is the edge of the grid", 1);
      return true;
    }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); this.remove(m.id); return true; }
    if (k === "d" || k === "D") { e.preventDefault(); this.dup(m.id); return true; }
    if (k === "h" || k === "H") { e.preventDefault(); this.hide(m.id); return true; }
    if (k === "o" || k === "O") { e.preventDefault(); this.openOptions(m.id); return true; }
    return false;
  }

  // ---------- module options ----------
  openOptions(id: string | null): void { this.set({ optId: id }); }

  modById(id: string | null): ModuleInstance | null {
    if (!id) return null;
    for (const w of this.cur.workspaces) { const m = w.modules.find((x) => x.id === id); if (m) return m; }
    return null;
  }

  /** An options change: with the editor an undoable change; otherwise saved at once (forking a built-in first). */
  setOpt(fn: (m: ModuleInstance, def: ReturnType<typeof registry.get>) => void): void {
    const id = this.s.optId;
    if (!id) return;
    if (this.s.active) { this.change((t) => { const m = t.workspaces.flatMap((w) => w.modules).find((x) => x.id === id); if (!m) return false; fn(m, registry.get(m.type)); }, id); return; }
    this.own();
    const next = deep(this.cur), m = next.workspaces.flatMap((w) => w.modules).find((x) => x.id === id);
    if (!m) return;
    fn(m, registry.get(m.type));
    templates.save(next);
    this.commit(next);
    this.set({});
  }
}

export const editor = new Editor();
export const useEditor = (): EditState => useSyncExternalStore(editor.subscribe, editor.get);
