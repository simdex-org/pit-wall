'use strict';
// One render function per tab. Each reads the latest reading and the recorder; none keeps state of its own
// except the lap selection in Compare.

// ---------- live ----------
function renderLive(r, c, s, f, cap, fpl, fuelLaps){
  $('gear').textContent = c.gear === 0 ? 'N' : c.gear < 0 ? 'R' : c.gear;
  $('speed').textContent = fv('speed', c.speed_kmh); document.querySelector('.speed small').textContent = un('speed').u;
  $('rpmBar').style.width = maxRpm ? Math.min(100, 100*c.rpm/maxRpm) + '%' : '0';
  $('rpmBar').style.background = maxRpm && c.rpm / maxRpm > .92 ? 'var(--bad)' : maxRpm && c.rpm / maxRpm > .8 ? 'var(--warn)' : 'var(--c-speed)';
  $('rpm').textContent = c.rpm + ' rpm'; $('maxRpm').textContent = maxRpm ? maxRpm + ' max' : '';
  for (const [k, v] of [['thr', c.throttle], ['brk', c.brake], ['clu', c.clutch]]) { $(k).style.width = (100*v) + '%'; $(k+'V').textContent = Math.round(100*v) + '%'; }
  const d = c.reference_delta_s; $('delta').textContent = (d > 0 ? '+' : '−') + Math.abs(d).toFixed(3); $('delta').className = d < -0.005 ? 'neg' : d > 0.005 ? 'pos' : '';
  $('cur').textContent = fmtLap(s.current_lap_ms); $('cur').className = 'cur' + (s.lap_is_valid ? '' : ' bad');
  $('last').textContent = fmtLap(s.last_lap_ms); $('best').textContent = fmtLap(s.best_lap_ms);
  $('sector').textContent = cap.sectors === false ? '—' : `${s.current_sector + 1}/${f.sector_count || 3}`;
  $('fuelL').textContent = c.fuel_litres.toFixed(1);
  $('fuelLapsL').textContent = fuelLaps ? fuelLaps.toFixed(1) : '—'; $('fuelLapsL').className = fuelLaps && fuelLaps < ALERT.fuelLaps ? 'bad' : '';
  $('fplL').textContent = fpl ? fpl.toFixed(2) : '—';
  const badges = [];
  if (!s.lap_is_valid) badges.push(['circle-x', 'lap invalid', 'alert']);
  if (s.in_pit_lane) badges.push(['wrench', 'in pit lane', 'on']);
  if (c.pit_limiter) badges.push(['gauge', 'pit limiter', 'on']);
  if (c.tyres_off_track > 0) badges.push(['triangle-alert', `${c.tyres_off_track} wheels off track`, 'alert']);
  if (c.abs_in_action > 0) badges.push(['disc', 'ABS', 'on']);
  if (c.tc_in_action > 0) badges.push(['zap', 'TC', 'on']);
  setBadges($('badges'), badges);
  drawMap(r); if (!frozen) drawCharts(); drawGG();
}
function setBadges(el, items){
  el.innerHTML = ''; for (const [ic, text, k] of items) { const b = document.createElement('span'); b.className = 'chip ' + k; b.appendChild(icon(ic)); b.append(text); el.appendChild(b); }
  refreshIcons(el);
}

