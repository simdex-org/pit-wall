'use strict';
// Templates: named sets of workspaces (tabs) of module instances. Built-ins are read-only data here; the user's own
// live in localStorage (pitwall.templates). Tpl.sanitize() rebuilds any template from scratch, copying only known keys,
// and is used for imports, for stored templates on load, and to check the built-ins at boot.

// ---------- built-ins (§3.3): x, y, w, h on 12 columns; every layout fits 22 rows ----------
const BUILTIN_WS = {   // workspaces shared by several built-ins
  live: ['w-live', 'Live', [['track-map', 0, 0, 5, 14], ['standings', 5, 0, 4, 22, {around:5, cols:['gap', 'int', 'last', 'pits']}], ['relative', 9, 0, 3, 8], ['race-plan', 9, 8, 3, 14], ['tyres', 0, 14, 5, 8]]],
  timing: ['w-timing', 'Timing', [['standings', 0, 0, 7, 22], ['battle', 7, 0, 5, 6], ['laps', 7, 6, 5, 8, {who:'focus'}], ['sector-compare', 7, 14, 5, 8]]],   // click a car: its laps
  strategy: ['w-strategy', 'Strategy', [['stint-timeline', 0, 0, 12, 4], ['pit-plan', 0, 4, 6, 18], ['stop-options', 6, 4, 6, 7], ['race-plan', 6, 11, 3, 11], ['rejoin', 9, 11, 3, 7], ['rules', 9, 18, 3, 4]]],
  car: ['w-car', 'Car', [['tyres', 0, 0, 4, 11, {corrections:false}], ['brakes', 4, 0, 4, 6], ['press-fix', 4, 6, 4, 5], ['electronics', 8, 0, 4, 5], ['damage', 8, 5, 4, 6], ['tyre-history', 0, 11, 8, 11], ['weather', 8, 11, 4, 6], ['flags', 8, 17, 4, 5]]],
  laps: ['w-laps', 'Laps', [['laps', 0, 0, 8, 15], ['degradation', 0, 15, 8, 7], ['stops', 8, 0, 4, 7], ['debrief', 8, 7, 4, 15]]],
  analysis: ['w-analysis', 'Analysis', [['lap-picker', 0, 0, 3, 22], ['traces', 3, 0, 6, 22], ['track-map', 9, 0, 3, 12, {colourBy:'delta', field:false, follow:false}], ['segments', 9, 12, 3, 10]]],
  log: ['w-log', 'Log', [['event-log', 0, 0, 8, 22], ['notes', 8, 0, 4, 14], ['pit-log', 8, 14, 4, 8]]],
};
const BUILTIN_SRC = [
  ['builtin-race', 'Race engineer', ['live', 'timing', 'strategy', 'car', 'laps', 'analysis', 'log']],
  ['builtin-strategist', 'Strategist', [['w-overview', 'Overview', [['standings', 0, 0, 6, 14, {cols:['gap', 'int', 'last', 'best', 'pits', 'stint', 'net']}], ['pit-activity', 0, 14, 6, 8], ['track-map', 6, 0, 6, 9, {labels:'number'}],
    ['stop-options', 6, 9, 6, 6], ['battle', 6, 15, 3, 7], ['rejoin', 9, 15, 3, 7]]], 'timing', 'strategy', 'laps', 'log']],
  ['builtin-coach', 'Driver coach', [['w-live', 'Live', [['track-map', 0, 0, 7, 14], ['channels', 0, 14, 7, 8], ['lap-timer', 7, 0, 5, 4], ['car-status', 7, 4, 5, 6], ['tyres', 7, 10, 5, 7], ['gg', 7, 17, 5, 5]]],
    'laps', 'analysis', 'car', 'log']],
  ['builtin-minimal', 'Minimal', [['w-wall', 'Pit wall', [['track-map', 0, 0, 8, 22], ['relative', 8, 0, 4, 6], ['race-plan', 8, 6, 4, 9], ['tyres', 8, 15, 4, 7]]],
    ['w-pit', 'Pit', [['pit-plan', 0, 0, 8, 22], ['race-plan', 8, 0, 4, 11], ['press-fix', 8, 11, 4, 6]]]]],
];
const BUILTIN_TEMPLATES = BUILTIN_SRC.map(([id, name, wss]) => {
  let n = 0;   // deterministic module ids, so a fork keeps them and nothing remounts
  return {format:'pitwall-template', schemaVersion:1, id, name, created:'2026-10-29T00:00:00Z', updated:'2026-10-29T00:00:00Z',
    workspaces:wss.map(w => { const [wid, wname, mods] = typeof w === 'string' ? BUILTIN_WS[w] : w;
      return {id:wid, name:wname, modules:mods.map(([type, x, y, w_, h, options]) => ({id:'m-' + (++n).toString(36).padStart(6, '0'), type, x, y, w:w_, h, options:options || {}}))}; })};
});

