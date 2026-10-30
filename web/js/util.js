'use strict';
// Shared helpers, loaded first: DOM, escaping, storage, enums, units, formatters, the state functions every module
// colours by, advice markup, files and sound. One definition each; modules only read these.
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const CORNERS = ['FL', 'FR', 'RL', 'RR'];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const cleanText = (s, n) => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, n) : '';
const deep = o => JSON.parse(JSON.stringify(o));

// ---------- storage: every access may throw (private windows, blocked site data) ----------
const lsGet = (k, def) => { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } };
const lsRaw = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; } catch (e) { return false; } };
const lsDel = k => { try { localStorage.removeItem(k); } catch (e) {} };

// ---------- enums (bridge payloads carry the index) ----------
const FLAGS = ['none', 'blue', 'yellow', 'black', 'white', 'chequered', 'penalty', 'green', 'orange'];
const PENALTIES = [['none', 'none'], ['DT', 'cutting'], ['SG10', 'cutting'], ['SG20', 'cutting'], ['SG30', 'cutting'], ['DSQ', 'cutting'],
  ['−BEST', 'best lap removed, cutting'], ['DT', 'pit speeding'], ['SG10', 'pit speeding'], ['SG20', 'pit speeding'], ['SG30', 'pit speeding'],
  ['DSQ', 'pit speeding'], ['−BEST', 'pit speeding'], ['DSQ', 'ignored mandatory pit'], ['TIME', 'post-race time'], ['DSQ', 'trolling'],
  ['DSQ', 'pit entry'], ['DSQ', 'pit exit'], ['DSQ', 'wrong way'], ['DT', 'ignored driver stint'], ['DSQ', 'ignored driver stint'],
  ['DSQ', 'exceeded driver stint limit']];
const SERVABLE = [1, 2, 3, 4, 7, 8, 9, 10, 19];   // penalties served in the pit lane
const GRIP = ['Green', 'Fast', 'Optimum', 'Greasy', 'Damp', 'Wet', 'Flooded'];
const RAIN = ['Dry', 'Drizzle', 'Light rain', 'Medium rain', 'Heavy rain', 'Storm'];
const PHASES = ['none', 'starting', 'pre-formation', 'formation', 'pre-session', 'green', 'over', 'post', 'results'];
const LOCS = ['track', 'pit', 'entry', 'exit', 'none'];
const CLASSES = ['GT3', 'GT4', 'GT2', 'GTC', 'TCX'];

// ---------- units: values arrive in km/h, °C, psi; converted only for display (Pit.prefs.units) ----------
const UNITS = {
  speed:{kmh:{f:v => v, b:v => v, u:'km/h', d:0}, mph:{f:v => v * 0.621371, b:v => v / 0.621371, u:'mph', d:0}},
  temp:{c:{f:v => v, b:v => v, u:'°C', d:0}, f:{f:v => v * 1.8 + 32, b:v => (v - 32) / 1.8, u:'°F', d:0}},
  press:{psi:{f:v => v, b:v => v, u:'psi', d:1}, bar:{f:v => v * 0.0689476, b:v => v / 0.0689476, u:'bar', d:2}, kpa:{f:v => v * 6.89476, b:v => v / 6.89476, u:'kPa', d:0}},
};
const un = kind => { const p = typeof Pit !== 'undefined' && Pit.prefs ? Pit.prefs.units[kind] : null; return UNITS[kind][p] || Object.values(UNITS[kind])[0]; };
const fv = (kind, v, d) => v == null || !isFinite(v) ? '—' : un(kind).f(v).toFixed(d == null ? un(kind).d : d);   // formatted value, no unit
const fvu = (kind, v, d) => `${fv(kind, v, d)}<span class="u"> ${un(kind).u}</span>`;