// ---------- tyres ----------
let shownHist = -1;
function renderTyres(c, s, cap){
  $('compound').textContent = (s.compound || '').replace(/_/g, ' ');
  $('targets').textContent = `target ${fv('press', ALERT.psiMin)}–${fv('press', ALERT.psiMax)} ${un('press').u} · ${fv('temp', ALERT.tMin)}–${fv('temp', ALERT.tMax)} ${un('temp').u}`;
  const edge = cap.tyre_edge_temps;
  $('tyreGrid').innerHTML = [0, 1, 2, 3].map(i => {
    const core = coreT(c, i, cap), pk = cls(c.tyre_pressure_psi[i], ALERT.psiMin, ALERT.psiMax);
    const temp = (label, v) => `<div class="${tcls(v)}"><small>${label}</small>${fv('temp', v)}<span class="u">${un('temp').u}</span></div>`;
    const rows = [];
    if (cap.tyre_wear) rows.push(['Wear', unit(c.tyre_wear[i].toFixed(1), '%'), '']);
    rows.push(['Brake temp', fvu('temp', c.brake_temp_c[i]), c.brake_temp_c[i] > ALERT.brakeMax ? 'bad mark' : '']);
    if (c.brake_pad_mm[i] > 0) rows.push(['Pad', unit(c.brake_pad_mm[i].toFixed(1), 'mm'), c.brake_pad_mm[i] < ALERT.padMin ? 'warn mark' : ''], ['Disc', unit(c.brake_disc_mm[i].toFixed(1), 'mm'), '']);
    return `<section class="corner"><header>${CORNERS[i]}<span>core ${fv('temp', core)} ${un('temp').u}</span></header>
      <div class="psi ${pk}${pk ? ' mark ' + pk : ''}">${fv('press', c.tyre_pressure_psi[i])}<span class="u">${un('press').u}</span></div>
      <div class="temps">${edge ? temp('Inner', c.tyre_temp_inner_c[i]) + temp('Middle', c.tyre_temp_middle_c[i]) + temp('Outer', c.tyre_temp_outer_c[i]) : temp('Core', core)}</div>
      <dl class="rows">${rows.map(([k, v, x]) => `<dt>${k}</dt><dd class="${x}">${v}</dd>`).join('')}</dl></section>`;
  }).join('');
  if (shownHist !== histVer) { shownHist = histVer; renderTyreHist(); }
}
function renderTyreHist(){
  const B = $('tyreHistRows');
  if (!tyreHist.length) { B.innerHTML = '<tr><td colspan="9" class="empty">Filled as laps are completed.</td></tr>'; return; }
  B.innerHTML = tyreHist.map(h => `<tr><td>${h.n}</td>${h.p.map(v => `<td class="${cls(v, ALERT.psiMin, ALERT.psiMax)}">${fv('press', v)}</td>`).join('')}${h.t.map(v => `<td class="${tcls(v)}">${fv('temp', v)}</td>`).join('')}</tr>`).join('');
}
// The nav flag uses the same thresholds, so a problem shows even when the tab is closed.
function renderTyreFlag(c, cap){
  let bad = false;
  for (let i = 0; i < 4; i++) { const t = tcls(coreT(c, i, cap)); if (cls(c.tyre_pressure_psi[i], ALERT.psiMin, ALERT.psiMax) || t === 'bad' || t === 'warn' || c.brake_temp_c[i] > ALERT.brakeMax) bad = true; }
  $('flagTyres').classList.toggle('on', bad);
}

