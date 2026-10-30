'use strict';
// The core every module talks to (Pit), the module registry, and the workspace grid (WS): mounting a workspace of a
// template into #ws, keeping instances across remounts, and the render scheduler that calls each module only when a
// channel it needs changed, never faster than its rate. Modules register with Pit.module() at load (mod-*.js).

// ---------- preferences (this browser) ----------
const KPI_IDS = ['session', 'left', 'lap', 'pos', 'ahead', 'behind', 'last', 'best', 'delta', 'fuel', 'stint', 'flag', 'temps', 'grip', 'rain', 'penalty', 'stintTime', 'boxIn'];
const DEF_PREFS = {units:{speed:'kmh', temp:'c', press:'psi'}, sound:false, hz:30,
  kpi:['session', 'lap', 'pos', 'ahead', 'behind', 'last', 'best', 'delta', 'fuel', 'boxIn', 'stint', 'flag'], kpiOn:true, lastWs:{}};   // time left: the topbar clock; rain, temps: off so the default fits 1440 px
function loadPrefs(){
  const o = lsGet('pitwall.prefs', {}) || {}, p = deep(DEF_PREFS);
  if (isObj(o.units)) for (const k of ['speed', 'temp', 'press']) if (UNITS[k][o.units[k]]) p.units[k] = o.units[k];
  if (typeof o.sound === 'boolean') p.sound = o.sound;
  if ([5, 10, 15, 30, 60].includes(o.hz)) p.hz = o.hz;
  if (Array.isArray(o.kpi)) p.kpi = o.kpi.filter((k, i, a) => KPI_IDS.includes(k) && a.indexOf(k) === i);
  if (typeof o.kpiOn === 'boolean') p.kpiOn = o.kpiOn;
  if (isObj(o.lastWs)) for (const [k, v] of Object.entries(o.lastWs)) if (!BAD_KEYS.has(k) && typeof v === 'string') p.lastWs[k] = v.slice(0, 16);
  return p;
}

// ---------- Pit: the API modules may use (§7.2) ----------
const DIRTY = new Set();
const LISTENERS = new Map();
const PAGE_LOG = [];               // page-local log lines (src 'page'), merged into ctx.log by main.js
const Pit = {
  ctx: null, prefs: loadPrefs(), key: '', focus: 'self', registry: new Map(), _say: null,
  savePrefs(){ lsSet('pitwall.prefs', this.prefs); },
  module(def){
    if (!def || !/^[a-z][a-z0-9-]{1,23}$/.test(def.type || '')) return console.error('Pit.module: bad type', def && def.type);
    if (this.registry.has(def.type)) return console.error('Pit.module: duplicate type', def.type);
    const d = Object.assign({multi:true, linkable:false, needs:[], requires:[], rate:10, options:[], tools:[], group:'Other', blurb:''}, def);
    d.size = Object.assign({w:4, h:6, minW:2, minH:2}, def.size);
    this.registry.set(d.type, d);
  },
  on(evt, fn){ if (!LISTENERS.has(evt)) LISTENERS.set(evt, []); LISTENERS.get(evt).push(fn); },
  emit(evt, data){ for (const fn of LISTENERS.get(evt) || []) try { fn(data); } catch (e) { console.error('Pit.emit', evt, e); } },
  dirty(ch){ DIRTY.add(ch); WS.schedule(); },
  setFocus(v){
    v = v === 'self' || v == null ? 'self' : +v; if (v !== 'self' && !isFinite(v)) return;
    if (Pit.ctx && v !== 'self' && v === Pit.ctx.me) v = 'self';
    this.focus = v; if (this.ctx) { this.ctx.focus = v; this.ctx.focusCar = focusCar(this.ctx); }
    this.dirty('focus'); this.emit('focus', v);
  },
  select(which, lapId){ if (!this.ctx || !['ref', 'cmp'].includes(which)) return; this.ctx.sel[which] = lapId == null ? null : lapId; this.dirty('sel'); this.emit('select', this.ctx.sel); },
  setCursor(f){ if (!this.ctx) return; this.ctx.sel.cursor = f == null || !isFinite(f) ? null : clamp(+f, 0, 1); this.dirty('sel'); this.emit('cursor', this.ctx.sel.cursor); },
  async post(path, body){
    try {
      const r = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json', 'X-Pit-Key':this.key}, body:JSON.stringify(body)});
      return {ok:r.ok, status:r.status, text:await r.text()};
    } catch (e) { return {ok:false, status:0, text:'The bridge is not answering.'}; }
  },
  async get(path){
    try { const r = await fetch(path); if (!r.ok) return null; return numbersOnly(await r.json()); } catch (e) { return null; }
  },
  log(sev, cat, text){
    const c = this.ctx, lap = c && c.r ? c.r.session.lap_number : 0;   // the lap in progress, as the bridge stamps its lines
    PAGE_LOG.unshift({seq:-PAGE_LOG.length - 1, t:Date.now() / 1000, lap, sev:clamp(sev | 0, 0, 2), cat:String(cat).slice(0, 8), text:String(text), src:'page'});
    if (PAGE_LOG.length > 200) PAGE_LOG.pop();
    this.dirty('log');
  },
  say(text, sev){ this._say = {text:String(text), sev:sev | 0, until:performance.now() + 6000}; this.dirty('say'); },
  tokens(){ return TOKENS.cache || (TOKENS.cache = TOKENS.read()); },
  carName(car, form){
    if (!car) return '';
    const ds = car.drivers || [], d = ds[car.drv | 0] || ds[0];
    if (!d) return car.num != null ? '#' + car.num : '';
    const first = d.first || '', last = d.last || '';
    return form === 'full' ? `${first} ${last}`.trim() : form === 'last' ? last || first : form === 'code' ? d.short || last.slice(0, 3).toUpperCase()
      : (first ? first[0] + '. ' : '') + last;
  },
};
function focusCar(c){ if (!c || !c.cars) return null; const i = c.focus === 'self' ? c.me : c.focus; return i == null ? null : c.cars.get(i) || null; }

