'use strict';
// Entry point: the access key, the SSE connection and the page's data context (ctx), the always-visible chrome
// (topbar, KPI strip, engineer bar and drawer), keyboard shortcuts, the tab's template and workspace, and boot.

// ---------- sanitising the feed (§6.11) ----------
// Strings reach the DOM, so only these keys may stay strings; every other string becomes a number (NaN if it is not one).
const TEXT_KEYS = new Set(['what', 'from', 'magic', 'game', 'driver', 'app_version', 'car_model', 'track', 'track_config', 'driver_name', 'kind', 'status',
  'compound', 'text', 'id', 'track_status', 'car_class', 'loc', 'mode', 'first', 'last', 'short', 'team', 'model_name', 'class', 'cup_name', 'name', 'cat',
  'by', 'msg', 'state', 'fuel_and_tyres', 'lap_ref_src', 'laps_src', 'best_src', 'drive_loss_src', 'refuel_src', 'tyre_src', 'stops_why', 'src', 'label', 'only', 'busy']);
const numbersOnly = (o, k) => typeof o === 'string' ? (TEXT_KEYS.has(k) ? o : Number(o))
  : Array.isArray(o) ? o.map(v => numbersOnly(v, k)) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([kk, v]) => [kk, numbersOnly(v, kk)])) : o;

// ---------- access key: ?key= read once, kept in this browser, removed from the address bar ----------
Pit.key = (() => {
  const k = new URLSearchParams(location.search).get('key');
  if (k) { lsSet('pitwall.pitkey', k); history.replaceState(null, '', location.pathname + location.hash); }
  return k || lsRaw('pitwall.pitkey') || '';   // Manager.migrate() (boot) copies the old engineer.pitkey here once
})();

// ---------- data from the bridge, and the context every module renders from ----------
const D = {reading:null, summary:null, field:null, entries:null, blog:[], blogSeq:-1, rx:[], lastSeq:null, up:false, lastJobT:null, prevAdvice:new Set()};
const ctx = {r:null, from:'', s:null, st:null, laps:[], field:null, slow:new Map(), entries:null, cars:new Map(), me:null, mode:null, focus:'self', focusCar:null,
  pit:null, pitJob:null, pitLog:[], log:[], cfg:null, th:DEF_TH, bc:null, ages:{}, live:false, stale:false, wet:false, rec:null,
  sel:{ref:null, cmp:null, cursor:null}, now:0};
Pit.ctx = ctx;

