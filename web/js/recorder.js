'use strict';
// Everything the page remembers: the 60 s trace ring buffer, per-lap channel recordings,
// tyre history, the event log. Fed by onReading(); read by views and charts.

// ---------- 60 s trace ring buffer (30 Hz readings) ----------
const TRACE_N = 1800;
const KEYS = ['speed','thr','brk','steer','rpm','gear','fuel','gLat','gLon','tFL','tFR','tRL','tRR','pFL','pFR','pRL','pRR'];
const trace = {i:0, n:0}; for (const k of KEYS) trace[k] = new Float32Array(TRACE_N);
let maxRpm = 0, fuelMax = 0;
let frozen = null;                 // snapshot of the buffer while paused
function pushTrace(c, cap){
  const v = {speed:c.speed_kmh, thr:c.throttle, brk:c.brake, steer:c.steer_angle, rpm:c.rpm, gear:c.gear, fuel:c.fuel_litres, gLat:c.acc_g[0], gLon:c.acc_g[2]};
  for (let i = 0; i < 4; i++) { v['t' + CORNERS[i]] = coreT(c, i, cap); v['p' + CORNERS[i]] = c.tyre_pressure_psi[i]; }
  for (const k of KEYS) trace[k][trace.i] = v[k];
  trace.i = (trace.i + 1) % TRACE_N; trace.n = Math.min(trace.n + 1, TRACE_N);
  fuelMax = Math.max(fuelMax, c.fuel_litres);
}
function setPaused(on){
  frozen = on ? Object.fromEntries(Object.entries(trace).map(([k, v]) => [k, v instanceof Float32Array ? v.slice() : v])) : null;
}

// ---------- laps: table rows plus, when the whole lap was seen, 400-point channel recordings against track position ----------
const NB = 400, LCH = ['t','speed','thr','brk','steer','gear','rpm'];
const laps = [];                   // newest first: {id,n,ms,valid,src,label,data|null}
let cur = [];                      // raw samples of the lap in progress
const tyreHist = [];               // per completed lap: pressures and core temps at the line
const events = [];                 // newest first: {t,lap,sev,text}
let lapsVer = 0, histVer = 0, logVer = 0;   // bumped on change so views redraw only when needed
let lastC = null, lastCap = null, lapNo = 0;

function recSample(s, c){
  const p = s.track_position, l = cur[cur.length - 1];
  if (l && p <= l.p) return;       // position must advance; drops jitter and the wrap after the line
  cur.push({p, t:s.current_lap_ms, speed:c.speed_kmh, thr:c.throttle, brk:c.brake, steer:c.steer_angle, gear:c.gear, rpm:c.rpm});
}
function resample(smp, ms){
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
  const whole = cur.length > 60 && cur[0].p < 0.1 && cur[cur.length - 1].p > 0.9;
  laps.unshift({id:`live-${n}-${ms}`, n, ms, valid, src:'live', label:'', data: whole ? resample(cur, ms) : null});
  if (laps.length > 40) laps.pop();
  if (lastC) tyreHist.unshift({n, p:[0, 1, 2, 3].map(i => lastC.tyre_pressure_psi[i]), t:[0, 1, 2, 3].map(i => coreT(lastC, i, lastCap))});
  if (tyreHist.length > 60) tyreHist.pop();
  if (curLine.length > 50) { lines.unshift({n, valid, ms, pts:curLine}); if (lines.length > 12) lines.pop(); lineSpread(); }
  cur = []; curLine = []; lapsVer++; histVer++;
  logEvent(valid ? 0 : 1, `Lap ${n} ${fmtLap(ms)}${valid ? '' : ' (invalid)'}`);
}

// ---------- events ----------
function logEvent(sev, text){
  events.unshift({t:new Date(), lap:lapNo, sev, text});
  if (events.length > 500) events.pop();
  logVer++; if (sev >= 2) beep();
}
// Edge-triggered: log when a condition starts, not every reading while it holds.
const flags = {};
function edge(key, on, sev, text){ if (on && !flags[key]) logEvent(sev, text); flags[key] = on; }
function trackFlags(c, s, cap, fuelLaps){
  edge('invalid', !s.lap_is_valid, 1, 'Lap invalidated');
  edge('pit', !!s.in_pit_lane, 0, 'In pit lane');
  edge('off', c.tyres_off_track > 2, 1, 'Off track');
  edge('fuel', !!fuelLaps && fuelLaps < ALERT.fuelLaps, 2, `Low fuel: ${fuelLaps ? fuelLaps.toFixed(1) : ''} laps left`);
  for (let i = 0; i < 4; i++) {
    edge('psi' + i, !!cls(c.tyre_pressure_psi[i], ALERT.psiMin, ALERT.psiMax), 1, `${CORNERS[i]} pressure ${fv('press', c.tyre_pressure_psi[i])} ${un('press').u}`);
    edge('tmp' + i, tcls(coreT(c, i, cap)) === 'bad', 1, `${CORNERS[i]} tyre temperature ${fv('temp', coreT(c, i, cap))} ${un('temp').u}`);
    edge('brk' + i, c.brake_temp_c[i] > ALERT.brakeMax, 2, `${CORNERS[i]} brake temperature ${fv('temp', c.brake_temp_c[i])} ${un('temp').u}`);
  }
  edge('dmg', (c.damage || []).some(v => v > 0), 2, 'Car damage');
}