// ---------- tokens for canvases: resolved through a probe so color-mix() and theme overrides resolve too ----------
const TOKEN_VARS = {bg:'--bg', panel:'--panel', raise:'--raise', line:'--line', line2:'--line2', text:'--txt', muted:'--mut', dim:'--dim', accent:'--acc',
  me:'--me', best:'--best', pb:'--pb', slow:'--slow', invalid:'--inv', ok:'--ok', warn:'--warn', bad:'--bad', cold:'--cold',
  chSpeed:'--c-speed', chThr:'--c-thr', chBrk:'--c-brk', chSteer:'--c-steer', chGear:'--c-gear', chRpm:'--c-rpm', chRef:'--c-ref', chCmp:'--c-cmp',
  chLap:'--c-lap', chFL:'--c-fl', chFR:'--c-fr', chRL:'--c-rl', chRR:'--c-rr', accSoft:'--acc-soft', badSoft:'--bad-soft', warnSoft:'--warn-soft'};
const TOKENS = {
  cache: null,
  read(){
    let p = $('tokProbe');
    if (!p) { p = document.createElement('span'); p.id = 'tokProbe'; p.hidden = true; document.body.appendChild(p); }
    const o = {};
    for (const [k, v] of Object.entries(TOKEN_VARS)) { p.style.color = ''; p.style.color = `var(${v})`; o[k] = getComputedStyle(p).color; }
    const bs = getComputedStyle(document.body);
    o.font = bs.fontFamily; o.num = css('--num') || '"JetBrains Mono", monospace';
    return o;
  },
};
Pit.on('theme', () => { TOKENS.cache = null; });

// ---------- module instances ----------
const NA_MSG = {
  field: "Field timing needs ACC's broadcasting port. On the driver's PC run  python server/acc_broadcast.py --enable  and restart ACC.",
  reading: 'Waiting for the driver.', summary: 'Waiting for the bridge summary.', pit: 'No pit control on this bridge.',
};
const NARROW_AUTO = new Set(['pit-plan', 'standings', 'stop-options', 'laps', 'stops', 'pit-log', 'pit-activity', 'tyre-history',
  'race-plan', 'rejoin', 'rules', 'brakes', 'weather', 'damage', 'electronics', 'flags', 'press-fix', 'battle', 'relative', 'car-status']);   // not tyres: its drawing fills the module's height