// ---------- formatting (minus is U+2212) ----------
const MINUS = '−';
const okMs = ms => ms != null && isFinite(ms) && ms > 0 && ms < 3.6e6;
const fmtLap = ms => !okMs(ms) ? '—' : `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, '0')}.${String(Math.round(ms % 1000)).padStart(3, '0')}`.replace(/\.1000$/, '.999');
const fmtSector = ms => !okMs(ms) ? '—' : ms >= 60000 ? fmtLap(ms) : (ms / 1000).toFixed(3);
const fmtDelta = ms => (ms == null || !isFinite(ms)) ? '—' : Math.abs(ms) < 0.5 ? '0.000' : (ms > 0 ? '+' : MINUS) + (Math.abs(ms) / 1000).toFixed(3);
const fmtGap = (ms, laps) => laps > 0 ? `+${laps}L` : (ms == null || !isFinite(ms) || ms < 0) ? '—' : '+' + (ms / 1000).toFixed(ms < 10000 ? 2 : 1);
const fmtClock = ms => { if (ms == null || !isFinite(ms) || ms < 0 || ms > 1e9) return '—'; const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const fmtAgo = ms => ms == null || !isFinite(ms) ? '—' : ms < 1500 ? 'now' : ms < 60000 ? `${Math.round(ms / 1000)} s` : ms < 3.6e6 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 3.6e6)} h`;
const signed = (v, d) => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(d);
const hms = d => d.toLocaleTimeString([], {hour12:false});

// One rule for the time between two cars (KPI, relative, battle, rejoin): unsigned, the direction is in the row or the word.
const fmtRel = (ms, d) => ms == null || !isFinite(ms) ? '—' : (Math.abs(ms) / 1000).toFixed(d != null ? d : Math.abs(ms) < 10000 ? 2 : 1);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- class thresholds (config §6.9; GT3 defaults until the bridge sends its config) ----------
const DEF_TH = {dry_psi:[26.0, 27.0], wet_psi:[29.5, 31.0], tyre_c:[65, 105], brake_c:{front:[200, 750], rear:[200, 750]}, pad_low_mm:12, water_c:[105, 115]};
const th = ctx => (ctx && ctx.th) || DEF_TH;
const psiWindow = ctx => ctx && ctx.wet ? th(ctx).wet_psi : th(ctx).dry_psi;
const fuelLow = ctx => ctx && ctx.cfg && ctx.cfg.fuel_low_laps != null ? ctx.cfg.fuel_low_laps : 3;

// ---------- state functions: each returns 'cold' | 'ok' | 'warn' | 'bad' | 'none' ----------
const pressState = (p, ctx) => { if (!(p > 0)) return 'none'; const [lo, hi] = psiWindow(ctx); return p < lo ? 'cold' : p > hi + 1 ? 'bad' : p > hi ? 'warn' : 'ok'; };
const tyreState = (c, ctx) => { if (!(c > 0)) return 'none'; const [lo, hi] = th(ctx).tyre_c; return c < lo ? 'cold' : c > hi + 10 ? 'bad' : c > hi ? 'warn' : 'ok'; };
const brakeState = (c, axle, ctx) => { if (!(c > 0)) return 'none'; const b = th(ctx).brake_c, [cold, hot] = b[axle] || b.front; return c < cold ? 'cold' : c > hot ? 'bad' : c > hot - 100 ? 'warn' : 'ok'; };
const padState = (mm, ctx) => !(mm > 0) ? 'none' : mm < th(ctx).pad_low_mm ? 'bad' : mm < th(ctx).pad_low_mm + 3 ? 'warn' : 'ok';
const fuelState = (laps, ctx) => laps == null || !isFinite(laps) ? 'none' : laps < fuelLow(ctx) ? 'bad' : laps < fuelLow(ctx) + 2 ? 'warn' : 'ok';
const waterState = (c, ctx) => { if (!(c > 0)) return 'none'; const [w, b] = th(ctx).water_c; return c >= b ? 'bad' : c >= w ? 'warn' : 'ok'; };
const stateGlyph = s => ({cold:' ▼', warn:' ▲', bad:' ■'}[s] || '');
const STATE_WORD = {cold:'COLD', warn:'HIGH', bad:'CRIT'};
// Core temperature: the average of the three bands when the game sends them, else the core value.
const coreT = (c, i, cap) => cap && cap.tyre_edge_temps ? (c.tyre_temp_inner_c[i] + c.tyre_temp_middle_c[i] + c.tyre_temp_outer_c[i]) / 3 : c.tyre_core_temp_c[i];

// ---------- icons (Lucide; dynamically added ones need refreshIcons) ----------
const icon = n => { const el = document.createElement('i'); el.setAttribute('data-lucide', n); return el; };
const refreshIcons = root => { if (typeof lucide !== 'undefined') lucide.createIcons({nodes: [...(root || document).querySelectorAll('[data-lucide]')]}); };
const SEV = [['info', 'NOTE'], ['triangle-alert', 'WARN'], ['octagon-alert', 'CRIT']];
const sevIcon = s => SEV[clamp(s | 0, 0, 2)][0];

// ---------- advice and debrief markup (engineer drawer, debrief and advice modules); every string escaped ----------
const sevLine = (sev, text) => { const [ic, w] = SEV[clamp(sev | 0, 0, 2)]; return `<div class="sev sev${clamp(sev | 0, 0, 2)}"><i data-lucide="${ic}"></i><b>${w}</b> ${esc(text)}</div>`; };
// most severe first; a tie goes to the topic that matters first (running dry before a pressure note), so bar and drawer agree
const ADV_PRIO = ['fuel_box', 'fuel_low', 'fuel_flag', 'penalty', 'damage', 'window_closing', 'stint_limit', 'rain_coming', 'brakes_hot', 'pads_low', 'press_front', 'press_rear', 'tyres_cold'];
const advPrio = a => { const i = ADV_PRIO.indexOf(a.id); return i < 0 ? 99 : i; };
const sortAdvice = items => (items || []).slice().sort((a, b) => b.severity - a.severity || advPrio(a) - advPrio(b));
function adviceHtml(items){
  const a = sortAdvice(items);
  return a.length ? a.map(x => sevLine(x.severity, x.text)).join('') : '<div class="empty">Nothing to report.</div>';
}
function debriefHtml(debrief){
  if (!debrief || !debrief.length) return '<div class="empty">The last laps\' analysis appears here after the first lap.</div>';
  return debrief.map(l => `<div class="lap"><h3>Lap ${esc(l.lap_number)} <span class="n">${fmtLap(l.lap_time_ms)}</span> <span class="note">${(l.sectors_ms || []).map(fmtSector).join(' · ')}</span></h3>${(l.lines || []).map(x => sevLine(x.severity, x.text)).join('')}</div>`).join('');
}

// ---------- confirm dialog (#dlgConfirm): resolves to the chosen button's value, or null on Esc ----------
function ask(text, buttons = [['ok', 'OK', true], ['', 'Cancel']]){
  const d = $('dlgConfirm');
  d.innerHTML = `<form method="dialog" class="dlg-body"><p>${esc(text)}</p><div class="dlg-foot">${buttons.map(([v, l, primary]) => `<button class="btn${primary ? ' primary' : ''}" value="${esc(v)}">${esc(l)}</button>`).join('')}</div></form>`;
  return new Promise(res => {
    d.addEventListener('close', () => res(d.returnValue || null), {once:true});
    d.returnValue = ''; d.showModal();
    const p = d.querySelector('.btn.primary'); if (p) p.focus();
  });
}

// ---------- files ----------
function download(name, obj){
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1)], {type:'application/json'})); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'pitwall';

// ---------- sound ----------
let actx = null;
function beep(){
  if (typeof Pit !== 'undefined' && !Pit.prefs.sound) return;
  try { actx = actx || new AudioContext(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; g.gain.value = .08; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + .18); } catch (e) {}
}

// ---------- module helpers (every mod-*.js) ----------
const setHtml = (el, h) => { if (el._h !== h) { el._h = h; el.innerHTML = h; } return el; };   // skips the DOM when nothing changed
const nf = (v, d = 1) => v == null || !isFinite(v) ? '—' : (+v).toFixed(d);
const kvHtml = rows => rows.filter(Boolean).map(([k, v, cls]) => `<dt>${k}</dt><dd class="n${cls ? ' ' + cls : ''}">${v}</dd>`).join('');   // labels are page text; values arrive escaped
const deltaHtml = ms => ms == null || !isFinite(ms) ? '—' : Math.abs(ms) < 0.5 ? fmtDelta(ms)   // gain ▼ in --ok, loss ▲ in --bad
  : `<span class="${ms < 0 ? 's-ok' : 's-bad'}">${ms < 0 ? '▼' : '▲'} ${fmtDelta(ms)}</span>`;
const fieldOn = c => !!(c && c.field && c.bc && c.bc.state === 'live');
const IN_LANE = ['pit', 'entry', 'exit'];
const carLoc = car => !car ? 'none' : IN_LANE.includes(car.loc) ? car.loc : car.loc === 'track' ? (car.out ? 'out' : 'track') : 'none';
const carTags = car => IN_LANE.includes(car.loc) ? '<b class="tag pit">PIT</b>' : car.out ? '<b class="tag out">OUT</b>' : car.in ? '<b class="tag in">IN</b>' : '';   // one state: in the lane > out-lap > in-lap
const carTitle = car => esc([Pit.carName(car, 'full'), car.team, car.model_name].filter(Boolean).join(' · '));
const carRow = (car, c, inst, extra) => {   // the <tr> attributes every car table shares: status bar, own car, focus car, keyboard cursor
  const me = car.i === c.me, foc = c.focus !== 'self' && car.i === c.focus;
  return `<tr data-i="${car.i}" data-loc="${carLoc(car)}" class="${[me && 'me', foc && 'focus', inst.state.kcur === car.i && 'kcur', extra].filter(Boolean).join(' ')}"${foc ? ' aria-selected="true"' : ''}>`;
};
function rowKey(e, inst){           // ↑ ↓ move the row cursor, Enter makes that car the focus car
  const rows = [...inst.body.querySelectorAll('tr[data-i]')]; if (!rows.length) return false;
  let k = rows.findIndex(r => r.classList.contains('kcur'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (k < 0) k = Math.max(0, rows.findIndex(r => r.classList.contains('focus') || r.classList.contains('me')));
    else k = clamp(k + (e.key === 'ArrowDown' ? 1 : -1), 0, rows.length - 1);
    inst.state.kcur = +rows[k].dataset.i; rows.forEach((r, j) => r.classList.toggle('kcur', j === k)); rows[k].scrollIntoView({block:'nearest'});
    return true;
  }
  if (e.key === 'Enter' && k >= 0) { Pit.setFocus(+rows[k].dataset.i); return true; }
  return false;
}
const clickFocus = el => el.addEventListener('click', e => { const tr = e.target.closest('tr[data-i]'); if (tr) Pit.setFocus(+tr.dataset.i); });
function sparkSvg(vals, fmt){       // 1.5 px line, last point dotted, min and max as text at the right
  const v = (vals || []).filter(x => x != null && isFinite(x)); if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), W = 72, H = 18, x = i => 1 + i * (W - 4) / (v.length - 1), y = a => H - 2 - (H - 4) * (hi > lo ? (a - lo) / (hi - lo) : .5);
  return `<span class="spk"><svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${v.map((a, i) => `${x(i).toFixed(1)},${y(a).toFixed(1)}`).join(' ')}"/><circle cx="${x(v.length - 1).toFixed(1)}" cy="${y(v[v.length - 1]).toFixed(1)}" r="1.5"/></svg><span class="note">${fmt(lo)}–${fmt(hi)}</span></span>`;
};
const NO_RIVAL = 'ACC shares no rival inputs, fuel or tyres';
