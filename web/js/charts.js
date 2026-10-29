'use strict';
// Canvas drawing: live channel rows, lap-comparison rows, G-force plot, track map.

function fitCanvas(cv){
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w*dpr) || cv.height !== Math.round(h*dpr)) { cv.width = Math.round(w*dpr); cv.height = Math.round(h*dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); return [g, w, h];
}
function gridLines(g, w, h){
  g.strokeStyle = css('--line'); g.lineWidth = 1; g.beginPath();
  for (let k = 1; k < 4; k++) { const y = Math.round(h*k/4) + .5; g.moveTo(0, y); g.lineTo(w, y); }
  g.stroke();
}
function cursorLine(g, x, h){ g.strokeStyle = css('--txt'); g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(Math.round(x) + .5, 0); g.lineTo(Math.round(x) + .5, h); g.stroke(); g.setLineDash([]); }
const scale = (v, lo, hi, h) => h - 3 - (h - 6) * Math.max(0, Math.min(1, (v - lo) / ((hi - lo) || 1)));

// ---------- live rows (time axis, newest at the right) ----------
const TYRE_COL = ['--c-fl', '--c-fr', '--c-rl', '--c-rr'];
const ROWDEFS = {
  speed:{label:'Speed', series:[{k:'speed', name:() => un('speed').u, color:'--c-speed', min:0, max:() => 320, fmt:v => fv('speed', v)}]},
  pedals:{label:'Throttle & brake', series:[{k:'thr', name:'throttle', color:'--c-thr', min:0, max:() => 1, fmt:v => (100*v).toFixed(0) + '%'}, {k:'brk', name:'brake', color:'--c-brk', min:0, max:() => 1, fmt:v => (100*v).toFixed(0) + '%'}]},
  steer:{label:'Steering', series:[{k:'steer', name:'angle', color:'--c-steer', sym:true, fmt:v => v.toFixed(2)}]},
  gearrpm:{label:'Gear & RPM', series:[{k:'rpm', name:'rpm', color:'--c-rpm', min:0, max:() => maxRpm || 8000, fmt:v => v.toFixed(0)}, {k:'gear', name:'gear', color:'--c-gear', min:0, max:() => 8, fmt:v => v < 0 ? 'R' : v === 0 ? 'N' : v.toFixed(0)}]},
  gforce:{label:'G-force', series:[{k:'gLat', name:'lateral', color:'--c-steer', sym:true, fmt:v => v.toFixed(2)}, {k:'gLon', name:'longitudinal', color:'--c-rpm', sym:true, fmt:v => v.toFixed(2)}]},
  tyretemp:{label:'Tyre core temperature', series:CORNERS.map((n, i) => ({k:'t' + n, name:n, color:TYRE_COL[i], min:20, max:() => 140, fmt:v => fv('temp', v)}))},
  tyrepsi:{label:'Tyre pressure', series:CORNERS.map((n, i) => ({k:'p' + n, name:n, color:TYRE_COL[i], min:20, max:() => 36, fmt:v => fv('press', v)}))},
  fuel:{label:'Fuel', series:[{k:'fuel', name:'litres', color:'--c-speed', min:0, max:() => fuelMax || 100, fmt:v => v.toFixed(1)}]},
};
const PRESETS = {Driving:['speed', 'pedals', 'steer', 'gearrpm'], Powertrain:['speed', 'gearrpm', 'pedals', 'fuel'], Tyres:['tyretemp', 'tyrepsi', 'gforce', 'speed'], All:Object.keys(ROWDEFS)};
let hover = null;                  // sample index under the pointer, or null