const NARROW_MIN_ROWS = {tyres:11};   // narrow: the fewest rows a fixed-height module gets, whatever its template height
// narrow: the stacking order (DOM order, so Tab and screen readers follow it), what the engineer needs first on a phone; the rest 10, in reading order
const NARROW_ORDER = {'race-plan':1, 'relative':2, 'lap-timer':2, 'tyres':3, 'press-fix':4, 'rejoin':5, 'stop-options':6, 'battle':7, 'standings':8, 'fuel-calc':9, 'pit-plan':20};
const STALE_MS = {reading:['r', 1500], summary:['s', 3000], field:['field', 2000]};
const ALERTS = new Map();          // instance id -> [level, count], for the workspace tab badges

function optsFor(def, raw){   // the stored options over the declared defaults (Tpl.sanitize has already checked them)
  const o = {};
  for (const op of def ? def.options : []) o[op.key] = raw && raw[op.key] !== undefined ? deep(raw[op.key]) : deep(op.def);
  return Object.freeze(o);
}
function frameHtml(m, def, editing){
  const id = esc(m.id), title = esc(m.title || (def ? def.title : m.type));
  const tools = def ? def.tools.map(t => `<button type="button" class="btn icon" data-tool="${esc(t.id)}" title="${esc(t.label)}" aria-label="${esc(t.label)}"><i data-lucide="${esc(t.icon)}"></i></button>`).join('') : '';
  const opt = def ? '<button type="button" class="btn icon" data-act="opts" title="Options (O)" aria-label="Module options"><i data-lucide="sliders-horizontal"></i></button>' : '';
  return `<header class="mh"><h2 class="mt" id="${id}-t">${title}</h2><span class="mi"></span><span class="mtag" hidden></span><span class="malert" hidden></span><span class="mhid" hidden>hidden</span>
    <span class="mtools">${tools}${opt}</span>
    <span class="medit"><button type="button" class="btn icon" data-act="drag" title="Drag to move (arrows)" aria-label="Move"><i data-lucide="grip-vertical"></i></button><button type="button" class="btn icon" data-act="opts" title="Options (O)" aria-label="Options"><i data-lucide="sliders-horizontal"></i></button><button type="button" class="btn icon" data-act="dup" title="Duplicate (D)" aria-label="Duplicate"><i data-lucide="copy"></i></button><button type="button" class="btn icon" data-act="hide" title="${m.hidden ? 'Show' : 'Hide'} (H)" aria-label="${m.hidden ? 'Show' : 'Hide'}"><i data-lucide="${m.hidden ? 'eye' : 'eye-off'}"></i></button><button type="button" class="btn icon" data-act="remove" title="Remove (Delete)" aria-label="Remove"><i data-lucide="x"></i></button></span>
  </header><div class="mb"></div><div class="mstate" hidden></div><span class="mgrip" data-act="resize" aria-hidden="true"></span>`;
}
function makeInst(m, def, editing){
  const el = document.createElement('section');
  el.className = 'mod'; el.dataset.state = 'ok'; el.id = m.id; el.dataset.type = m.type; el.tabIndex = -1; el.setAttribute('aria-labelledby', m.id + '-t');
  el.innerHTML = frameHtml(m, def, editing);
  el.querySelector('.mb').addEventListener('scroll', () => moreMark(inst), {passive:true});
  const inst = {
    id:m.id, type:m.type, def, el, body:el.querySelector('.mb'), opts:optsFor(def, m.options), linked:!!m.linked, state:{}, visible:true, m,
    _key:JSON.stringify(m.options || {}), _last:0, _pending:true, _st:null, _stSet:false, _gated:false,
    setInfo(t){ const e = el.querySelector('.mi'); t = t == null ? '' : String(t); if (e.textContent !== t) e.textContent = t; },
    setState(kind, msg, action){ inst._stSet = true; applyState(inst, kind, msg, action); },
    setAlert(level, count){
      const v = [clamp(level | 0, 0, 2), count == null ? (level ? 1 : 0) : count | 0], o = ALERTS.get(inst.id);
      if (!o || o[0] !== v[0] || o[1] !== v[1]) { ALERTS.set(inst.id, v); WS.alertsDirty = true; WS.schedule(); }
      const a = el.querySelector('.malert'), t = v[0] >= 2 ? '■ CRIT' : v[0] ? '▲ WARN' : '';   // the tab badge's module, located: word in the header, bar at the left
      if (a.textContent !== t) { a.textContent = t; a.hidden = !t; a.className = 'malert' + (v[0] >= 2 ? ' s-bad' : v[0] ? ' s-warn' : ''); if (t) el.dataset.alert = v[0] >= 2 ? 'bad' : 'warn'; else delete el.dataset.alert; }
    },
  };
  return inst;
}
function applyState(inst, kind, msg, action){
  const k = kind === 'ok' ? null : `${kind}|${msg}|${action ? action.label : ''}`;
  if (k === inst._st) return; inst._st = k;
  const box = inst.el.querySelector('.mstate');
  inst.body.hidden = !!k; box.hidden = !k; inst.el.dataset.state = kind;
  if (!k) { box.innerHTML = ''; return; }
  box.innerHTML = `<i data-lucide="${kind === 'na' ? 'unplug' : 'inbox'}"></i><p>${esc(msg || '')}</p>${action ? `<button type="button" class="linkbtn">${esc(action.label)}</button>` : ''}`;
  if (action) box.querySelector('button').addEventListener('click', action.fn);
  refreshIcons(box);
}
function gate(inst, c){   // the `requires` channels: missing ones show the na state and skip render
  for (const r of inst.def.requires) {
    if (r === 'field' ? !(c.bc && c.bc.state === 'live' && c.field) : r === 'reading' ? !c.r : r === 'summary' ? !c.s : r === 'pit' ? !c.pit : c[r] == null) {
      if (r === 'field' && c.bc && c.bc.state === 'off' && c.bc.msg) return c.bc.msg;   // off on purpose or by setup: the bridge's own words say why and what to do
      return (NA_MSG[r] || `Needs ${r}.`) + (r === 'field' && c.bc && c.bc.msg ? ' ' + c.bc.msg : '');
    }
  }
  return null;
}
function staleness(inst, c){
  let worst = 0;
  for (const n of inst.def.needs) { const s = STALE_MS[n]; if (!s || !c.ages) continue; const a = c.ages[s[0]]; if (a != null && a > s[1]) worst = Math.max(worst, a); }
  return worst;
}

