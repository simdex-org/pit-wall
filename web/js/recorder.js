'use strict';
// recorder.js (D2): what the page keeps between readings. The bridge is the source of whole-lap traces and racing lines
// (GET /lap?n=N, fetched once each by ensureLap); the page itself records only the lap in progress, the 60 s live
// trace and the G peaks. No DOM here: modules read REC and redraw on the 'rec' channel (Pit.dirty('rec') on each bump).

const NB = 400, LCH = ['t', 'speed', 'thr', 'brk', 'steer', 'gear', 'rpm'];   // 400 bins per lap, the bridge's /lap channels
const TRACE_N = 1800, TRACE_KEYS = ['speed', 'thr', 'brk', 'clu', 'steer', 'rpm', 'gear', 'fuel', 'gLat', 'gLon', 'tFL', 'tFR', 'tRL', 'tRR', 'pFL', 'pFR', 'pRL', 'pRR'];
const REC = {
  ver: 0,
  trace: {i:0, n:0},              // 60 s ring at the reading rate (30 Hz), newest at i-1
  frozen: null,                   // a copy of the ring while the live channels are paused
  laps: [],                       // {id, n, ms, valid, src:'live'|'bridge'|'import', label, data:{t,speed,…: Float32Array(NB)}}; own laps newest first, imports last
  lines: [],                      // racing lines, newest first: {n, valid, ms, pts:[[x, z], …]} (a point every 1.5 m)
  curLine: [], cur: [],           // the lap in progress: its line and its raw samples
  spread: null,                   // how far, on average, the last line was from the best line: {m, last, best}
  maxRpm: 0, fuelMax: 0,
  gHist: {maxLat:0, maxLon:0},    // session peaks; the plot itself reads the trace ring
  prevLaps: null, prevValid: true, pending: new Set(), failed: new Set(), imp: 0,
};
for (const k of TRACE_KEYS) REC.trace[k] = new Float32Array(TRACE_N);
const bumpRec = () => { REC.ver++; Pit.dirty('rec'); };
const lapById = id => id == null ? null : REC.laps.find(l => l.id === id) || null;

function pushTrace(c, cap){
  const T = REC.trace, v = {speed:c.speed_kmh, thr:c.throttle, brk:c.brake, clu:c.clutch, steer:c.steer_angle, rpm:c.rpm, gear:c.gear, fuel:c.fuel_litres, gLat:c.acc_g[0], gLon:c.acc_g[2]};
  for (let i = 0; i < 4; i++) { v['t' + CORNERS[i]] = coreT(c, i, cap); v['p' + CORNERS[i]] = c.tyre_pressure_psi[i]; }
  for (const k of TRACE_KEYS) T[k][T.i] = isFinite(v[k]) ? v[k] : 0;
  T.i = (T.i + 1) % TRACE_N; T.n = Math.min(T.n + 1, TRACE_N);
  REC.fuelMax = Math.max(REC.fuelMax, c.fuel_litres || 0);
  const gl = Math.abs(v.gLat), gn = Math.abs(v.gLon);
  if (gl < 5 && gl > REC.gHist.maxLat) REC.gHist.maxLat = gl;   // ponytail: a kerb spike over 5 g is noise, not a peak
  if (gn < 5 && gn > REC.gHist.maxLon) REC.gHist.maxLon = gn;
}
function setPaused(on){
  REC.frozen = on ? Object.fromEntries(Object.entries(REC.trace).map(([k, v]) => [k, v instanceof Float32Array ? v.slice() : v])) : null;
}