function mergeCars(){   // fast field + slow fields + entry list, by car index
  ctx.cars = new Map();
  const ents = ctx.entries && ctx.entries.cars || {};
  for (const c of ctx.field && Array.isArray(ctx.field.cars) ? ctx.field.cars : []) ctx.cars.set(c.i, Object.assign({}, ents[c.i], ctx.slow.get(c.i), c));
  ctx.focusCar = focusCar(ctx);
}
function mergeLog(){
  ctx.log = D.blog.concat(PAGE_LOG).sort((a, b) => b.t - a.t).slice(0, 500);
}
function onPayload(raw){
  const pit = raw.pit, job = raw.pit_job, plog = raw.pit_log;   // these stay as sent; their strings reach the DOM only escaped
  delete raw.pit; delete raw.pit_job; delete raw.pit_log;
  const p = numbersOnly(raw);
  ctx.ages = {r:p.reading_age_ms, s:p.summary_age_ms, field:p.field_age_ms};
  ctx.live = ctx.ages.r != null && ctx.ages.r < 1500; ctx.stale = ctx.ages.r != null && ctx.ages.r < 10000;
  if (p.reading && p.reading.sequence !== D.lastSeq) {
    D.lastSeq = p.reading.sequence; D.reading = p.reading;
    ctx.r = p.reading.reading || null; ctx.from = p.reading.from || '';
    ctx.wet = !!(ctx.r && ctx.r.session.rain_tyres);
    const now = performance.now(); D.rx.push(now); while (D.rx.length && D.rx[0] < now - 2000) D.rx.shift();
    if (typeof REC !== 'undefined' && typeof onReading === 'function' && ctx.r) try { onReading(ctx.r, ctx); } catch (e) { console.error('recorder', e); }
    DIRTY.add('reading');
  }
  if (p.summary) { ctx.s = p.summary; ctx.st = p.summary.strategy || null; DIRTY.add('summary'); }
  if (p.laps) { ctx.laps = p.laps; DIRTY.add('laps'); Pit.emit('laps', ctx.laps); }
  if (p.config) { ctx.cfg = p.config; DIRTY.add('config'); Pit.emit('config', ctx.cfg); }
  if (p.bc !== undefined) ctx.bc = p.bc;
  if (p.entries) { ctx.entries = p.entries; mergeCars(); DIRTY.add('entries'); }
  if (p.field) {
    ctx.field = p.field; ctx.me = p.field.me != null ? p.field.me : null;
    if (isObj(p.field.slow)) for (const [k, v] of Object.entries(p.field.slow)) ctx.slow.set(+k, v);
    mergeCars(); DIRTY.add('field');
  } else if (ctx.bc && ctx.bc.state !== 'live' && ctx.field && ctx.ages.field == null) { ctx.field = null; ctx.cars = new Map(); ctx.me = null; DIRTY.add('field'); }
  ctx.mode = ctx.field && ctx.field.mode ? ctx.field.mode : ctx.r && ctx.r.session.kind ? (ctx.r.session.kind === 'Race' ? 'race' : 'best') : null;
  const cls = ctx.r && ctx.r.fixed.car_class, T = ctx.cfg && ctx.cfg.thresholds;
  ctx.th = T ? T[cls] || T.GT3 || DEF_TH : DEF_TH;
  if (Array.isArray(p.log) && p.log.length) {
    for (const it of p.log) if (it.seq > D.blogSeq) { D.blog.unshift(it); D.blogSeq = it.seq; }
    if (D.blog.length > 500) D.blog.length = 500;
    DIRTY.add('log');
  }
  if (DIRTY.has('log')) mergeLog();
  ctx.pit = pit || null; ctx.pitJob = job || null; if (Array.isArray(plog)) ctx.pitLog = plog;
  DIRTY.add('pit');
  if (job && job.t !== D.lastJobT) { D.lastJobT = job.t; Pit.emit('pitjob', job); }
  ctx.rec = typeof REC !== 'undefined' ? REC : null;
  ctx.now = performance.now();
  WS.schedule();
}
let es = null;
function connect(){
  if (es) es.close();
  es = new EventSource(`/events?hz=${Pit.prefs.hz}`);
  es.onmessage = e => { let p; try { p = JSON.parse(e.data); } catch (er) { return; } onPayload(p); };
  es.onopen = () => { D.up = true; renderWelcome(); Pit.dirty('link'); };
  es.onerror = () => { D.up = false; renderWelcome(); Pit.dirty('link'); };
}
Pit.reconnect = connect;
setInterval(() => Pit.dirty('tick'), 1000);
// Page log lines (Pit.log) reach ctx.log on the next frame.
WS.hooks.push(d => { if (d.has('log')) mergeLog(); ctx.now = performance.now(); });

// ---------- flag ring: a big outline round the window while a flag is out ----------
// The driver's flag first, then the track's. All blink; chequered is steady and stays latched until the session ends or the game drops.
const flagRing = document.body.appendChild(Object.assign(document.createElement('div'), {id:'flagRing', hidden:true}));
let chequeredKey = null, greenSince = 0;
function flagNow(){
  const r = ctx.r;
  if (!r || !ctx.stale || r.session.status === 'Off') { chequeredKey = null; return null; }
  const s = r.session, g = s.global_flags || {}, f = FLAGS[s.flag], key = s.session_index + '/' + s.kind;
  if (chequeredKey && chequeredKey !== key) chequeredKey = null;   // a new session
  if (f === 'chequered' || g.chequered) chequeredKey = key;
  if (chequeredKey) return 'chequered';
  if (g.red) return 'red';
  if (f === 'black' || f === 'penalty') return f;
  if (f === 'blue') return 'blue';
  if (f === 'yellow' || g.yellow || g.y1 || g.y2 || g.y3) return 'yellow';
  if (f === 'orange') return 'orange';
  if (f === 'white' || g.white) return 'white';
  if (f === 'green' || g.green) {   // green only announces a start or restart: 5 s, then quiet until it goes off and comes back
    greenSince = greenSince || performance.now();
    return performance.now() - greenSince < 5000 ? 'green' : null;
  }
  greenSince = 0;
  return null;
}
WS.hooks.push(d => {
  if (!d.has('reading') && !d.has('tick')) return;
  const f = flagNow();
  if (flagRing.dataset.flag !== (f || '')) { flagRing.dataset.flag = f || ''; flagRing.hidden = !f; }
});

// ---------- topbar: template switcher, workspace tabs, clock, link ----------
const ADVICE_MODS = {press_front:['tyres', 'press-fix'], press_rear:['tyres', 'press-fix'], tyres_cold:['tyres'], brakes_hot:['brakes', 'tyres'], pads_low:['brakes'],
  fuel_box:['race-plan', 'fuel', 'fuel-calc'], fuel_low:['race-plan', 'fuel', 'fuel-calc'], fuel_flag:['race-plan', 'fuel', 'fuel-calc'],
  damage:['damage'], rain_coming:['weather'], window_closing:['rules', 'race-plan'], stint_limit:['rules'], penalty:['flags']};