// ---------- strategy ----------
function renderStrategy(c, s, fpl, fuelLaps){
  $('fuel').innerHTML = unit(c.fuel_litres.toFixed(1), 'L'); $('fpl').innerHTML = fpl ? unit(fpl.toFixed(2), 'L') : '—';
  $('fuelLaps').textContent = fuelLaps ? fuelLaps.toFixed(1) : '—'; $('fuelLaps').className = fuelLaps && fuelLaps < ALERT.fuelLaps ? 'bad' : '';
  $('stint').innerHTML = summary ? unit(summary.stint_laps, 'laps') : '—';
  $('bias').innerHTML = unit(c.brake_bias.toFixed(1), '%');
  $('tc').textContent = c.tc_level; $('tcCut').textContent = s.tc_cut; $('abs').textContent = c.abs_level; $('map_').textContent = s.engine_map;
  $('gLat').textContent = c.acc_g[0].toFixed(2); $('gLon').textContent = c.acc_g[2].toFixed(2); $('steer').textContent = c.steer_angle.toFixed(2);
  const dmg = ['front','rear','left','right','centre'].map((n, i) => c.damage[i] > 0 ? ['triangle-alert', `${n} ${c.damage[i].toFixed(0)}`, 'alert'] : null).filter(Boolean);
  setBadges($('damage'), dmg.length ? dmg : [['circle-check', 'no damage', '']]);
  renderCalc(c, s, fpl);
}
// Fuel to finish: laps to go (typed, else from the session), plus a reserve, times fuel per lap.
function renderCalc(c, s, fpl){
  const valid = laps.filter(l => l.src === 'live' && l.valid), avg = valid.length ? valid.reduce((a, l) => a + l.ms, 0) / valid.length : (s.best_lap_ms > 0 ? s.best_lap_ms : 0);
  const auto = s.total_laps > 0 ? Math.max(0, s.total_laps - s.completed_laps) : avg && s.session_time_left_ms > 0 ? Math.ceil(s.session_time_left_ms / avg) : null;
  $('calcLaps').placeholder = auto != null ? `${auto} (session)` : 'unknown';
  const typed = $('calcLaps').value, togo = typed !== '' ? +typed : auto, reserve = +$('calcReserve').value || 0;
  const need = fpl && togo != null ? (togo + reserve) * fpl : null, left = fpl ? c.fuel_litres / fpl : null;
  $('calcUsed').textContent = togo != null ? togo : '—';
  $('calcNeed').innerHTML = need != null ? unit(need.toFixed(1), 'L') : '—';
  $('calcTank').innerHTML = unit(c.fuel_litres.toFixed(1), 'L');
  fuelToAdd = need != null ? Math.max(0, need - c.fuel_litres) : null;
  $('calcAdd').innerHTML = fuelToAdd != null ? unit(fuelToAdd.toFixed(1), 'L') : '—';
  $('calcAdd').className = need != null && need > c.fuel_litres ? 'warn' : 'ok';
  $('calcPit').textContent = left != null ? `lap ${s.completed_laps + Math.max(0, Math.floor(left - reserve)) + 1}` : '—';
}