// ---------- WS: mount a workspace, place modules, run the render loop ----------
const WS = {
  insts: [], tpl: null, wsId: null, editing: false, narrow: false, raf: 0, timer: 0, alertsDirty: false, hooks: [],
  instances(){ return this.insts; },
  workspace(){ return this.tpl && (this.tpl.workspaces.find(w => w.id === this.wsId) || this.tpl.workspaces[0]); },
  mount(tpl, wsId, editing){
    const host = $('ws');
    this.tpl = tpl; const ws = tpl.workspaces.find(w => w.id === wsId) || tpl.workspaces[0]; this.wsId = ws.id; this.editing = !!editing;
    host.dataset.ws = ws.id; host.classList.toggle('editing', this.editing);
    const fa = document.activeElement;   // re-appending blurs it: given back below (keyboard move/resize keeps its place)
    const keep = new Map(this.insts.map(i => [i.id, i])), next = [];
    const mods = ws.modules.slice().sort((a, b) => a.y - b.y || a.x - b.x);   // DOM order = reading order; place() restacks it when narrow
    for (const m of mods) {
      const def = Pit.registry.get(m.type) || null;
      let inst = keep.get(m.id);
      if (inst && inst.type === m.type) {
        keep.delete(m.id);
        const key = JSON.stringify(m.options || {});
        if (key !== inst._key) { destroy(inst); inst.body.innerHTML = ''; inst.opts = optsFor(def, m.options); inst._key = key; inst.state = {}; inst._built = false; }
        inst.m = m; inst.linked = !!m.linked;
        const t = inst.el.querySelector('.mt'), title = m.title || (def ? def.title : m.type); if (t.textContent !== title) t.textContent = title;
        const hb = inst.el.querySelector('[data-act="hide"]');
        if (hb && hb.dataset.h !== String(!!m.hidden)) { hb.dataset.h = String(!!m.hidden); hb.title = m.hidden ? 'Show (H)' : 'Hide (H)'; hb.innerHTML = `<i data-lucide="${m.hidden ? 'eye' : 'eye-off'}"></i>`; refreshIcons(hb); }
      } else inst = makeInst(m, def, this.editing);
      next.push(inst);
    }
    for (const inst of keep.values()) { destroy(inst); inst.el.remove(); ALERTS.delete(inst.id); }
    next.forEach(inst => host.appendChild(inst.el));    // appendChild moves existing nodes into the new order
    if (fa && fa !== document.activeElement && host.contains(fa)) fa.focus({preventScroll:true});
    this.insts = next;
    for (const inst of next) {
      const m = inst.m;
      inst.visible = !m.hidden || false;
      inst.el.classList.toggle('is-hidden', !!m.hidden);
      inst.el.classList.toggle('no-header', m.header === false);
      inst.el.hidden = !!m.hidden && !this.editing;
      inst.el.querySelector('.mhid').hidden = !m.hidden;
      if (!inst.def) {   // a built-in type that did not register means its script failed to load, not an old version
        const builtin = BUILTIN_TEMPLATES.some(t => t.workspaces.some(w => w.modules.some(x => x.type === m.type)));
        if (builtin) applyState(inst, 'na', 'Module code did not load. Reload the page (Ctrl+R).', {label:'Reload', fn:() => location.reload()});
        else applyState(inst, 'na', `Module '${m.type}' is not available in this version.`);
      }
      else if (!inst._built) build(inst);
      inst._pending = true;
    }
    this.place(); refreshIcons(host);
    this.alertsDirty = true; this.schedule();
    Pit.emit('workspace', ws.id);
  },
  place(){
    const host = $('ws'); this.narrow = host.clientWidth > 0 && host.clientWidth < 1100;
    host.classList.toggle('narrow', this.narrow);
    // the rows the layout uses stretch to fill the window's height (CSS: repeat(var(--rows), minmax(var(--row), 1fr)))
    const rows = Math.max(1, ...this.insts.filter(i => !i.m.hidden).map(i => i.m.y + i.m.h)), cs = getComputedStyle(host);
    host.style.setProperty('--rows', rows);
    // the stretched row height, for edit mode (fixed rows there, so the empty rows below keep the pitch): the same share of
    // the height the view-mode grid gives each row
    const H = host.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0), base = parseFloat(css('--row')) || 28;
    host.style.setProperty('--rh', Math.max(base, (H - 8 * (rows - 1)) / rows).toFixed(2) + 'px');
    // narrow: one column of stacked modules (CSS makes it a flex column); tables take their own height, the others their
    // rows' height (at most 16), and the page scrolls once
    const rp = parseFloat(css('--row')) || 28;
    for (const i of this.insts) {
      const m = i.m, auto = this.narrow && NARROW_AUTO.has(m.type);
      i.el.style.gridColumn = this.narrow ? '' : `${m.x + 1} / span ${m.w}`;
      i.el.style.gridRow = this.narrow ? '' : `${m.y + 1} / span ${m.h}`;
      i.el.style.height = this.narrow && !auto ? `${Math.max(Math.min(m.h, 16), NARROW_MIN_ROWS[m.type] || 0) * (rp + 8) - 8}px` : '';
      i.el.classList.toggle('auto-h', auto);
    }
    // the DOM order is the order shown: narrow stacks by NARROW_ORDER, wide reads y/x (this.insts stays in reading order)
    const want = this.narrow ? this.insts.slice().sort((a, b) => (NARROW_ORDER[a.m.type] || 10) - (NARROW_ORDER[b.m.type] || 10) || a.m.y - b.m.y || a.m.x - b.m.x) : this.insts;
    if (want.some((x, k) => host.children[k] !== x.el)) {
      const fa = document.activeElement;   // re-appending blurs it, as in mount()
      want.forEach(x => host.appendChild(x.el));
      if (fa && fa !== document.activeElement && host.contains(fa)) fa.focus({preventScroll:true});
    }
  },
  schedule(){ if (!this.raf) this.raf = requestAnimationFrame(() => this.frame()); },
  frame(){
    this.raf = 0; clearTimeout(this.timer);
    const c = Pit.ctx, now = performance.now(), all = DIRTY.has('theme') || DIRTY.has('units') || DIRTY.has('resize');
    for (const h of this.hooks) try { h(DIRTY); } catch (e) { console.error('chrome', e); }
    let wait = Infinity;
    if (c) for (const inst of this.insts) {
      if (!inst.def || !inst.visible || inst.el.hidden) continue;
      // what it reads, and what it waits for: a module mounted before the driver (or the summary, or the field) arrived must wake when it does
      if (all || inst.def.needs.some(n => DIRTY.has(n)) || inst.def.requires.some(n => DIRTY.has(n))) inst._pending = true;
      if (!inst._pending) continue;
      const gap = 1000 / inst.def.rate - (now - inst._last);
      if (gap > 0) { wait = Math.min(wait, gap); continue; }   // left pending: rendered at its next allowed slot
      renderInst(inst, c, now);
    }
    DIRTY.clear();
    if (this.alertsDirty) { this.alertsDirty = false; Pit.emit('alerts', ALERTS); }
    if (wait < Infinity) this.timer = setTimeout(() => this.schedule(), Math.ceil(wait));
  },
  force(){ for (const i of this.insts) i._pending = true; this.schedule(); },
};
function build(inst){
  inst._built = true;
  try { inst.def.build(inst.body, inst); }
  catch (e) { console.error(`module ${inst.type}: build`, e); applyState(inst, 'na', 'This module failed: ' + e.message); inst._broken = true; }
}
function destroy(inst){ if (inst.def && inst.def.destroy && inst._built) try { inst.def.destroy(inst); } catch (e) { console.error(`module ${inst.type}: destroy`, e); } }
function renderInst(inst, c, now){
  inst._pending = false; inst._last = now;
  if (inst._broken) return;
  const na = gate(inst, c);
  if (na) { inst._gated = true; applyState(inst, 'na', na); setStale(inst, 0); return; }
  if (inst._gated) { inst._gated = false; applyState(inst, 'ok'); }
  inst._stSet = false;
  try { inst.def.render(c, inst); }
  catch (e) { console.error(`module ${inst.type}: render`, e); applyState(inst, 'na', 'This module failed: ' + e.message); return; }
  if (!inst._stSet) applyState(inst, 'ok');
  setStale(inst, staleness(inst, c)); moreMark(inst);
}
function moreMark(inst){
  const b = inst.body;
  inst.el.classList.toggle('more', !b.hidden && b.scrollTop + b.clientHeight < b.scrollHeight - 1);
  inst.el.classList.toggle('more-x', !b.hidden && b.scrollLeft + b.clientWidth < b.scrollWidth - 1);   // a table that continues to the right
}
function setStale(inst, ms){
  const tag = inst.el.querySelector('.mtag'), on = ms > 0, t = on ? `◐ STALE ${Math.round(ms / 1000)} s` : '';
  inst.el.classList.toggle('stale', on);
  if (tag.textContent !== t) { tag.textContent = t; tag.hidden = !on; }
}

// Delegated clicks in view mode: tool buttons and the options button (the editor handles .medit itself).
document.addEventListener('click', e => {
  const b = e.target.closest('#ws .mtools button'); if (!b) return;
  const inst = WS.insts.find(i => i.el.contains(b)); if (!inst || !inst.def) return;
  if (b.dataset.act === 'opts') return Editor.options(inst);
  if (b.dataset.tool && inst.def.tool) try { inst.def.tool(b.dataset.tool, inst); } catch (er) { console.error(`module ${inst.type}: tool`, er); }
});
// Resizes: re-place (narrow switch), let modules re-measure (debounced), and re-render.
(() => {
  let t = 0;
  new ResizeObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => {
      WS.place();
      for (const i of WS.insts) if (i.def && i.def.resize && i._built && !i._broken) try { i.def.resize(i); } catch (e) { console.error(`module ${i.type}: resize`, e); }
      Pit.dirty('resize');
    }, 100);
  }).observe(document.documentElement);
})();