// Per workspace: the number is the distinct advice lines (warning or worse) that concern one of its modules, counted the
// same way from every tab. The mounted modules' own alerts (only the open workspace has them) may raise the level, never
// the number, so a badge never changes its count because you switched tabs.
function tabAlerts(){
  const out = {}, adv = ctx.s && ctx.s.advice || [];
  for (const w of Tpl.cur.workspaces) {
    const types = new Set(w.modules.filter(m => !m.hidden).map(m => m.type)), ids = new Set();
    let lvl = 0;
    for (const a of adv) if (a.severity >= 1 && (ADVICE_MODS[a.id] || []).some(t => types.has(t))) { lvl = Math.max(lvl, a.severity); ids.add(a.id); }
    if (w.id === WS.wsId) for (const [, [l]] of ALERTS) lvl = Math.max(lvl, l);
    out[w.id] = [lvl, ids.size];
  }
  return out;
}
let tabsKey = '';
function renderTabs(force){
  const t = Tpl.cur, key = JSON.stringify([t.id, t.updated, t.workspaces.map(w => [w.id, w.name]), WS.wsId, Editor.active]);
  if (force || key !== tabsKey) {
    tabsKey = key;
    $('tabs').innerHTML = t.workspaces.map((w, i) => `<span class="tabw"><button type="button" role="tab" id="tab-${esc(w.id)}" data-ws="${esc(w.id)}" aria-selected="${w.id === WS.wsId}" tabindex="${w.id === WS.wsId ? 0 : -1}" title="${esc(w.name)} (${i + 1})">${esc(w.name)}<span class="tab-alert" hidden></span></button>${Editor.active ? `<button type="button" class="btn icon tab-menu" data-wsmenu="${esc(w.id)}" aria-label="Workspace actions: ${esc(w.name)}" title="Rename, duplicate, move, delete">⋯</button>` : ''}</span>`).join('')
      + (Editor.active && t.workspaces.length < 9 ? '<button type="button" class="tab-add" id="tabAdd" title="Add a workspace" aria-label="Add a workspace">+</button>' : '')
      + `<select class="tab-sel" id="tabSel" aria-label="Workspace">${t.workspaces.map(w => `<option value="${esc(w.id)}"${w.id === WS.wsId ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}</select>`;   // phones: CSS shows this instead of the tabs
    $('tplName').textContent = t.name;
    $('tplBtn').title = `Template: ${t.name} (T to manage)`;
  }
  const al = tabAlerts();
  for (const w of t.workspaces) {
    const b = $('tab-' + w.id), s = b && b.querySelector('.tab-alert'); if (!s) continue;
    const [l, n] = al[w.id] || [0, 0], txt = l ? (l >= 2 ? '■' : '▲') + (n || '') : '';
    if (s.textContent !== txt) { s.textContent = txt; s.hidden = !l; s.className = 'tab-alert' + (l >= 2 ? ' s-bad' : ' s-warn'); s.setAttribute('aria-label', n ? plural(n, 'alert') : 'a module reports a problem'); }
  }
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('[role="tab"]'); if (b) showWs(b.dataset.ws); });
$('tabs').addEventListener('change', e => { if (e.target.id === 'tabSel') showWs(e.target.value); });
$('tabs').addEventListener('keydown', e => {
  if (!e.target.matches('[role="tab"]')) return;
  const ws = Tpl.cur.workspaces, i = ws.findIndex(w => w.id === WS.wsId), d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
  e.preventDefault(); showWs(ws[(i + d + ws.length) % ws.length].id); const b = $('tab-' + WS.wsId); if (b) b.focus();
});
function renderTplPop(){
  const t = Tpl.cur, row = x => `<button type="button" role="menuitemradio" aria-checked="${x.id === t.id}" data-tpl="${esc(x.id)}">${Tpl.isBuiltin(x.id) ? '<i data-lucide="lock"></i>' : '<span class="ico-gap"></span>'}<span>${esc(x.name)}</span><span class="note">${x.workspaces.length} ws</span></button>`;
  $('tplPop').innerHTML = `<div class="pop-h">Built-in</div>${Tpl.builtins.map(row).join('')}${Tpl.items.length ? `<div class="pop-h">Yours</div>${Tpl.items.map(row).join('')}` : ''}
    <hr><button type="button" role="menuitem" data-tpl="">Manage templates…<kbd>T</kbd></button>`;
  refreshIcons($('tplPop'));
}
$('tplPop').addEventListener('toggle', e => { if (e.newState === 'open') renderTplPop(); });
$('tplPop').addEventListener('click', async e => {
  const b = e.target.closest('[data-tpl]'); if (!b) return;
  $('tplPop').hidePopover();
  if (!b.dataset.tpl) return Manager.open();
  if (Editor.active && !(await Editor.leave())) return;
  Tpl.use(b.dataset.tpl);
});
function renderLink(){
  const l = $('link');
  const [s, t] = !D.up ? ['off', '○ OFFLINE'] : ctx.live ? ['live', '■ LIVE'] : ctx.ages.r != null && ctx.ages.r < 600000 ? ['stale', `◐ STALE ${Math.round(ctx.ages.r / 1000)} s`] : ['off', '○ OFFLINE'];
  if (l.textContent !== t) { l.textContent = t; l.title = t; l.dataset.state = s; l.className = 'chip ' + (s === 'live' ? 's-ok' : s === 'stale' ? 's-warn' : 's-dim'); }
  const clock = ctx.r ? fmtClock(ctx.r.session.session_time_left_ms) : '—';
  if ($('clock').textContent !== clock) $('clock').textContent = clock;
  document.body.classList.toggle('offline', !ctx.live);
}

// ---------- KPI strip (§2.3) ----------
const KPI_LABEL = {session:'Session', left:'Left', lap:'Lap', pos:'Pos', ahead:'Ahead', behind:'Behind', last:'Last', best:'Best', delta:'Δ', fuel:'Fuel',
  stint:'Stint', flag:'Flag', temps:'Track / air', grip:'Grip', rain:'Rain', penalty:'Penalty', stintTime:'Driver stint', boxIn:'Box in'};
function meCar(){ return ctx.me != null ? ctx.cars.get(ctx.me) || null : null; }
function fieldLive(){ return !!(ctx.field && ctx.bc && ctx.bc.state === 'live'); }
function kpiCell(id){   // -> [label, html]; every string from the feed escaped
  const r = ctx.r, s = ctx.s, st = ctx.st, ss = r && r.session, c = r && r.car, me = fieldLive() ? meCar() : null, race = (ctx.mode || 'race') === 'race';
  const D_ = '—';
  switch (id) {
    case 'session': {
      if (!ss) return ['Session', D_];
      const ph = fieldLive() && ctx.field.phase != null ? PHASES[ctx.field.phase] : ss.status && ss.status !== 'Live' ? ss.status : '';
      return ['Session', esc((ss.kind || '').toUpperCase()) + (ph ? `<span class="u"> · ${esc(String(ph).toUpperCase())}</span>` : '')];
    }
    case 'left': return ['Left', ss ? fmtClock(ss.session_time_left_ms) : D_];
    case 'lap': {
      if (!ss) return ['Lap', D_];
      const n = ss.lap_number != null ? ss.lap_number : ss.completed_laps + 1;
      const tot = ss.total_laps > 0 ? ss.total_laps : st && st.laps_to_go != null ? '≈' + (ss.completed_laps + st.laps_to_go) : '';
      return ['Lap', `${n}${tot !== '' ? `<span class="u">/${tot}</span>` : ''}`];
    }
    case 'pos': {
      if (!ss || !ss.position) return ['Pos', D_];
      return ['Pos', `P${ss.position}${me && me.cpos && me.cpos !== me.pos ? `<span class="u"> · C${me.cpos}</span>` : ''}`];
    }
    case 'ahead': case 'behind': {
      const pos = me ? me.pos : ss && ss.position, ahead = id === 'ahead';
      const label = race ? (ahead ? 'Ahead' : 'Behind') : pos ? `To P${ahead ? pos - 1 : pos + 1}` : (ahead ? 'To P(n−1)' : 'To P(n+1)');
      if (me) {
        const o = ahead ? me : [...ctx.cars.values()].find(x => x.pos === me.pos + 1);
        if (!o || (ahead && me.pos === 1)) return [label, D_];
        return [label, race ? (o.int_laps > 0 ? `${o.int_laps}<span class="u"> lap${o.int_laps > 1 ? 's' : ''}</span>` : fmtRel(o.int)) : fmtDelta(ahead ? o.int : o.int == null ? null : -o.int)];
      }
      const ms = ss && (ahead ? ss.gap_ahead_ms : ss.gap_behind_ms);
      return [label, ms > 0 && ms < 600000 ? fmtRel(ms) : D_];
    }
    case 'last': {
      if (!ss) return ['Last', D_];
      const l = ctx.laps.length ? ctx.laps[ctx.laps.length - 1] : null, inv = l && l.valid === false && l.ms === ss.last_lap_ms;
      return ['Last', inv ? `<span class="t-inv">${fmtLap(ss.last_lap_ms)}</span> <b class="tag inv">INV</b>` : fmtLap(ss.last_lap_ms)];
    }
    case 'best': {
      const b = s && s.best_ms != null ? s.best_ms : ss && okMs(ss.best_lap_ms) ? ss.best_lap_ms : null;
      const sb = b != null && ctx.field && ctx.field.best && ctx.field.best.ms === b;
      return ['Best', b == null ? D_ : sb ? `<span class="t-best">◆ ${fmtLap(b)}</span>` : fmtLap(b)];
    }
    case 'delta': {
      const d = c && c.reference_delta_s; if (d == null || !isFinite(d)) return ['Δ', D_];
      const ms = d * 1000;
      return ['Δ', ms < -5 ? `<span class="s-ok">▼ ${fmtDelta(ms)}</span>` : ms > 5 ? `<span class="s-bad">▲ ${fmtDelta(ms)}</span>` : fmtDelta(ms)];
    }
    case 'fuel': {
      if (!c) return ['Fuel', D_];
      const lf = st && st.laps_of_fuel, fs = fuelState(lf, ctx);
      return ['Fuel', `${c.fuel_litres.toFixed(1)}<span class="u"> L</span>${lf != null && isFinite(lf) ? ` · <span class="${fs === 'bad' ? 's-bad' : ''}">${lf.toFixed(1)}<span class="u"> laps</span></span>${fs === 'bad' ? ' <b class="tag low">LOW</b>' : ''}` : ''}`];
    }
    case 'stint': return ['Stint', s && ss ? `${s.stint_laps}<span class="u"> lap${s.stint_laps === 1 ? '' : 's'} · set </span>${ss.tyre_set || D_}` : D_];
    case 'flag': {
      const f = ss ? FLAGS[ss.flag] : null;
      return ['Flag', !f ? D_ : f === 'none' ? '<span class="s-dim">none</span>' : `<span class="flag" data-flag="${f}"></span> ${f}`];
    }
    case 'temps': return ['Track / air', c ? `${fv('temp', c.road_temp_c)}°<span class="u"> / </span>${fv('temp', c.air_temp_c)}°` : D_];
    case 'grip': return ['Grip', ss && GRIP[ss.track_grip] ? GRIP[ss.track_grip] : D_];
    case 'rain': return ['Rain', ss && Array.isArray(ss.rain) ? `${RAIN[ss.rain[0]] || D_} → ${RAIN[ss.rain[2]] || D_}` : D_];
    case 'penalty': return ['Penalty', !ss || ss.penalty == null ? D_ : ss.penalty ? `<b class="tag pen">${esc((PENALTIES[ss.penalty] || ['?'])[0])}</b>` : '<span class="s-dim">none</span>'];
    case 'stintTime': return ['Driver stint', !ss || ss.stint_time_left_ms == null ? D_ : ss.stint_time_left_ms < 0 ? 'no limit' : fmtClock(ss.stint_time_left_ms)];
    case 'boxIn': return ['Box in', !st ? D_ : st.stops_needed === 0 ? 'no stop' : st.box_in_laps != null ? (st.box_in_laps <= 0 ? '<span class="s-bad">■ this lap</span>' : `${st.box_in_laps}<span class="u"> lap${st.box_in_laps === 1 ? '' : 's'} (L${st.box_by_lap})</span>`) : D_];
  }
  return [id, D_];
}
let kpiShape = '', kpiFit = 0, KPI_OFF = new Set();
const KPI_PHONE = ['pos', 'fuel', 'boxIn', 'left'];   // what the driver checks on a phone, first
function renderKpi(){
  const k = $('kpi'); k.hidden = !Pit.prefs.kpiOn || Editor.active;
  $('btnEdit').hidden = (Pit.prefs.kpiOn && !Editor.active) || WS.narrow;   // the strip's Edit button is gone: the topbar has one
  if (k.hidden) return;
  const phone = k.clientWidth > 0 && k.clientWidth < 600;
  const ids = phone ? KPI_PHONE : Pit.prefs.kpi, shape = ids.join() + '|' + k.clientWidth + '|' + WS.narrow;
  if (shape !== kpiShape) {
    kpiShape = shape;
    k.innerHTML = ids.map(id => `<div class="kc" data-k="${id}"><span class="kl">${KPI_LABEL[id]}</span><span class="kn n">—</span></div>`).join('')
      + '<span class="kc-more n" hidden></span><span class="kpi-end"><button type="button" class="chip focus-chip" id="focusChip" hidden></button>'
      + (WS.narrow ? '' : '<button type="button" class="btn kpi-edit" id="kpiEdit" title="Edit this workspace (E)"><i data-lucide="layout-dashboard"></i>Edit</button>') + '</span>';
    refreshIcons(k); kpiFit = 0;
  }
  // the focus car: the page follows another car in battle, sector compare, laps and the map; one click goes back to your own
  const fc = Pit.focus !== 'self' && ctx.focusCar, chip = $('focusChip'), ct = fc ? `▶ FOCUS #${fc.num} ${Pit.carName(fc, 'short')} ✕` : '';
  if (chip.textContent !== ct) { chip.textContent = ct; chip.hidden = !fc; chip.title = 'Back to your car (G)'; kpiFit = 0; }
  for (const cell of k.querySelectorAll('.kc')) {
    const [l, v] = kpiCell(cell.dataset.k), L = cell.firstChild, V = cell.lastChild;
    if (L.textContent !== l) L.textContent = l;
    if (V.innerHTML !== v) V.innerHTML = v;
  }
  if (performance.now() - kpiFit > 2000) {   // drop cells when the strip is too narrow: from the end, the phone set last
    kpiFit = performance.now();
    const cells = [...k.querySelectorAll('.kc')], more = k.querySelector('.kc-more'); cells.forEach(c => { c.hidden = false; }); more.hidden = true;
    // phones: only the four phone cells, 2×2 (app.css), never dropped
    const order = phone ? [] : cells.slice(1).reverse().sort((a, b) => KPI_PHONE.includes(a.dataset.k) - KPI_PHONE.includes(b.dataset.k));
    for (const c of order) { if (k.scrollWidth <= k.clientWidth + 1) break; c.hidden = true; more.hidden = false; }
    const off = cells.filter(c => c.hidden);   // what did not fit is said, not silently dropped (Settings › Layout marks it too)
    more.textContent = off.length ? `+${off.length} more` : ''; more.title = off.length ? `Not shown, the window is too narrow: ${off.map(c => KPI_LABEL[c.dataset.k]).join(', ')}` : '';
    KPI_OFF = new Set(off.map(c => c.dataset.k));
  }
}
$('kpi').addEventListener('click', e => { if (e.target.closest('#kpiEdit')) Editor.toggle(); if (e.target.closest('#focusChip')) Pit.setFocus('self'); });

// ---------- engineer bar and drawer ----------
let drawerKey = '';
function renderEngBar(){
  const s = ctx.s, adv = sortAdvice(s && s.advice), w = adv[0];
  const main = $('engMain');
  const key = w ? `${w.severity}|${w.text}|${adv.length}` : s ? 'none' : 'wait';
  if (main.dataset.k !== key) {
    main.dataset.k = key;
    const sv = w ? clamp(w.severity | 0, 0, 2) : 0;
    main.className = 'eng-main sev' + sv;
    main.innerHTML = w ? `<i data-lucide="${sevIcon(sv)}"></i><b>${SEV[sv][1]}</b><span class="eng-text">${esc(w.text)}</span>${adv.length > 1 ? `<span class="eng-more">(+${adv.length - 1})</span>` : ''}`
      : `<i data-lucide="info"></i><span class="eng-text">${s ? 'Nothing to report.' : "Waiting for the driver's engineer."}</span>`;
    refreshIcons(main);
  }
  const ids = new Set(adv.map(a => a.id || a.text));
  if (D.seenSummary && adv.some(a => a.severity >= 2 && !D.prevAdvice.has(a.id || a.text))) beep();   // a new critical line
  if (s) { D.prevAdvice = ids; D.seenSummary = true; }
  // right: the bridge, rate, field, pit control and template; Pit.say() messages replace it for 6 s
  const say = Pit._say && Pit._say.until > performance.now() ? Pit._say : null, info = $('engInfo');
  const pit = !ctx.pit ? 'pit off' : (ctx.pitJob && ctx.pitJob.state === 'running') || ctx.pit.busy ? (ctx.pit.waiting_lift ? 'pit busy: driver must lift' : 'pit busy') : !Pit.key ? 'pit: no key' : ctx.pit.status === 'live' ? 'pit ready' : 'pit off';
  const fld = fieldLive() ? `field ${ctx.cars.size} cars` : 'field off';
  const txt = say ? say.text : `bridge ${location.host} · ${ctx.live ? Math.round(D.rx.length / 2) : 0} Hz · ${fld} · ${pit} · ${Tpl.cur.name}`;
  if (info.textContent !== txt) { info.textContent = txt; info.className = 'eng-info' + (say ? ' say s-' + (['dim', 'warn', 'bad'][say.sev] || 'dim') : ''); }
  if (!$('engDrawer').hidden) {
    const k = JSON.stringify([s && s.advice, s && s.debrief]);
    if (k !== drawerKey) { drawerKey = k; $('engAdv').innerHTML = adviceHtml(s && s.advice); $('engDeb').innerHTML = debriefHtml(s && s.debrief); refreshIcons($('engDrawer')); }
  }
}
function toggleDrawer(on){
  const d = $('engDrawer'); on = on == null ? d.hidden : on;
  d.hidden = !on; $('engMain').setAttribute('aria-expanded', on); drawerKey = ''; renderEngBar();
}
$('engMain').addEventListener('click', () => toggleDrawer());
$('engClose').addEventListener('click', () => toggleDrawer(false));

// ---------- one-time banner: thresholds left over from the old settings (§3.9) ----------
function renderBanner(){
  const b = $('banner'), on = !!lsRaw('pitwall.oldThresholds');
  if (b.hidden === !on) return;
  b.hidden = !on;
  b.innerHTML = on ? `<i data-lucide="info"></i><span>This browser had custom thresholds.</span><button type="button" class="btn" data-old="send">Send to bridge</button><button type="button" class="btn" data-old="discard">Discard</button>` : '';
  refreshIcons(b);
}
$('banner').addEventListener('click', async e => { const b = e.target.closest('[data-old]'); if (b) { await Manager.resolveOld(b.dataset.old === 'send'); renderBanner(); } });

WS.hooks.push(d => {
  renderLink(); renderKpi();
  if (d.has('summary') || d.has('say') || d.has('tick') || d.has('pit') || d.has('link') || d.has('field') || !$('engMain').dataset.k) renderEngBar();
  if (d.has('summary') || d.has('tick') || WS.alertsDirty) renderTabs();
});

// ---------- workspaces: the tab's template and workspace live in the address bar (#t=..&w=..) ----------
function readHash(){ const h = new URLSearchParams(location.hash.slice(1)); return {t:h.get('t'), w:h.get('w')}; }
function writeHash(){ history.replaceState(null, '', `${location.pathname}#t=${encodeURIComponent(Tpl.cur.id)}&w=${encodeURIComponent(WS.wsId)}`); }
function showWs(wsId){
  const t = Tpl.cur, ws = t.workspaces.find(w => w.id === wsId) || t.workspaces[0];
  WS.mount(t, ws.id, Editor.active);
  Pit.prefs.lastWs[t.id] = ws.id; Pit.savePrefs();
  writeHash(); renderTabs(true); Pit.dirty('workspace');
}
function stepWs(d){ const ws = Tpl.cur.workspaces, i = ws.findIndex(w => w.id === WS.wsId); showWs(ws[(i + d + ws.length) % ws.length].id); }
Pit.on('template', ({t, wsId}) => {
  Tpl.cur = t;
  showWs(wsId || Pit.prefs.lastWs[t.id] || t.workspaces[0].id);
});
window.addEventListener('storage', e => {
  if (e.key === 'pitwall.templates') {
    Tpl.load();
    if (Editor.active && Editor.forked === Tpl.cur.id && !Tpl.get(Tpl.cur.id)) Tpl.items.push(Tpl.cur);   // this tab's unsaved copy lives only in memory
    const fresh = Tpl.get(Tpl.cur.id);
    if (!fresh) { Tpl.use('builtin-race'); Pit.say('Template deleted in another tab', 1); }
    else if (!Editor.active && fresh !== Tpl.cur) { Tpl.cur = fresh; showWs(WS.wsId); }
  }
  if (e.key === 'pitwall.appearance') Appearance.boot();
});
window.addEventListener('hashchange', () => {
  const h = readHash(); if (Editor.active) return;
  if (h.t && h.t !== Tpl.cur.id && Tpl.get(h.t)) Tpl.use(h.t, h.w);
  else if (h.w && h.w !== WS.wsId) showWs(h.w);
});

// ---------- keyboard (§1.4) ----------
const KEYS_HELP = [['1–9', 'Workspace n of the template'], ['[  ]', 'Previous / next workspace'], ['E', 'Edit this workspace'], ['Ctrl+S', 'Save and leave edit mode'],
  ['Esc', 'Close the dialog, then the drawer, then edit mode; then focus back to your car'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo in edit mode'], ['A', 'Open or close the engineer drawer'],
  ['F', 'Follow the car on the first track map'], ['Shift+F', 'Whole track on that map'], ['P', 'Pause or resume the live channels'], ['G', 'Focus back to your car'],
  ['T', 'Template manager'], [',', 'Settings'], ['?', 'This list'], ['↑ ↓ then Enter', 'In standings, relative or pit lane: pick a car to focus'],
  ['Tab', 'Edit mode: next module'], ['Arrows / Shift+arrows', 'Edit mode: move / resize the selected module one cell'], ['Delete  D  H  O', 'Edit mode: remove, duplicate, hide or show, options']];
function openKeys(){
  const d = $('dlgKeys');
  d.innerHTML = `<form method="dialog" class="dlg-body"><header class="dlg-h"><h2>Keyboard shortcuts</h2><button class="btn icon" value="" aria-label="Close"><i data-lucide="x"></i></button></header>
    <table class="tt keys"><tbody>${KEYS_HELP.map(([k, t]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(t)}</td></tr>`).join('')}</tbody></table></form>`;
  refreshIcons(d); d.showModal();
}
function mapTool(id){ const m = WS.insts.find(i => i.type === 'track-map' && i.visible && i.def && i.def.tool); if (m) m.def.tool(id, m); }
document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || ($('tplPop').matches(':popover-open'))) return;   // native dialogs and the popover handle their own keys
  if (!$('settings').hidden) { if (e.key === 'Escape') { e.preventDefault(); Settings.close(); } return; }
  if (Editor.active && Editor.key(e)) return;
  const typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
  if (typing) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const mod = e.target.closest && e.target.closest('#ws .mod'), inst = mod && WS.insts.find(i => i.el === mod);
  if (inst && inst.def && inst.def.key) { try { if (inst.def.key(e, inst)) { e.preventDefault(); return; } } catch (er) { console.error(`module ${inst.type}: key`, er); } }
  const k = e.key;
  if (k === 'Escape') { if (!$('engDrawer').hidden) toggleDrawer(false); else Pit.setFocus('self'); return; }
  if (/^[1-9]$/.test(k)) { const w = Tpl.cur.workspaces[+k - 1]; if (w) showWs(w.id); }
  else if (k === '[') stepWs(-1); else if (k === ']') stepWs(1);
  else if (k === 'e' || k === 'E') Editor.toggle();
  else if (k === 'a' || k === 'A') toggleDrawer();
  else if (k === 'F') mapTool('fit'); else if (k === 'f') mapTool('follow');
  else if (k === 'p' || k === 'P') { if (typeof setPaused === 'function' && typeof REC !== 'undefined') { setPaused(!REC.frozen); Pit.emit('pause', !!REC.frozen); Pit.dirty('rec'); } }
  else if (k === 'g' || k === 'G') Pit.setFocus('self');
  else if (k === 't' || k === 'T') Manager.open();
  else if (k === ',') Settings.open();
  else if (k === '?') openKeys();
  else return;
  e.preventDefault();
});
$('btnSettings').addEventListener('click', () => Settings.open());
$('btnEdit').addEventListener('click', () => Editor.toggle());
$('btnKeys').addEventListener('click', openKeys);

// ---------- welcome ----------
let welcomeDone = false, enterTimer = null;
function step(id, state, text){ $('ws-' + id).className = state; $('ws-' + id + '-t').textContent = text; }
function enterApp(){
  if (welcomeDone) return; welcomeDone = true; clearTimeout(enterTimer);
  const w = $('welcome'); w.classList.add('leaving'); setTimeout(() => { w.hidden = true; WS.place(); WS.force(); }, 250);
}
function renderWelcome(){
  if (welcomeDone) return;
  const r = ctx.r, f = r && r.fixed, s = r && r.session;
  step('bridge', D.up ? 'done' : 'wait', D.up ? 'Connected' : "Connecting to the driver's PC");
  step('signal', r ? 'done' : D.up ? 'wait' : '', r ? `${ctx.from || 'The driver'} is on track` : "Waiting for ACC on the driver's PC");
  step('session', r ? 'done' : '', r ? [f.car_model, f.track, s.kind].filter(Boolean).join(' · ') : 'Waiting for a session');
  $('wNote').textContent = r ? 'Opening automatically' : '';
  if (r && !enterTimer) enterTimer = setTimeout(enterApp, 1800);
}
$('wEnter').addEventListener('click', enterApp);
WS.hooks.push(d => { if (d.has('reading')) renderWelcome(); });

// ---------- boot ----------
(function boot(){
  try { Manager.migrate(); } catch (e) { console.error('migration', e); }
  if (!Pit.key) Pit.key = lsRaw('pitwall.pitkey') || '';   // a key the migration just brought over
  Appearance.boot();
  checkBuiltins(); Tpl.load();
  const h = readHash(), t = Tpl.get(h.t) || Tpl.get(lsRaw('pitwall.active')) || Tpl.get('builtin-race');
  Tpl.cur = t; lsSet('pitwall.active', t.id);
  showWs(h.t === t.id && h.w ? h.w : Pit.prefs.lastWs[t.id]);
  renderBanner(); refreshIcons(); renderWelcome(); connect();
})();