// ---------- pit stop: the driver's MFD as the bridge reads it, the plan, and what came back ----------
let pit = null, pitJob = null, fuelToAdd = null;
const PIT_KEY = (() => {   // ?key= from the link bridge.py prints; remembered so the bare address works afterwards
  const k = new URLSearchParams(location.search).get('key');
  try { if (k) localStorage.setItem('engineer.pitkey', k); return k || localStorage.getItem('engineer.pitkey') || ''; } catch (e) { return k || ''; }
})();
const PIT_FIELDS = {fuel:'pFuel', tyre_set:'pSet', tyres:'pTyres', compound:'pCompound', brakes:'pBrakes', front_pad:'pFpad', rear_pad:'pRpad', flip_suspension:'pFlipSusp', flip_bodywork:'pFlipBody'};
const RES_TEXT = {ok:['ok', 'confirmed in the game'], sent:['sent', 'pressed; ACC does not publish it'], skipped:['', '']};
function readPit(){
  const v = id => $(id).type === 'checkbox' ? $(id).checked : $(id).tagName === 'SELECT' && id !== 'pCompound' ? +$(id).value : $(id).type === 'number' ? +$(id).value : $(id).value;
  const plan = Object.fromEntries(Object.entries(PIT_FIELDS).map(([k, id]) => [k, v(id)]));
  plan.pressures = CORNERS.map(c => +$('p' + c).value);
  return plan;
}
function fillPit(plan){
  for (const [k, id] of Object.entries(PIT_FIELDS)) if (plan[k] != null) $(id)[$(id).type === 'checkbox' ? 'checked' : 'value'] = plan[k];
  if (plan.pressures) CORNERS.forEach((c, i) => $('p' + c).value = plan.pressures[i]);
}
function copyMfd(){ if (pit) fillPit({fuel:Math.round(pit.fuel), tyre_set:pit.tyre_set || 1, pressures:pit.pressures.map(v => v.toFixed(1))}); savePit(); }
function savePit(){ S.pit = readPit(); saveS(); }
async function sendPit(){
  savePit(); $('pitMsg').textContent = 'Sending…';
  const r = await fetch('/pit', {method:'POST', headers:{'Content-Type':'application/json', 'X-Pit-Key':PIT_KEY}, body:JSON.stringify(S.pit)}).catch(() => null);
  if (r && r.status === 202) { $('pFlipSusp').checked = $('pFlipBody').checked = false; savePit(); }   // a switch is one-shot
  $('pitMsg').textContent = !r ? 'The bridge is not answering.' : r.status === 202 ? "Sent. Typing it into the driver's pit page; keep ACC focused on the driver's PC."
    : r.status === 403 ? "Wrong or missing access key: open the link bridge.py printed on the driver's PC." : 'Refused: ' + await r.text();
}
function onPitJob(job){
  const prev = pitJob; pitJob = job;
  if (!job || (prev && prev.t === job.t)) return;
  if (!S.pit && job.plan) fillPit(job.plan);   // a second screen, or a new browser: start from what was last sent
  if (job.state === 'done') { const bad = Object.entries(job.res).filter(([, v]) => !RES_TEXT[v]); logEvent(bad.length ? 1 : 0, 'Pit plan applied' + (bad.length ? ': ' + bad.map(([k, v]) => `${k} ${v}`).join(', ') : '')); }
  if (job.state === 'error') logEvent(2, 'Pit plan failed: ' + job.msg);
}
function renderPit(){
  const live = pit && pit.status === 'live', busy = pitJob && pitJob.state === 'running';
  $('pitDot').className = 'dot ' + (live ? 'live' : pit ? 'stale' : '');
  $('pitLink').textContent = !pit ? 'no pit control on this bridge' : busy ? 'applying…' : live ? 'ACC live' + (pit.in_pit_lane ? ' · in pit lane' : '') : `ACC ${pit.status === 'off' ? 'not running' : pit.status}`;
  $('pitApply').disabled = !live || busy;
  const show = (id, v) => { $(id).innerHTML = v; };
  show('mfdFuel', pit && live ? unit(pit.fuel.toFixed(0), 'L') : '—'); show('mfdSet', pit && live ? pit.tyre_set : '—');
  CORNERS.forEach((c, i) => show('mfd' + c, pit && live ? unit(pit.pressures[i].toFixed(1), 'psi') : '—'));
  $('mfdCur').textContent = pit && live ? pit.current_set : '—'; $('mfdNext').textContent = pit && live ? pit.strategy_set : '—';
  if (pitJob && pitJob.state === 'error') $('pitMsg').textContent = 'Failed: ' + pitJob.msg;
  else if (pitJob && pitJob.state === 'done') $('pitMsg').textContent = `Applied at ${hms(new Date(pitJob.t * 1000))}.`;
  const res = pitJob && pitJob.state === 'done' ? pitJob.res : {};
  document.querySelectorAll('[data-r]').forEach(td => {
    const v = res[td.dataset.r], t = v == null ? ['', ''] : RES_TEXT[v] || [v, ''];
    td.textContent = t[0]; td.title = t[1]; td.className = v === 'ok' ? 'ok' : v && !RES_TEXT[v] ? 'bad' : '';
  });
}