function buildRows(){
  const rows = S.rows.filter(id => ROWDEFS[id]);
  $('chartRows').innerHTML = rows.map(id => { const d = ROWDEFS[id];
    return `<div class="crow"><div class="chead"><b>${d.label}</b>${d.series.map(s => `<span><i style="background:var(${s.color})"></i>${typeof s.name === 'function' ? s.name() : s.name} <em id="v-${s.k}">—</em></span>`).join('')}</div><canvas data-row="${id}" aria-label="${d.label} trace"></canvas></div>`; }).join('')
    || '<div class="empty">No channels selected.</div>';
  $('chartRows').querySelectorAll('canvas').forEach(cv => {
    cv.addEventListener('mousemove', e => { const T = frozen || trace, b = cv.getBoundingClientRect(); const k = Math.round(T.n - (1 - (e.clientX - b.left) / b.width) * TRACE_N); hover = k < 0 || k >= T.n ? null : k; drawCharts(); });
    cv.addEventListener('mouseleave', () => { hover = null; drawCharts(); });
  });
  $('picks').innerHTML = Object.entries(ROWDEFS).map(([id, d]) => `<button class="pick" data-id="${id}" aria-pressed="${rows.includes(id)}">${d.label}</button>`).join('');
}
function drawCharts(){
  const T = frozen || trace, n = T.n;
  $('cursorInfo').textContent = frozen ? (hover != null ? `paused · ${((n - hover) / 30).toFixed(1)} s before` : 'paused') : hover != null ? `${((n - hover) / 30).toFixed(1)} s ago` : 'last 60 s · hover to read values';   // ponytail: assumes the 30 Hz reading rate
  document.querySelectorAll('#chartRows canvas').forEach(cv => {
    const row = ROWDEFS[cv.dataset.row], [g, w, h] = fitCanvas(cv);
    gridLines(g, w, h); if (!n) return;
    const xOf = k => w - (n - k) * w / TRACE_N, val = (arr, k) => arr[(T.i - n + k + TRACE_N) % TRACE_N];
    let sym = 0.05; for (const s of row.series) if (s.sym) for (let k = 0; k < n; k++) sym = Math.max(sym, Math.abs(val(T[s.k], k)));
    for (const s of row.series) {
      const arr = T[s.k], lo = s.sym ? -sym : s.min, hi = s.sym ? sym : s.max();
      g.beginPath(); for (let k = 0; k < n; k++) { const y = scale(val(arr, k), lo, hi, h); k ? g.lineTo(xOf(k), y) : g.moveTo(xOf(k), y); }
      g.strokeStyle = css(s.color); g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
      const el = $('v-' + s.k); if (el) el.textContent = s.fmt(val(arr, hover != null ? hover : n - 1));
    }
    if (hover != null) cursorLine(g, xOf(hover), h);
  });
}