// ---------- Tpl: storage, sanitising, the tab's active template ----------
const Tpl = {
  MIGRATE: {},                      // MIGRATE[n] = t => template of schema n+1; none yet (schema 1)
  SCHEMA: 1,
  builtins: [], items: [], cur: null,
  isBuiltin(id){ return /^builtin-/.test(id || ''); },
  newId(prefix){
    const n = prefix === 't-' ? 10 : 6, a = new Uint8Array(n); crypto.getRandomValues(a);
    return prefix + Array.from(a, b => '0123456789abcdefghijklmnopqrstuvwxyz'[b % 36]).join('');
  },
  load(){
    const raw = lsGet('pitwall.templates', null), items = raw && Array.isArray(raw.items) ? raw.items : [];
    this.items = items.map(t => { try { return this.sanitize(t, {keepUnknown:true}).t; } catch (e) { console.error('stored template dropped', e); return null; } })
      .filter((t, i, a) => t && !this.isBuiltin(t.id) && a.findIndex(x => x && x.id === t.id) === i);
  },
  persist(){ return lsSet('pitwall.templates', {schemaVersion:this.SCHEMA, items:this.items}); },
  list(){ return [...this.builtins, ...this.items]; },
  get(id){ return this.list().find(t => t.id === id) || null; },
  save(t){
    t.updated = new Date().toISOString();
    const i = this.items.findIndex(x => x.id === t.id);
    if (i >= 0) this.items[i] = t; else this.items.push(t);
    this.persist(); return t;
  },
  remove(id){ this.items = this.items.filter(t => t.id !== id); this.persist(); },
  active(){ return this.cur; },
  uniqueName(name, skipId){
    const taken = new Set(this.list().filter(t => t.id !== skipId).map(t => t.name));
    let n = name.slice(0, 40), k = 2; while (taken.has(n)) n = `${name.slice(0, 34)} (${k++})`;
    return n;
  },
  fork(t, name){   // a user-owned deep copy; built-ins are never edited in place
    const c = deep(t), now = new Date().toISOString();
    c.id = this.newId('t-'); c.name = this.uniqueName(name || `${t.name} (custom)`);
    c.basedOn = this.isBuiltin(t.id) ? t.id : t.basedOn; if (!c.basedOn) delete c.basedOn;
    c.created = c.updated = now; delete c.appearance;
    return this.save(c);
  },
  use(id, wsId){   // the tab's template: kept in the address bar so each tab keeps its own, and the default for new tabs
    const t = this.get(id) || this.get('builtin-race'); this.cur = t;
    lsSet('pitwall.active', t.id);
    Pit.emit('template', {t, wsId});
    return t;
  },
  sanitize(raw, o = {}){
    if (!isObj(raw)) throw new Error('Not a template.');
    let fixed = 0; const dropped = [];
    const fix = () => { fixed++; };
    const t = {format:'pitwall-template', schemaVersion:this.SCHEMA};
    t.id = typeof raw.id === 'string' && /^(t-[a-z0-9]{10}|builtin-[a-z0-9-]{1,20})$/.test(raw.id) ? raw.id : (fix(), this.newId('t-'));
    t.name = cleanText(raw.name, 40); if (t.name !== raw.name) fix(); if (!t.name) t.name = 'Untitled';
    if (raw.basedOn != null) { if (BUILTIN_TEMPLATES.some(b => b.id === raw.basedOn)) t.basedOn = raw.basedOn; else fix(); }
    const iso = v => typeof v === 'string' && v.length <= 40 && !isNaN(Date.parse(v)) ? v : new Date().toISOString();
    t.created = iso(raw.created); t.updated = iso(raw.updated);
    let wss = Array.isArray(raw.workspaces) ? raw.workspaces.filter(isObj) : (fix(), []);
    if (wss.length > 9) { wss = wss.slice(0, 9); fix(); }
    const wids = new Set(), mids = new Set();
    t.workspaces = wss.map(w => {
      const name = cleanText(w.name, 20) || 'Workspace'; if (name !== w.name) fix();
      let id = typeof w.id === 'string' && /^w-[a-z0-9-]{1,12}$/.test(w.id) ? w.id : (fix(), 'w-' + (slug(name).slice(0, 12).replace(/-+$/, '') || 'ws'));
      for (let k = 2, base = id.slice(0, 11); wids.has(id); k++) { id = `${base.slice(0, 13 - String(k).length)}-${k}`; fix(); }
      wids.add(id);
      let mods = Array.isArray(w.modules) ? w.modules.filter(isObj) : [];
      if (mods.length > 40) { mods = mods.slice(0, 40); fix(); }
      const out = [];
      for (const m of mods) {
        const def = Pit.registry.get(m.type);
        if (!def && !(o.keepUnknown && typeof m.type === 'string' && /^[a-z][a-z0-9-]{1,23}$/.test(m.type))) { dropped.push(String(m.type).slice(0, 24)); continue; }
        const r = this.sanitizeModule(m, def, mids, fix); mids.add(r.id); out.push(r);
      }
      resolveOverlaps(out, fix);
      return {id, name, modules:out};
    });
    if (!t.workspaces.length) { t.workspaces = [{id:'w-workspace', name:'Workspace', modules:[]}]; fix(); }
    if (o.keepAppearance && isObj(raw.appearance)) t.appearance = raw.appearance;   // checked by Appearance.sanitize before any use
    return {t, dropped, fixed};
  },
  sanitizeModule(m, def, mids, fix){
    const size = def ? def.size : {minW:1, minH:1};
    const int = (v, lo, hi, d) => { if (v === undefined) return d; const n = Number.isInteger(v) ? v : (fix(), Math.round(+v) || 0); const c = clamp(n, lo, hi); if (c !== n) fix(); return c; };
    let id = typeof m.id === 'string' && /^m-[a-z0-9]{6}$/.test(m.id) ? m.id : (fix(), this.newId('m-'));
    while (mids.has(id)) { id = this.newId('m-'); fix(); }
    const r = {id, type:m.type};
    r.x = int(m.x, 0, 11, 0); r.y = int(m.y, 0, 199, 0);
    r.w = int(m.w, Math.min(size.minW, 12 - r.x), 12 - r.x, def ? def.size.w : 4); r.h = int(m.h, size.minH, 60, def ? def.size.h : 6);
    r.hidden = m.hidden === undefined ? false : m.hidden === true; if (m.hidden !== undefined && typeof m.hidden !== 'boolean') fix();
    r.header = m.header === undefined ? true : m.header !== false; if (m.header !== undefined && typeof m.header !== 'boolean') fix();
    r.title = cleanText(m.title, 40); if (m.title !== undefined && r.title !== m.title) fix();
    r.linked = def && !def.linkable ? false : m.linked !== false;
    r.options = def ? sanitizeOptions(def, m.options, fix) : looseOptions(m.options);
    return r;
  },
};
function sanitizeOptions(def, raw, fix){
  const o = {}; raw = isObj(raw) ? raw : {};
  for (const op of def.options) {
    if (BAD_KEYS.has(op.key)) continue;
    const has = Object.prototype.hasOwnProperty.call(raw, op.key), v = raw[op.key];
    if (!has) { o[op.key] = deep(op.def); continue; }
    const vals = (op.choices || []).map(c => Array.isArray(c) ? c[0] : c);
    let r;
    if (op.type === 'select') r = vals.includes(v) ? v : undefined;
    else if (op.type === 'number') {
      if (typeof v === 'number' && isFinite(v)) { const st = op.step || 1, lo = op.min != null ? op.min : -Infinity, hi = op.max != null ? op.max : Infinity;
        r = clamp(v, lo, hi); r = +(Math.round((r - (isFinite(lo) ? lo : 0)) / st) * st + (isFinite(lo) ? lo : 0)).toFixed(6); if (r !== v) fix(); }
    }
    else if (op.type === 'toggle') r = typeof v === 'boolean' ? v : undefined;
    else if (op.type === 'multi') { if (Array.isArray(v)) { r = v.filter((x, i, a) => vals.includes(x) && a.indexOf(x) === i); if (r.length !== v.length) fix(); } }
    else if (op.type === 'text') { if (typeof v === 'string') { r = cleanText(v, 40); if (r !== v.trim()) fix(); } }
    if (r === undefined) { fix(); r = deep(op.def); }
    o[op.key] = r;
  }
  return o;
}
function looseOptions(raw){   // a type this version does not know: keep plain values so nothing is lost if it comes back
  const o = {};
  if (isObj(raw)) for (const [k, v] of Object.entries(raw).slice(0, 30)) {
    if (BAD_KEYS.has(k) || !/^[a-zA-Z][a-zA-Z0-9]{0,23}$/.test(k)) continue;
    if (['number', 'boolean'].includes(typeof v) || typeof v === 'string') o[k] = typeof v === 'string' ? cleanText(v, 40) : v;
    else if (Array.isArray(v)) o[k] = v.filter(x => typeof x === 'string').slice(0, 30).map(x => cleanText(x, 24));
  }
  return o;
}
// Overlaps: a later module moves down to the first free row (in input order). No gravity otherwise.
function occupied(mods, skip){
  const g = new Set();
  for (const m of mods) if (m !== skip) for (let y = m.y; y < m.y + m.h; y++) for (let x = m.x; x < m.x + m.w; x++) g.add(y * 12 + x);
  return g;
}
const fits = (g, x, y, w, h) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (g.has(yy * 12 + xx)) return false; return true; };
function resolveOverlaps(mods, fix){
  const placed = [];
  for (const m of mods) {
    const g = occupied(placed);
    if (!fits(g, m.x, m.y, m.w, m.h)) { let y = m.y; while (!fits(g, m.x, y, m.w, m.h)) y++; m.y = y; fix(); }
    placed.push(m);
  }
}
// First free spot of a size, scanning y then x; below everything when the grid is full above row 200.
function freeSpot(mods, w, h){
  const g = occupied(mods);
  for (let y = 0; y + h <= 200; y++) for (let x = 0; x + w <= 12; x++) if (fits(g, x, y, w, h)) return {x, y};
  return {x:0, y:mods.reduce((a, m) => Math.max(a, m.y + m.h), 0)};
}

// Built-ins are normalised (defaults filled) once every module type has registered: called by main.js at boot.
function checkBuiltins(){
  Tpl.builtins = BUILTIN_TEMPLATES.map(b => {
    const strict = Tpl.sanitize(b);
    if (strict.fixed || strict.dropped.length) console.error(`Built-in template '${b.name}': ${strict.fixed} fixes, ${strict.dropped.length} unknown module types`, [...new Set(strict.dropped)]);
    return Object.freeze(Tpl.sanitize(b, {keepUnknown:true}).t);
  });
}