// ---------- engineer ----------
let lastAdviceKey = '';
const seenAdvice = new Set();
function msg(a){ const l = document.createElement('div'); l.className = 'msg s' + a.severity; l.appendChild(icon(sevIcon(a.severity))); l.append(a.text); return l; }
function renderAdvice(){
  if (!summary) return;
  const key = JSON.stringify([summary.advice, summary.debrief]); if (key === lastAdviceKey) return; lastAdviceKey = key;
  const A = $('advice'); A.innerHTML = '';
  const adv = [...summary.advice].sort((a, b) => b.severity - a.severity);  // worst first
  $('advN').textContent = adv.length || '';
  if (!adv.length) A.innerHTML = '<div class="empty">Nothing to report.</div>';
  for (const a of adv) { A.appendChild(msg(a)); const k = a.severity + a.text; if (!seenAdvice.has(k)) { seenAdvice.add(k); logEvent(a.severity, 'Engineer: ' + a.text); } }
  const D = $('debrief'); D.innerHTML = '';
  if (!summary.debrief.length) D.innerHTML = '<div class="empty">The last laps\' analysis appears here after the first lap.</div>';
  for (const lap of summary.debrief) {
    const el = document.createElement('div'); el.className = 'lap';
    el.innerHTML = `<h3>Lap ${esc(lap.lap_number)} ${fmtLap(lap.lap_time_ms)} <span>${lap.sectors_ms.map(fmtLap).join(' · ')}</span></h3>`;
    const list = document.createElement('div'); list.className = 'msgs';
    for (const a of lap.lines) list.appendChild(msg(a));
    el.appendChild(list); D.appendChild(el);
  }
  refreshIcons(document.querySelector('.dock')); refreshIcons($('debrief'));
  lapsVer++;                       // sector times came with the debrief
}

// ---------- laps ----------
let shownLaps = -1;
function renderLaps(){
  if (shownLaps === lapsVer) return; shownLaps = lapsVer;
  const live = laps.filter(l => l.src === 'live'), B = $('lapRows');
  const sectors = {}; if (summary) for (const d of summary.debrief) sectors[d.lap_number] = d.sectors_ms;
  const valid = live.filter(l => l.valid), best = Math.min(...valid.map(l => l.ms), Infinity);
  $('sBest').textContent = isFinite(best) ? fmtLap(best) : '—';
  $('sLast').textContent = live.length ? fmtLap(live[0].ms) : '—';
  $('sAvg').textContent = valid.length ? fmtLap(Math.round(valid.reduce((a, l) => a + l.ms, 0) / valid.length)) : '—';
  $('sCount').textContent = live.length || '—';
  if (!live.length) { B.innerHTML = '<tr><td colspan="7" class="empty">No completed laps yet.</td></tr>'; return; }
  B.innerHTML = live.map(l => { const sec = sectors[l.n] || [];
    return `<tr${l.ms === best && l.valid ? ' class="best"' : ''}><td>${l.n}</td><td>${fmtLap(l.ms)}</td><td>${l.ms === best ? '' : fmtDelta(l.ms - best)}</td><td>${fmtLap(sec[0])}</td><td>${fmtLap(sec[1])}</td><td>${fmtLap(sec[2])}</td><td class="${l.valid ? '' : 'bad'}">${l.valid ? '' : 'invalid'}</td></tr>`; }).join('');
}

