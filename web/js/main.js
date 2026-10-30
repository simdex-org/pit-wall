'use strict';
// Entry point: tabs, welcome screen, the SSE connection and the render loop.
let reading = null, ages = {}, lastSeq = null;
const rx = [];                     // arrival timestamps, for the Hz figure

// ---------- tabs ----------
const TABS = ['live', 'tyres', 'strategy', 'laps', 'compare', 'log', 'settings'];
let tab = 'live';
function showTab(name){
  if (!TABS.includes(name)) name = 'live'; tab = name;
  for (const t of TABS) { $('p-' + t).hidden = t !== name; $('t-' + t).setAttribute('aria-selected', t === name); $('t-' + t).tabIndex = t === name ? 0 : -1; }
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  render();
}
TABS.forEach(t => $('t-' + t).addEventListener('click', () => showTab(t)));
document.querySelector('nav').addEventListener('keydown', e => {
  const i = TABS.indexOf(tab), d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0; if (!d) return;
  e.preventDefault(); showTab(TABS[(i + d + TABS.length) % TABS.length]); $('t-' + tab).focus();
});
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(e.target.tagName)) return;
  const n = +e.key; if (n >= 1 && n <= TABS.length) showTab(TABS[n - 1]);
  else if (e.key === 'p' || e.key === 'P') togglePause();
  else if ((e.key === 'f' || e.key === 'F') && tab === 'live') setFollow(!mapView.follow);
});
$('dockToggle').addEventListener('click', () => { const c = $('dock').classList.toggle('closed'); $('dockToggle').setAttribute('aria-expanded', !c); });

// ---------- live panel controls ----------
function togglePause(){
  const on = !frozen; setPaused(on); hover = null;
  $('pause').textContent = on ? 'Resume' : 'Pause'; $('pause').setAttribute('aria-pressed', on); drawCharts();
}
$('pause').addEventListener('click', togglePause);
$('preset').innerHTML = '<option value="">Preset…</option>' + Object.keys(PRESETS).map(n => `<option>${n}</option>`).join('');
$('preset').addEventListener('change', e => { if (!PRESETS[e.target.value]) return; S.rows = [...PRESETS[e.target.value]]; saveS(); e.target.value = ''; buildRows(); drawCharts(); });
$('picks').addEventListener('click', e => {
  const b = e.target.closest('.pick'); if (!b) return; const id = b.dataset.id;
  S.rows = S.rows.includes(id) ? S.rows.filter(x => x !== id) : Object.keys(ROWDEFS).filter(x => S.rows.includes(x) || x === id);   // keeps a stable order; never mutates DEF
  saveS(); buildRows(); drawCharts();
});

// ---------- compare / export controls ----------
document.addEventListener('click', e => { const b = e.target.closest('.lapbtn'); if (b) pickLap(b.dataset.which, b.dataset.id); });
$('cmpClear').addEventListener('click', () => { selCmp = null; shownCmp = -1; renderCompare(); });
$('expLaps').addEventListener('click', exportLaps);
$('expSession').addEventListener('click', exportSession);
$('impLaps').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; const m = await importLaps(f); $('cmpNote').textContent = m; e.target.value = ''; renderCompare(); });
['calcLaps', 'calcReserve'].forEach(id => $(id).addEventListener('input', render));

// ---------- pit stop controls ----------
fillPit(S.pit || {fuel:0, tyres:true, compound:'dry', tyre_set:2, pressures:[26.5, 26.5, 26.5, 26.5], brakes:false, front_pad:1, rear_pad:1});
$('p-strategy').querySelector('.pit').addEventListener('change', savePit);
$('pitApply').addEventListener('click', () => sendPit());
document.querySelector('.pit').addEventListener('click', e => { const b = e.target.closest('[data-only]'); if (b) sendPit(b.dataset.only); });
$('pitCopy').addEventListener('click', copyMfd);
$('tyRec').addEventListener('click', pressFixToPlan);
$('mapFollow').addEventListener('click', () => setFollow(!mapView.follow));
$('mapFit').addEventListener('click', () => { Object.assign(mapView, {zoom:1, dx:0, dy:0}); setFollow(false); });
$('pFuelCalc').addEventListener('click', () => { if (fuelToAdd != null) { $('pFuel').value = Math.ceil(fuelToAdd); savePit(); } });

// ---------- welcome ----------
let bridgeUp = false, welcomeDone = false, enterTimer = null;
function step(id, state, text){ $('ws-' + id).className = state; $('ws-' + id + '-t').textContent = text; }
function enterApp(){
  if (welcomeDone) return; welcomeDone = true; clearTimeout(enterTimer);
  const w = $('welcome'); w.classList.add('leaving'); setTimeout(() => { w.hidden = true; render(); }, 250);
}
function renderWelcome(){
  if (welcomeDone) return;
  const got = !!reading, f = got && reading.reading.fixed, s = got && reading.reading.session;
  step('bridge', bridgeUp ? 'done' : 'wait', bridgeUp ? 'Connected' : "Connecting to the driver's PC");
  step('signal', got ? 'done' : bridgeUp ? 'wait' : '', got ? `${reading.from || 'The driver'} is on track` : "Waiting for ACC on the driver's PC");
  step('session', got ? 'done' : '', got ? [f.car_model, f.track, s.kind].filter(Boolean).join(' · ') : 'Waiting for a session');
  $('wNote').textContent = got ? 'Opening automatically' : '';
  if (got && !enterTimer) enterTimer = setTimeout(enterApp, 1800);
}
$('wEnter').addEventListener('click', enterApp);