// ---------- the lap in progress ----------
function recSample(s, c){
  const p = s.track_position, l = REC.cur[REC.cur.length - 1];
  if (l && p <= l.p) return;       // position must advance; drops jitter and the wrap after the line
  REC.cur.push({p, t:s.current_lap_ms, speed:c.speed_kmh, thr:c.throttle, brk:c.brake, steer:c.steer_angle, gear:c.gear, rpm:c.rpm});
}
function resample(smp, ms){       // the same algorithm as the bridge's, so live and bridge laps compare bin for bin
  const d = {}; for (const k of LCH) d[k] = new Float32Array(NB);
  let j = 0;
  for (let i = 0; i < NB; i++) {
    const p = i / (NB - 1);
    while (j < smp.length - 2 && smp[j + 1].p < p) j++;
    const a = smp[j], b = smp[j + 1], f = b.p > a.p ? Math.max(0, Math.min(1, (p - a.p) / (b.p - a.p))) : 0;
    for (const k of LCH) d[k][i] = a[k] + (b[k] - a[k]) * f;
  }
  for (let i = 0; i < NB; i++) d.gear[i] = Math.round(d.gear[i]);
  const end = d.t[NB - 1]; if (end > 0 && ms > 0) { const sc = ms / end; for (let i = 0; i < NB; i++) d.t[i] *= sc; }   // make the last point the official lap time
  return d;
}
function finishLap(n, ms, valid){
  const cur = REC.cur, curLine = REC.curLine;
  const whole = cur.length > 60 && cur[0].p < 0.1 && cur[cur.length - 1].p > 0.9;
  if (whole && curLine.length > 50) {   // only whole laps: a part lap cannot be compared. The bridge copy replaces this one.
    if (!REC.laps.some(l => l.id === 'lap-' + n && l.src === 'bridge')) putLap({id:'lap-' + n, n, ms, valid, src:'live', label:'', data:resample(cur, ms)});
    if (!REC.lines.some(l => l.n === n)) putLine({n, valid, ms, pts:curLine});
  }
  REC.cur = []; REC.curLine = []; bumpRec();
}
function putLap(l){
  const i = REC.laps.findIndex(x => x.id === l.id);
  if (i >= 0) REC.laps[i] = l; else REC.laps.push(l);
  const own = REC.laps.filter(x => x.src !== 'import').sort((a, b) => b.n - a.n), imp = REC.laps.filter(x => x.src === 'import');
  const sel = Pit.ctx ? [Pit.ctx.sel.ref, Pit.ctx.sel.cmp] : [];
  while (own.length > 40) {         // the cap applies to live and bridge laps only; imports are never evicted
    let k = own.length - 1; while (k > 0 && sel.includes(own[k].id)) k--;
    own.splice(k, 1);
  }
  REC.laps = own.concat(imp);
}
const bestLine = () => { const ok = REC.lines.filter(l => l.valid); return ok.length ? ok.reduce((a, b) => b.ms < a.ms ? b : a) : null; };
function putLine(l){
  REC.lines = REC.lines.filter(x => x.n !== l.n).concat([l]).sort((a, b) => b.n - a.n);
  const keep = bestLine();          // the best line stays: the field is placed on it
  while (REC.lines.length > 12) { const k = REC.lines.length - 1 - (REC.lines[REC.lines.length - 1] === keep ? 1 : 0); REC.lines.splice(k, 1); }
  lineSpread();
}
function lineSpread(){
  const last = REC.lines[0], best = bestLine();
  if (!best || !last || best === last) { REC.spread = null; return; }
  let sum = 0, k = 0;
  for (let i = 0; i < last.pts.length; i += Math.max(1, Math.floor(last.pts.length / 200))) {   // 200 samples against the whole best line
    const [x, z] = last.pts[i]; let d = Infinity;
    for (const [bx, bz] of best.pts) d = Math.min(d, (bx - x) ** 2 + (bz - z) ** 2);
    sum += Math.sqrt(d); k++;
  }
  REC.spread = {m:sum / k, last:last.n, best:best.n};
}
function resetSession(){            // a new session (lap count went back): own laps and lines belong to the old one
  REC.laps = REC.laps.filter(l => l.src === 'import'); REC.lines = []; REC.curLine = []; REC.cur = []; REC.spread = null;
  REC.failed.clear(); REC.gHist = {maxLat:0, maxLon:0}; bumpRec();
}

function onReading(r){
  const c = r.car, s = r.session, cap = r.capabilities || {};
  REC.maxRpm = r.fixed.max_rpm || REC.maxRpm;
  if (REC.prevLaps != null && s.completed_laps < REC.prevLaps) resetSession();
  if (REC.prevLaps != null && s.completed_laps > REC.prevLaps) { if (s.last_lap_ms > 0) finishLap(s.completed_laps, s.last_lap_ms, REC.prevValid); else { REC.cur = []; REC.curLine = []; } }
  REC.prevLaps = s.completed_laps; REC.prevValid = s.lap_is_valid;
  pushTrace(c, cap); recSample(s, c);
  const p = s.car_position_m;
  if (p && (p[0] || p[2])) {
    const l = REC.curLine[REC.curLine.length - 1], d = l ? Math.hypot(l[0] - p[0], l[1] - p[2]) : 0, now = performance.now();
    const dt = REC.posT ? Math.max(1 / 30, (now - REC.posT) / 1000) : 1 / 30;   // a stalled feed lets the car go further between readings
    REC.posT = now;
    if (d > 60 && d > (c.speed_kmh / 3.6) * dt * 1.5 + 20) { REC.curLine = [[p[0], p[2], s.track_position]]; REC.cur = []; }   // a jump (out of the garage, a reset): start the line again rather than draw a straight across; the lap is no longer whole
    else if (!l || d > 1.5) REC.curLine.push([p[0], p[2], s.track_position]);
  }
}