// ---------- lap comparison rows (track position axis) ----------
const CROWS = [
  {id:'speed', label:'Speed', k:'speed', min:0, max:d => Math.max(100, ...d), fmt:v => fv('speed', v)},
  {id:'delta', label:'Time delta (cmp − ref)', delta:true},
  {id:'thr', label:'Throttle', k:'thr', min:0, max:() => 1, fmt:v => (100*v).toFixed(0) + '%'},
  {id:'brk', label:'Brake', k:'brk', min:0, max:() => 1, fmt:v => (100*v).toFixed(0) + '%'},
  {id:'steer', label:'Steering', k:'steer', sym:true, fmt:v => v.toFixed(2)},
  {id:'gear', label:'Gear', k:'gear', min:0, max:() => 8, fmt:v => v < 0 ? 'R' : v === 0 ? 'N' : v.toFixed(0)},
];
let cmpHover = null;               // bin index under the pointer
function buildCmpRows(){
  $('cmpRows').innerHTML = CROWS.map(r => `<div class="crow"><div class="chead"><b>${r.label}</b></div><canvas data-row="${r.id}" aria-label="${r.label} comparison"></canvas></div>`).join('');
  $('cmpRows').querySelectorAll('canvas').forEach(cv => {
    cv.addEventListener('mousemove', e => { const b = cv.getBoundingClientRect(); cmpHover = Math.max(0, Math.min(NB - 1, Math.round((e.clientX - b.left) / b.width * (NB - 1)))); drawCompare(); });
    cv.addEventListener('mouseleave', () => { cmpHover = null; drawCompare(); });
  });
}
function deltaSeries(ref, cmp){ const d = new Float32Array(NB); for (let i = 0; i < NB; i++) d[i] = cmp.data.t[i] - ref.data.t[i]; return d; }
function drawCompare(){
  const ref = lapById(selRef), cmp = lapById(selCmp);
  document.querySelectorAll('#cmpRows canvas').forEach(cv => {
    const row = CROWS.find(r => r.id === cv.dataset.row), [g, w, h] = fitCanvas(cv);
    gridLines(g, w, h); if (!ref) return;
    const xOf = i => i / (NB - 1) * w;
    if (row.delta) {
      if (!cmp) return;
      const d = deltaSeries(ref, cmp); let m = 50; for (const v of d) m = Math.max(m, Math.abs(v));
      const y0 = h / 2; g.strokeStyle = css('--line'); g.beginPath(); g.moveTo(0, y0 + .5); g.lineTo(w, y0 + .5); g.stroke();
      g.beginPath(); g.moveTo(0, y0); for (let i = 0; i < NB; i++) g.lineTo(xOf(i), y0 - (d[i] / m) * (h / 2 - 3)); g.lineTo(w, y0); g.closePath();
      g.fillStyle = 'rgba(255,107,94,.22)'; g.fill();   // above the line: comparison is behind
      g.beginPath(); for (let i = 0; i < NB; i++) { const y = y0 - (d[i] / m) * (h / 2 - 3); i ? g.lineTo(xOf(i), y) : g.moveTo(xOf(i), y); }
      g.strokeStyle = css('--txt'); g.lineWidth = 1.5; g.stroke();
    } else {
      let lo = row.min, hi = row.max ? row.max(ref.data[row.k]) : 1;
      if (row.sym) { let m = 0.05; for (const l of [ref, cmp]) if (l) for (const v of l.data[row.k]) m = Math.max(m, Math.abs(v)); lo = -m; hi = m; }
      for (const [l, col] of [[ref, '--c-speed'], [cmp, '--c-cmp']]) {
        if (!l) continue; const a = l.data[row.k];
        g.beginPath(); for (let i = 0; i < NB; i++) { const y = scale(a[i], lo, hi, h); i ? g.lineTo(xOf(i), y) : g.moveTo(xOf(i), y); }
        g.strokeStyle = css(col); g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
      }
    }
    if (cmpHover != null) cursorLine(g, xOf(cmpHover), h);
  });
  // readout at the cursor
  const i = cmpHover, set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('at-pos', i == null ? '—' : (100 * i / (NB - 1)).toFixed(1) + ' %');
  for (const [k, f] of [['speed', v => fv('speed', v)], ['thr', v => (100*v).toFixed(0) + '%'], ['brk', v => (100*v).toFixed(0) + '%'], ['steer', v => v.toFixed(2)], ['gear', v => v.toFixed(0)], ['rpm', v => v.toFixed(0)]]) {
    set(`at-${k}-r`, i == null || !ref ? '—' : f(ref.data[k][i])); set(`at-${k}-c`, i == null || !cmp ? '—' : f(cmp.data[k][i]));
  }
  set('at-delta', i == null || !ref || !cmp ? '—' : fmtDelta(cmp.data.t[i] - ref.data.t[i]) + ' s');
}

// ---------- G-force plot (friction circle) ----------
function drawGG(){
  const T = frozen || trace, cv = $('gg'), [g, w, h] = fitCanvas(cv), n = T.n;
  const R = Math.min(w, h) / 2 - 14, cx = w / 2, cy = h / 2; let m = 1.5; const val = (a, k) => a[(T.i - n + k + TRACE_N) % TRACE_N];
  for (let k = 0; k < n; k++) m = Math.max(m, Math.abs(val(T.gLat, k)), Math.abs(val(T.gLon, k)));
  m = Math.ceil(m * 2) / 2; const px = v => cx + v / m * R, py = v => cy - v / m * R;
  g.strokeStyle = css('--line'); g.lineWidth = 1; g.fillStyle = css('--mut'); g.font = '11px ' + getComputedStyle(document.body).fontFamily; g.textAlign = 'left';
  for (let r = 0.5; r <= m + .01; r += 0.5) { g.beginPath(); g.arc(cx, cy, r / m * R, 0, 7); g.stroke(); if (r % 1 === 0) g.fillText(r + ' g', cx + 4, cy - r / m * R - 3); }
  g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
  if (!n) return;
  const from = Math.max(0, n - 150);                                  // last ~5 s as a trail
  g.fillStyle = 'rgba(77,163,255,.35)'; for (let k = from; k < n; k++) { g.beginPath(); g.arc(px(val(T.gLat, k)), py(val(T.gLon, k)), 2, 0, 7); g.fill(); }
  const x = val(T.gLat, n - 1), y = val(T.gLon, n - 1);
  g.beginPath(); g.arc(px(x), py(y), 5, 0, 7); g.fillStyle = css('--acc'); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
  let pk = 0; for (let k = 0; k < n; k++) pk = Math.max(pk, Math.hypot(val(T.gLat, k), val(T.gLon, k)));
  $('ggInfo').textContent = `now ${Math.hypot(x, y).toFixed(2)} g · peak ${pk.toFixed(2)} g`;
}