// ---------- SSE ----------
// Values from the game reach innerHTML, so only these keys may stay strings;
// every other string becomes a number (NaN if it is not one) before anything reads it.
const TEXT_KEYS = new Set(['what', 'from', 'magic', 'game', 'driver', 'app_version', 'car_model', 'track', 'track_config', 'driver_name', 'kind', 'status', 'compound', 'text']);
const numbersOnly = (o, k) => typeof o === 'string' ? (TEXT_KEYS.has(k) ? o : Number(o))
  : Array.isArray(o) ? o.map(v => numbersOnly(v, k)) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([kk, v]) => [kk, numbersOnly(v, kk)])) : o;
function connect(){
  const es = new EventSource('/events');
  es.onmessage = e => {
    const p = JSON.parse(e.data);
    p.reading = numbersOnly(p.reading);
    ages = {r:p.reading_age_ms, s:p.summary_age_ms};
    if (p.summary) summary = numbersOnly(p.summary);
    if (p.laps) { sessionLaps = numbersOnly(p.laps); lapsVer++; }
    pit = p.pit; onPitJob(p.pit_job);
    if (p.reading && p.reading.sequence !== lastSeq) {
      lastSeq = p.reading.sequence; reading = p.reading;
      const now = performance.now(); rx.push(now); while (rx.length && rx[0] < now - 2000) rx.shift();
      onReading(reading.reading);
    }
    render();
  };
  es.onopen = () => { bridgeUp = true; renderWelcome(); };
  es.onerror = () => { bridgeUp = false; $('linkText').textContent = 'bridge offline'; $('link').className = 'dot'; renderWelcome(); };
}

// ---------- render ----------
function render(){
  renderWelcome();
  const live = ages.r != null && ages.r < 1500, stale = ages.r != null && ages.r < 10000;
  $('link').className = 'dot ' + (live ? 'live' : stale ? 'stale' : '');
  document.body.classList.toggle('offline', !live);
  $('linkText').textContent = live ? 'live' : stale ? `stale ${(ages.r/1000).toFixed(0)} s` : 'no signal';
  $('rate').textContent = live ? `${(rx.length/2).toFixed(0)} Hz` : '';
  $('advAge').textContent = ages.s == null ? '' : ages.s < 3000 ? 'live' : `${(ages.s/1000).toFixed(0)} s ago`;
  if (tab === 'compare') renderCompare();
  if (tab === 'log') renderLog();
  if (tab === 'laps') renderLaps();
  if (tab === 'strategy') renderPit();
  if (!reading) { if (tab === 'live') drawMap(null); return; }
  const r = reading.reading, c = r.car, s = r.session, f = r.fixed, cap = r.capabilities || {};
  $('driver').textContent = reading.from || f.driver_name || '—';
  $('car').textContent = f.car_model || '—';
  $('track').textContent = (f.track || '—') + (f.track_config ? ' / ' + f.track_config : '');
  $('sbSession').textContent = [f.car_model, f.track, s.kind].filter(Boolean).join(' — ') || 'No session';
  $('session').textContent = s.kind; $('status').textContent = s.status === 'Live' ? '' : ` (${s.status.toLowerCase()})`;
  $('pos').textContent = s.position ? 'P' + s.position : '—';
  $('laps').textContent = s.completed_laps + (s.total_laps > 0 ? ' / ' + s.total_laps : '');
  $('timeLeft').textContent = fmtClock(s.session_time_left_ms);
  $('air').textContent = fv('temp', c.air_temp_c, 1) + ' ' + un('temp').u; $('road').textContent = fv('temp', c.road_temp_c, 1) + ' ' + un('temp').u;
  $('wind').textContent = `${f1(s.wind_speed_kmh)} km/h ${Math.round(s.wind_direction_deg)}°`;
  $('grip').textContent = s.surface_grip > 0 ? (100*s.surface_grip).toFixed(1) + ' %' : 'n/a';

  const fpl = s.fuel_per_lap || (summary && summary.fuel_per_lap) || 0;
  const fuelLaps = fpl > 0 ? c.fuel_litres / fpl : (summary ? summary.fuel_laps_remaining : 0);
  $('flagFuel').classList.toggle('on', !!fuelLaps && fuelLaps < ALERT.fuelLaps);
  renderTyreFlag(c, cap);

  if (tab === 'live') renderLive(r, c, s, f, cap, fpl, fuelLaps);
  else if (tab === 'tyres') renderTyres(c, s, cap);
  else if (tab === 'strategy') renderStrategy(c, s, f, fpl, fuelLaps);
  renderAdvice();
}

buildRows(); buildCmpRows(); initSettings();
refreshIcons();
renderWelcome();
showTab(location.hash.slice(1));
connect();
window.addEventListener('resize', () => { render(); if (tab === 'compare') drawCompare(); });