// ---------- laps from the bridge: fetched once each, so a reload or a late joiner sees them too ----------
async function ensureLap(n){
  n = n | 0;
  if (!(n > 0) || REC.pending.has(n) || REC.failed.has(n) || REC.laps.some(l => l.id === 'lap-' + n && l.src === 'bridge')) return;
  REC.pending.add(n); bumpRec();
  const j = await Pit.get('/lap?n=' + n);
  REC.pending.delete(n);
  if (!j || !isObj(j.ch) || !LCH.every(k => Array.isArray(j.ch[k]) && j.ch[k].length === NB)) { REC.failed.add(n); bumpRec(); return; }
  putLap({id:'lap-' + n, n, ms:+j.ms, valid:j.valid !== false, src:'bridge', label:'', data:Object.fromEntries(LCH.map(k => [k, Float32Array.from(j.ch[k], v => isFinite(v) ? v : 0)]))});
  if (Array.isArray(j.line) && j.line.length > 50) putLine({n, valid:j.valid !== false, ms:+j.ms, pts:j.line.filter(q => Array.isArray(q) && isFinite(q[0]) && isFinite(q[1])).map(q => isFinite(q[2]) ? [q[0], q[1], q[2]] : [q[0], q[1]])});
  bumpRec();
}
const lapNo = id => { const m = /^lap-(\d+)$/.exec(id || ''); return m ? +m[1] : 0; };
function wantLaps(){                // map lines (newest 12 traced), the best valid lap, and whatever is REF or CMP
  const c = Pit.ctx; if (!c) return;
  const tr = c.laps.filter(l => l.trace), ok = tr.filter(l => l.valid);
  const want = tr.slice(-12).map(l => l.n);
  if (ok.length) want.push(ok.reduce((a, b) => b.ms < a.ms ? b : a).n);
  want.push(lapNo(c.sel.ref), lapNo(c.sel.cmp));
  for (const n of new Set(want)) if (n) ensureLap(n);
}
Pit.on('laps', wantLaps);
Pit.on('select', wantLaps);

// ---------- export / import ----------
const packLap = l => ({n:l.n, ms:l.ms, valid:l.valid, label:l.label || '', data:Object.fromEntries(LCH.map(k => [k, Array.from(l.data[k], v => +v.toFixed(3))]))});
function exportLaps(){ download('pitwall-laps.json', {format:'pitwall-laps', version:1, laps:REC.laps.filter(l => l.data).map(packLap)}); }
function exportSession(){
  const c = Pit.ctx || {}, f = c.r ? c.r.fixed : {};
  download('pitwall-session.json', {format:'pitwall-session', version:1, car:f.car_model, track:f.track, driver:c.from || '', laps:c.laps || [],
    stints:c.s ? c.s.stints : [], stops:c.s ? c.s.stops : [], traces:REC.laps.filter(l => l.data).map(packLap),
    log:(c.log || []).map(e => ({time:new Date(e.t * 1000).toISOString(), lap:e.lap, severity:e.sev, cat:e.cat, text:e.text})), pit_log:c.pitLog || [], notes:lsRaw('pitwall.notes') || ''});
}
async function importLaps(file){   // accepts this page's and the old page's laps files; returns a status line
  if (file.size > 20e6) return 'File too large.';
  let j; try { j = JSON.parse(await file.text()); } catch (e) { return 'Not a valid JSON file.'; }
  if (!j || !['pitwall-laps', 'engineer-laps'].includes(j.format) || !Array.isArray(j.laps)) return 'Not a Pit Wall laps file.';
  let added = 0; const label = cleanText(String(file.name).replace(/\.json$/i, ''), 32) || 'import';
  for (const l of j.laps.slice(0, 200)) {
    if (!isObj(l) || !isObj(l.data) || !LCH.every(k => Array.isArray(l.data[k]) && l.data[k].length === NB)) continue;
    const n = Math.max(0, +l.n | 0), ms = +l.ms; if (!okMs(ms)) continue;
    const lb = cleanText(typeof l.label === 'string' && l.label ? l.label : label, 32);
    if (REC.laps.some(x => x.src === 'import' && x.n === n && x.ms === ms && x.label === lb)) continue;
    REC.laps.push({id:'imp-' + (++REC.imp), n, ms, valid:l.valid !== false, src:'import', label:lb, data:Object.fromEntries(LCH.map(k => [k, Float32Array.from(l.data[k], v => isFinite(+v) ? +v : 0)]))});
    added++;
  }
  bumpRec();
  return added ? `Imported ${added} lap${added > 1 ? 's' : ''}.` : 'No new laps in that file.';
}