// ---------- map ----------
function trackFor(name){ if (!name) return null; name = name.toLowerCase(); if (/nurburgring_24h|nordschleife/.test(name)) return TRACKS.nurburgring_24h; return null; }
const trail = [];                  // recent map positions
function drawMap(r){
  const cv = $('map'), [g, w, h] = fitCanvas(cv);
  const t = r && trackFor(r.fixed.track), font = getComputedStyle(document.body).fontFamily;
  if (t) {
    const pad = 22, sc = Math.min((w - 2*pad)/t.box[0], (h - 2*pad)/t.box[1]), ox = (w - t.box[0]*sc)/2, oy = (h - t.box[1]*sc)/2;
    const P = p => [ox + p[0]*sc, oy + p[1]*sc];
    g.lineJoin = g.lineCap = 'round';
    g.beginPath(); t.pit.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.strokeStyle = '#3a404c'; g.lineWidth = 2; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);
    g.beginPath(); t.loop.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.strokeStyle = '#262b33'; g.lineWidth = 7; g.stroke(); g.strokeStyle = '#6b7383'; g.lineWidth = 3; g.stroke();
    g.font = `${Math.max(8, 9*sc)}px ${font}`; g.fillStyle = 'rgba(139,145,156,.8)'; g.textBaseline = 'middle';
    for (const [x, y, s] of t.labels) g.fillText(s, ox + x*sc, oy + y*sc);
    const [sx, sy] = P(t.loop[0]); g.fillStyle = '#e8eaee'; g.fillRect(sx - 5, sy - 1.5, 10, 3);
    const pos = r.session.track_position, i = Math.max(0, Math.min(t.loop.length - 1, Math.floor(pos * t.loop.length)));
    const [x, y] = P(t.loop[i]);
    trail.push([x, y]); if (trail.length > 90) trail.shift();
    g.strokeStyle = 'rgba(77,163,255,.5)'; g.lineWidth = 3; g.beginPath(); trail.forEach(([a, b], k) => k ? g.lineTo(a, b) : g.moveTo(a, b)); g.stroke();
    g.beginPath(); g.arc(x, y, 7, 0, 7); g.fillStyle = r.session.in_pit_lane ? '#f0a030' : '#4da3ff'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
    $('mapInfo').textContent = `${(pos*100).toFixed(1)} % of lap`;
    return;
  }
  // No layout for this track: draw the line the car has driven, from its world coordinates.
  if (r && learned.length > 2) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of learned) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const pad = 20, sc = Math.min((w - 2*pad)/Math.max(1, x1 - x0), (h - 2*pad)/Math.max(1, y1 - y0)), ox = (w - (x1 - x0)*sc)/2 - x0*sc, oy = (h - (y1 - y0)*sc)/2 - y0*sc;
    g.beginPath(); learned.forEach(([x, y], i) => i ? g.lineTo(ox + x*sc, oy + y*sc) : g.moveTo(ox + x*sc, oy + y*sc)); g.strokeStyle = '#6b7383'; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke();
    const p = r.session.car_position_m; g.beginPath(); g.arc(ox + p[0]*sc, oy + p[2]*sc, 6, 0, 7); g.fillStyle = '#4da3ff'; g.fill();
    $('mapInfo').textContent = `${(r.session.track_position*100).toFixed(1)} % · learnt from the driving`;
  } else {
    g.fillStyle = '#8b919c'; g.font = '13px ' + font; g.textAlign = 'center';
    g.fillText(r ? 'No layout for this track. The map is drawn as the car laps it.' : 'Waiting for the driver.', w/2, h/2);
    $('mapInfo').textContent = '';
  }
}