function onReading(r){
  const c = r.car, s = r.session, cap = r.capabilities || {};
  lastC = c; lastCap = cap;
  maxRpm = r.fixed.max_rpm || (summary && summary.max_rpm) || maxRpm;
  if (prevLaps != null && s.completed_laps > prevLaps) { lapNo = s.completed_laps; if (s.last_lap_ms > 0) finishLap(s.completed_laps, s.last_lap_ms, prevValid); else cur = []; }
  prevLaps = s.completed_laps; prevValid = s.lap_is_valid; lapNo = s.completed_laps;
  pushTrace(c, cap); recSample(s, c);
  const fpl = s.fuel_per_lap || (summary && summary.fuel_per_lap) || 0;
  trackFlags(c, s, cap, fpl > 0 ? c.fuel_litres / fpl : 0);
  const p = s.car_position_m;
  if (p && (p[0] || p[2])) { const l = curLine[curLine.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[2]) > 1.5) curLine.push([p[0], p[2]]); }
}
let prevLaps = null, prevValid = true, summary = null;
// The racing line of each lap (world x, z in metres, a point every 1.5 m): the map draws them over each other to show consistency.
const lines = [];                  // newest first: {n, valid, ms, pts}
let curLine = [], spread = null;   // spread: how far, on average, the last lap's line was from the best lap's
function lineSpread(){
  const last = lines[0], ok = lines.filter(l => l.valid), best = ok.length ? ok.reduce((a, b) => b.ms < a.ms ? b : a) : null;
  if (!best || best === last) { spread = null; return; }
  let sum = 0, k = 0;
  for (let i = 0; i < last.pts.length; i += Math.max(1, Math.floor(last.pts.length / 200))) {   // 200 samples against the whole best line
    const [x, z] = last.pts[i]; let d = Infinity;
    for (const [bx, bz] of best.pts) d = Math.min(d, (bx - x) ** 2 + (bz - z) ** 2);
    sum += Math.sqrt(d); k++;
  }
  spread = {m: sum / k, last: last.n, best: best.n};
}

// ---------- export / import ----------
const packLap = l => ({n:l.n, ms:l.ms, valid:l.valid, label:l.label || '', data:Object.fromEntries(LCH.map(k => [k, Array.from(l.data[k], v => +v.toFixed(3))]))});
function exportLaps(){ download('engineer-laps.json', {format:'engineer-laps', version:1, laps:laps.filter(l => l.data).map(packLap)}); }
function exportSession(){
  const f = reading && reading.reading.fixed || {};
  download('engineer-session.json', {format:'engineer-session', version:1, car:f.car_model, track:f.track, laps:laps.map(l => l.data ? packLap(l) : {n:l.n, ms:l.ms, valid:l.valid}),
    tyres:tyreHist, events:events.map(e => ({time:e.t.toISOString(), lap:e.lap, severity:e.sev, text:e.text})), notes:S.notes});
}
async function importLaps(file){
  let j; try { j = JSON.parse(await file.text()); } catch (e) { return 'Not a valid JSON file.'; }
  if (!j || j.format !== 'engineer-laps' || !Array.isArray(j.laps)) return 'Not an engineer laps file.';
  let added = 0;
  for (const l of j.laps) {
    if (!l.data || !LCH.every(k => Array.isArray(l.data[k]) && l.data[k].length === NB)) continue;
    const id = `import-${file.name}-${l.n}-${l.ms}`; if (laps.some(x => x.id === id)) continue;
    laps.push({id, n:+l.n, ms:+l.ms, valid:l.valid !== false, src:'import', label:l.label || file.name.replace(/\.json$/i, ''), data:Object.fromEntries(LCH.map(k => [k, Float32Array.from(l.data[k])]))}); added++;
  }
  lapsVer++; return added ? `Imported ${added} lap${added > 1 ? 's' : ''}.` : 'No new laps in that file.';
}
