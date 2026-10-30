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
  const d = c.reference_delta_s; $('delta').textContent = (d < -0.005 ? '▼ ' : d > 0.005 ? '▲ ' : '') + (d > 0 ? '+' : '−') + Math.abs(d).toFixed(3); $('delta').className = d < -0.005 ? 'neg' : d > 0.005 ? 'pos' : '';
  const gap = ms => ms > 0 && ms < 600000 ? (ms / 1000).toFixed(ms < 10000 ? 2 : 1) : '—';
  $('livePos').textContent = s.position ? 'P' + s.position : '—'; $('liveAhead').textContent = gap(s.gap_ahead_ms); $('liveBehind').textContent = gap(s.gap_behind_ms);
  document.querySelector('#p-live .tiles').dataset.state = s.in_pit_lane ? 'pit' : !s.lap_is_valid ? 'invalid' : 'track';   // the coloured edge, as on a timing screen
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
  $('tyreViz').innerHTML = tyreWidget(c, s, cap);
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
    const p = c.tyre_pressure_psi[i], lo = ALERT.psiMin - 1.5, hi = ALERT.psiMax + 1.5, x = v => Math.max(0, Math.min(100, 100 * (v - lo) / (hi - lo)));
    const fix = pressFix(p);
    return `<section class="corner"><header>${CORNERS[i]}<span>core ${fv('temp', core)} ${un('temp').u}</span></header>
      <div class="psi ${pk}${pk ? ' mark ' + pk : ''}">${fv('press', p)}<span class="u">${un('press').u}</span></div>
      <div class="band" aria-hidden="true"><i style="left:${x(ALERT.psiMin)}%;width:${x(ALERT.psiMax) - x(ALERT.psiMin)}%"></i><b style="left:${x(p)}%"></b></div>
      <div class="rec">${!pk ? 'in the window' : `next stop <b>${fix > 0 ? '+' : '−'}${Math.abs(fix).toFixed(1)} psi</b> to the middle`}</div>
      <div class="temps">${edge ? temp('Inner', c.tyre_temp_inner_c[i]) + temp('Middle', c.tyre_temp_middle_c[i]) + temp('Outer', c.tyre_temp_outer_c[i]) : temp('Core', core)}</div>
      <dl class="rows">${rows.map(([k, v, x]) => `<dt>${k}</dt><dd class="${x}">${v}</dd>`).join('')}</dl></section>`;
  }).join('');
  if (shownHist !== histVer) { shownHist = histVer; renderTyreHist(); }
}
// Hot pressure off the middle of the target window: the same change, cold, at the next stop (about 1 psi cold for 1 psi hot).
const pressFix = p => Math.round(((ALERT.psiMin + ALERT.psiMax) / 2 - p) * 10) / 10;
function pressFixToPlan(){
  if (!lastC) return;
  const base = pit && pit.status === 'live' ? pit.pressures : CORNERS.map(c => +$('p' + c).value);
  fillPit({pressures:base.map((v, i) => (v + pressFix(lastC.tyre_pressure_psi[i])).toFixed(1))}); savePit();
  $('tyRec').textContent = 'In the pit plan: Strategy, Pressures';
  logEvent(0, 'Pressure corrections put in the pit plan');
}
// Temperature to a state class: cold blue, in the window green, hot amber, too hot red (the class names also carry a letter).
const tyreState = t => t <= 0 ? 'none' : t < ALERT.tMin ? 'cold' : t > ALERT.tMax + 10 ? 'bad' : t > ALERT.tMax ? 'warn' : 'ok';
const brakeState = t => t <= 0 ? 'none' : t < 250 ? 'cold' : t > ALERT.brakeMax ? 'bad' : t > ALERT.brakeMax - 100 ? 'warn' : 'ok';
function tyreWidget(c, s, cap){
  const W = 320, H = 214, tw = 92, th = 66, bw = 14, gap = 6;
  const pos = [[18, 30], [W - 18 - tw, 30], [18, 118], [W - 18 - tw, 118]];
  const one = i => {
    const [x, y] = pos[i], left = i % 2 === 0, front = i < 2, p = c.tyre_pressure_psi[i], pk = cls(p, ALERT.psiMin, ALERT.psiMax);
    const temps = cap.tyre_edge_temps ? [c.tyre_temp_inner_c[i], c.tyre_temp_middle_c[i], c.tyre_temp_outer_c[i]] : [0, 0, 0].map(() => coreT(c, i, cap));
    const bands = (left ? temps.slice().reverse() : temps).map((t, k) => `<rect class="t-${tyreState(t)}" x="${x + k * tw / 3}" y="${y}" width="${tw / 3}" height="${th}"/>`).join('');   // outer edge outside
    const grooves = [0.25, 0.5, 0.75].map(f => `<line class="groove" x1="${x + 4}" x2="${x + tw - 4}" y1="${y + th * f}" y2="${y + th * f}"/>`).join('');
    const bx = left ? x + tw + gap : x - gap - bw, ty = front ? y - 9 : y + th + 18, tx = left ? x : x + tw;
    return `<g>${bands}${grooves}<rect class="tyre-edge" x="${x}" y="${y}" width="${tw}" height="${th}" rx="5"/>
      <text class="ty-temp" x="${x + tw / 2}" y="${y + th / 2 + 6}" text-anchor="middle">${fv('temp', coreT(c, i, cap))}°</text>
      <rect class="b-${brakeState(c.brake_temp_c[i])}" x="${bx}" y="${y + 9}" width="${bw}" height="${th - 18}" rx="2"><title>${CORNERS[i]} brake ${fv('temp', c.brake_temp_c[i])} ${un('temp').u}</title></rect>
      <text class="ty-psi ${pk}" x="${tx}" y="${ty}" text-anchor="${left ? 'start' : 'end'}">${fv('press', p)}${pk ? ' !' : ''} <tspan class="u">${un('press').u}</tspan></text></g>`;
  };
  const comp = (s.compound || '').replace(/_?compound/i, '').replace(/_/g, ' ').trim().toUpperCase() || (s.rain_tyres ? 'WET' : 'DRY');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tyres: pressure, core temperature and brake temperature at each corner">
    <rect class="chassis" x="${W / 2 - 34}" y="22" width="68" height="${H - 44}" rx="16"/>
    ${[0, 1, 2, 3].map(one).join('')}
    <text class="ty-comp" x="${W / 2}" y="${H / 2 + 6}" text-anchor="middle">${esc(comp)} ${s.tyre_set || ''}</text></svg>`;
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

// ---------- strategy: a board of modules (board.js arranges them; each draws itself here) ----------
const RAIN = ['Dry', 'Drizzle', 'Light rain', 'Medium rain', 'Heavy rain', 'Storm'];
const GRIP = ['Green', 'Fast', 'Optimum', 'Greasy', 'Damp', 'Wet', 'Flooded'];
let lapsToGo = null, boxLap = null, shownDeg = '';
const stintLaps = () => (summary && summary.stint) || [];
const shown = id => { const m = document.querySelector(`.mod[data-mod="${id}"]`); return m && !m.hidden; };
function renderStrategy(c, s, f, fpl, fuelLaps){
  renderCalc(c, s, fpl);
  renderFuel(c, f, fpl, fuelLaps);
  if (shown('timeline')) renderTimeline(s, fuelLaps);
  if (shown('gaps')) renderGaps(s);
  if (shown('weather')) renderWeather(c, s);
  if (shown('tyres')) renderTyreCar(c, s);
  if (shown('degradation')) renderDegradation();
  if (shown('brakes')) renderPads(c);
  $('bias').innerHTML = unit(c.brake_bias.toFixed(1), '%');
  $('tc').textContent = c.tc_level; $('tcCut').textContent = s.tc_cut; $('abs').textContent = c.abs_level; $('map_').textContent = s.engine_map;
  $('gLat').textContent = c.acc_g[0].toFixed(2); $('gLon').textContent = c.acc_g[2].toFixed(2); $('steer').textContent = c.steer_angle.toFixed(2);
  const dmg = ['front','rear','left','right','centre'].map((n, i) => c.damage[i] > 0 ? ['triangle-alert', `${n} ${c.damage[i].toFixed(0)}`, 'alert'] : null).filter(Boolean);
  setBadges($('damage'), dmg.length ? dmg : [['circle-check', 'no damage', '']]);
}
// Fuel to finish: laps to go (typed, else from the session), plus a reserve, times fuel per lap.
function renderCalc(c, s, fpl){
  const valid = stintLaps().filter(l => l.valid), best = s.best_lap_ms > 0 && s.best_lap_ms < 3.6e6 ? s.best_lap_ms : 0;
  const avg = valid.length ? valid.reduce((a, l) => a + l.ms, 0) / valid.length : best;
  const auto = s.total_laps > 0 ? Math.max(0, s.total_laps - s.completed_laps) : avg && s.session_time_left_ms > 0 ? Math.ceil(s.session_time_left_ms / avg) : null;
  $('calcLaps').placeholder = auto != null ? `${auto} (session)` : 'unknown';
  const typed = $('calcLaps').value, togo = typed !== '' ? +typed : auto, reserve = +$('calcReserve').value || 0;
  const need = fpl && togo != null ? (togo + reserve) * fpl : null, left = fpl ? c.fuel_litres / fpl : null;
  lapsToGo = togo; boxLap = left != null ? s.completed_laps + Math.max(0, Math.floor(left - reserve)) + 1 : null;
  $('calcUsed').textContent = togo != null ? togo : '—';
  $('calcNeed').innerHTML = need != null ? unit(need.toFixed(1), 'L') : '—';
  $('calcTank').innerHTML = unit(c.fuel_litres.toFixed(1), 'L');
  fuelToAdd = need != null ? Math.max(0, need - c.fuel_litres) : null;
  $('calcAdd').innerHTML = fuelToAdd != null ? unit(fuelToAdd.toFixed(1), 'L') : '—';
  $('calcAdd').className = need != null && need > c.fuel_litres ? 'warn' : 'ok';
  $('calcPit').textContent = boxLap != null ? `lap ${boxLap}` : '—';
  const enough = need != null && need <= c.fuel_litres, inLaps = boxLap != null ? boxLap - s.completed_laps - 1 : null;
  $('winLabel').textContent = enough ? 'Fuel' : 'Box by';
  $('winLap').textContent = enough ? 'to the flag' : boxLap != null ? `lap ${boxLap}` : '—';
  $('winIn').textContent = enough ? `${(c.fuel_litres - need).toFixed(1)} L spare` : inLaps == null ? '' : inLaps <= 0 ? 'this lap' : `in ${inLaps} lap${inLaps > 1 ? 's' : ''}`;
  $('winLap').closest('.headline').className = 'headline' + (!enough && inLaps != null && inLaps <= 1 ? ' bad' : '');
}
function renderFuel(c, f, fpl, fuelLaps){
  $('fuel').innerHTML = unit(c.fuel_litres.toFixed(1), 'L'); $('fpl').innerHTML = fpl ? unit(fpl.toFixed(2), 'L') : '—';
  $('fuelLaps').textContent = fuelLaps ? fuelLaps.toFixed(1) : '—'; $('fuelLaps').className = fuelLaps && fuelLaps < ALERT.fuelLaps ? 'bad' : '';
  const st = stintLaps(), last = st.length ? st[st.length - 1].fuel : null, target = lapsToGo > 0 ? c.fuel_litres / lapsToGo : null;
  $('fuelLast').innerHTML = last != null ? unit(last.toFixed(2), 'L') : '—';
  $('fuelTarget').innerHTML = target != null ? unit(target.toFixed(2), 'L') : '—';   // what saving to the flag without a stop would take
  $('fuelTarget').className = target != null && fpl && target < fpl ? 'warn' : '';
  const cap = f.max_fuel > 0 ? f.max_fuel : 0, g = $('fuelGauge');
  $('fuelCap').textContent = cap ? `tank ${cap.toFixed(0)} L` : '';
  g.firstChild.style.width = cap ? Math.min(100, 100 * c.fuel_litres / cap) + '%' : '0';
  g.lastChild.style.left = cap && fpl ? Math.min(100, 100 * ALERT.fuelLaps * fpl / cap) + '%' : '-10px';   // the low-fuel line
  g.classList.toggle('low', !!fuelLaps && fuelLaps < ALERT.fuelLaps);
}
// The stint and the rest of the session on one lap scale: laps run this stint, how far the fuel goes, the latest stop, the flag.
function renderTimeline(s, fuelLaps){
  const now = s.completed_laps, start = now - (summary ? summary.stint_laps : 0);
  const fuelEnd = fuelLaps ? now + fuelLaps : null, end = lapsToGo != null ? now + lapsToGo : null;
  const lo = Math.max(0, start - 1), hi = Math.max(now + 2, fuelEnd || 0, end || 0, boxLap || 0) + 1;
  const x = l => (100 * (Math.min(hi, Math.max(lo, l)) - lo) / (hi - lo)).toFixed(2) + '%';
  const span = (cls, a, b, label) => `<div class="tl-span ${cls}" style="left:${x(a)};width:calc(${x(b)} - ${x(a)})" title="${label}"></div>`;
  const mark = (cls, l, label) => `<div class="tl-mark ${cls}" style="left:${x(l)}"><span>${label}</span></div>`;
  const step = [1, 2, 5, 10, 20, 50].find(k => (hi - lo) / k <= 12) || 100;
  let ticks = ''; for (let l = Math.ceil(lo / step) * step; l <= hi; l += step) ticks += `<span style="left:${x(l)}">${l}</span>`;
  const short = fuelEnd != null && end != null && fuelEnd < end;
  $('timeline').innerHTML = `<div class="tl-track">${span('done', start, now, 'laps this stint')}${fuelEnd != null ? span('fuel' + (short ? ' short' : ''), now, fuelEnd, 'fuel range') : ''}
    ${short && boxLap != null ? mark('box', boxLap, `BOX L${boxLap}`) : ''}${end != null ? mark('flag', end, `FLAG L${Math.round(end)}`) : ''}${mark('now', now, `L${now}`)}</div>
    <div class="tl-scale">${ticks}</div>
    <div class="tl-key"><span><i class="k-done"></i>laps this stint</span><span><i class="${short ? 'k-short' : 'k-fuel'}"></i>fuel range${short ? ': short of the flag' : ''}</span></div>`;
  $('tlInfo').textContent = [fuelLaps ? `${fuelLaps.toFixed(1)} laps of fuel` : '', lapsToGo != null ? `${lapsToGo} to go` : ''].filter(Boolean).join(' · ');
}
function renderGaps(s){
  const gap = ms => ms > 0 && ms < 600000 ? (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s' : '—';
  $('gapPos').textContent = s.position ? 'P' + s.position : '—';
  $('gapAhead').textContent = gap(s.gap_ahead_ms); $('gapBehind').textContent = gap(s.gap_behind_ms);
  $('gapLast').textContent = fmtLap(s.last_lap_ms); $('gapBest').textContent = fmtLap(s.best_lap_ms);
}
function renderWeather(c, s){
  const r = s.rain || [];
  $('rain').innerHTML = ['Now', '10 min', '30 min'].map((t, i) => { const v = r[i] | 0;
    return `<div class="${v >= 3 ? 'warn' : ''}"><small>${t}</small><b>${RAIN[v] || '—'}</b><span class="lvl" aria-hidden="true">${'<i class="on"></i>'.repeat(v)}${'<i></i>'.repeat(5 - v)}</span></div>`; }).join('');
  $('wGrip').textContent = GRIP[s.track_grip] || '—'; $('wGrip').className = s.track_grip >= 3 ? 'warn' : '';
  $('wAir').innerHTML = fvu('temp', c.air_temp_c); $('wRoad').innerHTML = fvu('temp', c.road_temp_c);
}
function renderTyreCar(c, s){
  $('tyCar').innerHTML = tyreWidget(c, s, reading.reading.capabilities || {});
  $('tyInfo').textContent = (s.compound || '').replace(/_/g, ' ') + (s.rain_tyres ? ' · wets' : '');
  $('stint').innerHTML = summary ? unit(summary.stint_laps, 'laps') : '—'; $('tySet').textContent = s.tyre_set || '—';
}
// Lap times of this stint against a fitted line: the slope is what the tyres cost per lap, the closest ACC lets anyone get to wear.
function renderDegradation(){
  const st = stintLaps(), el = $('degChart'), key = JSON.stringify(st.map(l => l.ms)) + el.clientWidth + 'x' + el.clientHeight + S.theme + S.accent;
  if (key === shownDeg) return; shownDeg = key;
  if (st.length < 2) { el.innerHTML = '<div class="empty">Lap times of the stint appear after two laps.</div>'; $('degInfo').textContent = ''; return; }
  const fit = st.slice(st.length > 3 ? 1 : 0).filter(l => l.valid);   // the out-lap and invalid laps say nothing about the tyres
  const n = fit.length, mx = n ? fit.reduce((a, l) => a + l.n, 0) / n : 0, my = n ? fit.reduce((a, l) => a + l.ms, 0) / n : 0;
  const slope = n >= 3 ? fit.reduce((a, l) => a + (l.n - mx) * (l.ms - my), 0) / fit.reduce((a, l) => a + (l.n - mx) ** 2, 0) : null;
  const W = el.clientWidth || 400, H = el.clientHeight || 160, pl = 58, pb = 18, pt = 8, ms = st.map(l => l.ms);
  const lo = Math.min(...ms) - 400, hi = Math.max(...ms) + 200, bw = (W - pl - 4) / st.length;
  const X = i => pl + i * bw, Y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const bars = st.map((l, i) => `<rect class="${l.valid ? 'ok' : 'inv'}" x="${(X(i) + bw * 0.15).toFixed(1)}" y="${Y(l.ms).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${(H - pb - Y(l.ms)).toFixed(1)}"><title>Lap ${l.n} ${fmtLap(l.ms)}${l.valid ? '' : ' (invalid)'}</title></rect>`).join('');
  const labels = st.map((l, i) => st.length <= 16 || i % 2 === 0 ? `<text x="${(X(i) + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${l.n}</text>` : '').join('');
  const fx = i => my + slope * (st[i].n - mx);
  const trend = slope != null ? `<line class="trend" x1="${X(0) + bw / 2}" y1="${Y(fx(0)).toFixed(1)}" x2="${X(st.length - 1) + bw / 2}" y2="${Y(fx(st.length - 1)).toFixed(1)}"/>` : '';
  el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Lap times this stint">
    <text x="${pl - 6}" y="${Y(hi) + 10}" text-anchor="end">${fmtLap(hi)}</text><text x="${pl - 6}" y="${H - pb}" text-anchor="end">${fmtLap(lo)}</text>
    <line class="axis" x1="${pl}" y1="${H - pb}" x2="${W}" y2="${H - pb}"/>${bars}${trend}${labels}</svg>`;
  $('degInfo').textContent = slope == null ? 'trend after 3 valid laps' : `${slope >= 0 ? '+' : '−'}${Math.abs(slope / 1000).toFixed(3)} s/lap`;
  $('degInfo').className = 'r' + (slope > 150 ? ' bad' : slope > 60 ? ' warn' : '');
}
// Pads: millimetres left, the wear per lap measured this stint, and the laps before the low-pad line.
function renderPads(c){
  const st = stintLaps(), a = st[0], b = st[st.length - 1], laps = a && b ? b.n - a.n : 0;
  $('brGrid').innerHTML = [0, 1, 2, 3].map(i => {
    const mm = c.brake_pad_mm[i], rate = laps > 0 ? (a.pads[i] - b.pads[i]) / laps : null, left = rate > 0 ? (mm - ALERT.padMin) / rate : null;
    const k = mm > 0 && mm < ALERT.padMin ? 'bad' : left != null && left < 10 ? 'warn' : '';
    return `<div class="pad ${k}"><small>${CORNERS[i]}</small><b>${mm > 0 ? mm.toFixed(1) : '—'}<span class="u">mm</span></b>
      <div class="gauge${k ? ' low' : ''}" aria-hidden="true"><i style="width:${Math.min(100, 100 * mm / 30)}%"></i><b style="left:${100 * ALERT.padMin / 30}%"></b></div>
      <span>${rate != null ? `${rate.toFixed(3)} mm/lap · ${left != null ? `${Math.max(0, left).toFixed(0)} laps left` : '—'}` : 'wear after 1 lap'}</span>
      <span class="${c.brake_temp_c[i] > ALERT.brakeMax ? 'bad' : ''}">${fv('temp', c.brake_temp_c[i])} ${un('temp').u}</span></div>`; }).join('');
  $('brInfo').textContent = laps ? `measured over ${laps} lap${laps > 1 ? 's' : ''}` : '';
}

// ---------- pit stop: the driver's MFD as the bridge reads it, the plan, and what came back ----------
let pit = null, pitJob = null, fuelToAdd = null;
const PIT_KEY = (() => {   // ?key= from the link bridge.py prints; remembered so the bare address works afterwards
  const k = new URLSearchParams(location.search).get('key');
  try { if (k) localStorage.setItem('engineer.pitkey', k); return k || localStorage.getItem('engineer.pitkey') || ''; } catch (e) { return k || ''; }
})();
const PIT_FIELDS = {fuel:'pFuel', tyre_set:'pSet', tyres:'pTyres', compound:'pCompound', brakes:'pBrakes', front_pad:'pFpad', rear_pad:'pRpad', flip_suspension:'pFlipSusp', flip_bodywork:'pFlipBody'};
const RES_TEXT = {ok:['ok', 'confirmed in the game'], sent:['sent', 'pressed; ACC does not publish it'], skipped:['', ''],
  'switched on for the pressures':['on', 'tyre change switched on: pressures only apply with new tyres']};
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
async function sendPit(only){   // only: one block (fuel, tyres, pressures, brakes, repairs), or the whole plan when absent
  savePit(); $('pitMsg').textContent = only ? `Sending ${only}…` : 'Sending the whole plan…';
  const body = only ? {...S.pit, only:[only]} : S.pit;
  const r = await fetch('/pit', {method:'POST', headers:{'Content-Type':'application/json', 'X-Pit-Key':PIT_KEY}, body:JSON.stringify(body)}).catch(() => null);
  if (r && r.status === 202 && (!only || only === 'repairs')) { $('pFlipSusp').checked = $('pFlipBody').checked = false; savePit(); }   // a switch is one-shot
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
  $('pitLink').textContent = !pit ? 'no pit control on this bridge' : busy ? (pit.waiting_lift ? 'applying, waiting for the driver to lift' : 'applying…') : live ? 'ACC live' + (pit.in_pit_lane ? ' · in pit lane' : '') : `ACC ${pit.status === 'off' ? 'not running' : pit.status}`;
  $('pitApply').disabled = !live || busy; document.querySelectorAll('.pit [data-only]').forEach(b => { b.disabled = !live || busy; });
  // what differs from the driver's MFD right now, where the game says what it holds
  const plan = readPit(), chg = (id, on) => $(id).closest('td').classList.toggle('chg', !!(live && on));
  chg('pFuel', pit && Math.round(pit.fuel) !== plan.fuel); chg('pSet', pit && pit.tyre_set !== plan.tyre_set);
  CORNERS.forEach((c, i) => chg('p' + c, pit && Math.abs(pit.pressures[i] - plan.pressures[i]) > 0.05));
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
// The session's laps as the bridge keeps them (every lap, whenever this page was opened), timing-screen style:
// purple and a diamond for the session best lap and sectors, struck-through grey for invalid laps, OUT/IN for pit laps.
let sessionLaps = [];
function renderLaps(){
  if (shownLaps === lapsVer) return; shownLaps = lapsVer;
  const L = sessionLaps, B = $('lapRows'), clean = L.filter(l => l.valid && !l.out && !l.in);
  const best = Math.min(...clean.map(l => l.ms), Infinity);
  const bestS = [0, 1, 2].map(i => Math.min(...clean.filter(l => l.s.length === 3).map(l => l.s[i]), Infinity));
  const ideal = bestS.every(isFinite) ? bestS.reduce((a, v) => a + v, 0) : null;
  $('sBest').textContent = isFinite(best) ? fmtLap(best) : '—'; $('sTheo').textContent = ideal ? fmtLap(ideal) : '—';
  $('sLast').textContent = L.length ? fmtLap(L[L.length - 1].ms) : '—';
  $('sAvg').textContent = clean.length ? fmtLap(Math.round(clean.reduce((a, l) => a + l.ms, 0) / clean.length)) : '—';
  $('sCount').textContent = L.length || '—';
  if (!L.length) { B.innerHTML = '<tr><td colspan="8" class="empty">No completed laps yet.</td></tr>'; $('lapFoot').innerHTML = ''; return; }
  const cell = (v, isBest, inv) => `<td class="${inv ? 'inv' : isBest ? 'best' : ''}">${fmtLap(v)}</td>`;
  B.innerHTML = L.slice().reverse().map(l => { const inv = !l.valid, top = !inv && l.ms === best;
    const tags = [l.out && 'OUT', l.in && 'IN', inv && 'INVALID'].filter(Boolean).map(t => `<b class="tag${t === 'INVALID' ? ' bad' : ''}">${t}</b>`).join(' ');
    return `<tr><td>${l.n}</td>${cell(l.ms, top, inv)}<td>${top || inv ? '' : fmtDelta(l.ms - best)}</td>${[0, 1, 2].map(i => cell(l.s[i], !inv && l.s[i] === bestS[i], inv)).join('')}<td>${l.fuel != null ? l.fuel.toFixed(2) : '—'}</td><td>${tags}</td></tr>`; }).join('');
  $('lapFoot').innerHTML = ideal ? `<tr><td>Ideal</td><td>${fmtLap(ideal)}</td><td>${isFinite(best) ? fmtDelta(ideal - best) : ''}</td>${bestS.map(v => `<td class="best">${fmtLap(v)}</td>`).join('')}<td></td><td class="note-cell">best sectors added up</td></tr>` : '';
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
  const cat = t => /^Pit plan|^Pressure corrections/.test(t) ? 'PLAN' : /^Lap \d/.test(t) ? 'LAP' : /pit lane/i.test(t) ? 'PIT' : /^Engineer:/.test(t) ? 'ENG' : 'CAR';
  $('evList').innerHTML = events.length ? events.map(e => `<div class="ev s${e.sev}"><time>${hms(e.t)}</time><span class="lp">L${e.lap}</span><b class="tag c-${cat(e.text)}">${cat(e.text)}</b><span>${esc(e.text)}</span></div>`).join('') : '<div class="empty">Events appear here as they happen.</div>';
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