// ---------- compare ----------
let selRef = null, selCmp = null, shownCmp = -1;
const lapById = id => laps.find(l => l.id === id && l.data) || null;
const lapLabel = l => `${l.src === 'import' ? esc(l.label || 'imported') + ' · ' : ''}Lap ${l.n}<b>${fmtLap(l.ms)}</b>${l.valid ? '' : '<em>invalid</em>'}`;
function renderCompare(){
  const cand = laps.filter(l => l.data);
  if (!lapById(selRef)) { const v = cand.filter(l => l.valid); selRef = (v.length ? v.reduce((a, b) => b.ms < a.ms ? b : a) : cand[cand.length - 1] || {}).id || null; }
  if (selCmp && !lapById(selCmp)) selCmp = null;
  if (!selCmp) { const o = cand.find(l => l.id !== selRef); selCmp = o ? o.id : null; }
  if (shownCmp !== lapsVer) {
    shownCmp = lapsVer;
    const list = (el, sel, which) => { el.innerHTML = cand.length ? cand.map(l => `<button class="lapbtn" data-which="${which}" data-id="${esc(l.id)}" aria-pressed="${l.id === sel}">${lapLabel(l)}</button>`).join('') : '<div class="empty">No complete laps recorded yet.</div>'; };
    list($('refList'), selRef, 'ref'); list($('cmpList'), selCmp, 'cmp');
  }
  updateCompareSummary(); drawCompare();
}
function pickLap(which, id){
  if (which === 'ref') selRef = id; else selCmp = id === selCmp ? null : id;
  if (selCmp === selRef) selCmp = null;
  shownCmp = -1; renderCompare();
}
function updateCompareSummary(){
  const ref = lapById(selRef), cmp = lapById(selCmp), strip = $('msStrip'), note = $('cmpNote');
  if (!ref || !cmp) { strip.innerHTML = ''; $('cmpHead').textContent = ''; note.textContent = ref ? 'Pick a comparison lap to see where time is gained or lost.' : 'Pick a reference lap and a comparison lap. Laps are recorded as they are driven; only complete laps from the start line can be compared.'; return; }
  const d = deltaSeries(ref, cmp), SEG = 20, seg = [];
  for (let i = 0; i < SEG; i++) { const a = Math.round(i * (NB - 1) / SEG), b = Math.round((i + 1) * (NB - 1) / SEG); seg.push(d[b] - d[a]); }
  const m = Math.max(40, ...seg.map(Math.abs));
  strip.innerHTML = seg.map((v, i) => `<div style="--a:${(0.15 + 0.85 * Math.abs(v) / m).toFixed(2)}" class="${v > 5 ? 'loss' : v < -5 ? 'gain' : ''}" title="${i * 5}–${(i + 1) * 5} % of lap: ${fmtDelta(v)} s"><span>${fmtDelta(v).replace('0.', '.')}</span></div>`).join('');
  $('cmpHead').textContent = `${fmtLap(cmp.ms)} vs ${fmtLap(ref.ms)} = ${fmtDelta(cmp.ms - ref.ms)} s`;
  const worst = seg.indexOf(Math.max(...seg)), bestI = seg.indexOf(Math.min(...seg)), rng = i => `${i * 5}–${(i + 1) * 5} %`;
  note.textContent = (seg[worst] > 5 ? `Biggest loss: ${rng(worst)} of the lap, ${fmtDelta(seg[worst])} s. ` : 'No section loses time. ') + (seg[bestI] < -5 ? `Biggest gain: ${rng(bestI)}, ${fmtDelta(seg[bestI])} s.` : '');
}

// ---------- log ----------
let shownLog = -1;
function renderLog(){
  if (shownLog === logVer) return; shownLog = logVer;
  $('evCount').textContent = events.length ? `${events.length} events` : '';
  $('evList').innerHTML = events.length ? events.map(e => `<div class="ev s${e.sev}"><time>${hms(e.t)}</time><span class="lp">L${e.lap}</span><span>${esc(e.text)}</span></div>`).join('') : '<div class="empty">Events appear here as they happen.</div>';
}

// ---------- settings ----------
function initSettings(){
  const sync = () => {
    for (const k of ['speed', 'temp', 'press']) $('set-' + k).value = S[k];
    for (const k of ['psiMin', 'psiMax', 'tMin', 'tMax', 'brakeMax', 'padMin', 'fuelLaps']) $('set-' + k).value = S[k];
    $('set-sound').checked = S.sound; $('notes').value = S.notes;
  };
  sync();
  for (const k of ['speed', 'temp', 'press']) $('set-' + k).addEventListener('change', e => { S[k] = e.target.value; saveS(); buildRows(); render(); });
  for (const k of ['psiMin', 'psiMax', 'tMin', 'tMax', 'brakeMax', 'padMin', 'fuelLaps']) $('set-' + k).addEventListener('change', e => { const v = parseFloat(e.target.value); if (isFinite(v)) { S[k] = v; saveS(); render(); } });
  $('set-sound').addEventListener('change', e => { S.sound = e.target.checked; saveS(); if (S.sound) beep(); });
  $('notes').addEventListener('input', e => { S.notes = e.target.value; saveS(); });
  $('resetSet').addEventListener('click', () => { const notes = S.notes; Object.assign(S, DEF, {notes}); saveS(); sync(); buildRows(); render(); });
}
