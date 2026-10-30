'use strict';
// charts.js (D2): canvas drawing for the modules, one call per canvas: live channels, lap-comparison traces, G-G and the
// track map. Nothing here owns a canvas or reads the DOM by id; every colour comes from Pit.tokens() (theme-aware).

function fitCanvas(cv){
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); return [g, w, h];
}
const chGrid = (g, w, h, tk) => { g.strokeStyle = tk.line; g.lineWidth = 1; g.beginPath(); for (let k = 1; k < 4; k++) { const y = Math.round(h * k / 4) + .5; g.moveTo(0, y); g.lineTo(w, y); } g.stroke(); };
const chY = (v, lo, hi, top, h) => top + h - 3 - (h - 6) * Math.max(0, Math.min(1, (v - lo) / ((hi - lo) || 1)));
function chCursor(g, x, h, tk){ g.strokeStyle = tk.text; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(Math.round(x) + .5, 0); g.lineTo(Math.round(x) + .5, h); g.stroke(); g.setLineDash([]); }
// A value label on the line: a --bg box with the value in the series colour.
function chTag(g, x, y, text, color, tk, w){
  g.font = `600 10px ${tk.num}`; const tw = g.measureText(text).width + 6, left = x + 6 + tw > w ? x - 6 - tw : x + 6, top = Math.round(y - 7);
  g.fillStyle = tk.bg; g.fillRect(left, top, tw, 14); g.strokeStyle = color; g.lineWidth = 1; g.strokeRect(left + .5, top + .5, tw - 1, 13);
  g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(text, left + 3, top + 7.5);
}
function chLabel(g, x, y, parts, tk){   // lane title and readouts, left to right: [[text, colour], …] on a --bg strip
  g.font = `600 10px ${tk.font}`; g.textBaseline = 'top'; g.textAlign = 'left';
  let cx = x; const ws = parts.map(([t]) => g.measureText(t).width + 8), tot = ws.reduce((a, b) => a + b, 0);
  g.fillStyle = tk.bg; g.fillRect(x - 2, y - 1, tot + 2, 13);   // opaque: a title over a trace must stay readable
  parts.forEach(([t, col], i) => { g.fillStyle = col; g.fillText(t, cx, y); cx += ws[i]; });
}

// ---------- live channels (time axis, newest at the right) ----------
const ROWDEFS = {
  speed:{label:'Speed', series:[{k:'speed', name:() => un('speed').u, c:'chSpeed', min:0, max:() => 320, fmt:v => fv('speed', v)}]},
  pedals:{label:'Throttle & brake', series:[{k:'thr', name:'thr', c:'chThr', min:0, max:() => 1, fmt:v => (100 * v).toFixed(0) + '%'}, {k:'brk', name:'brk', c:'chBrk', min:0, max:() => 1, fmt:v => (100 * v).toFixed(0) + '%'}]},
  steer:{label:'Steering', series:[{k:'steer', name:'angle', c:'chSteer', sym:true, fmt:v => v.toFixed(2)}]},
  gearrpm:{label:'Gear & RPM', series:[{k:'rpm', name:'rpm', c:'chRpm', min:0, max:() => REC.maxRpm || 8000, fmt:v => v.toFixed(0)}, {k:'gear', name:'gear', c:'chGear', min:0, max:() => 8, fmt:v => v < 0 ? 'R' : v === 0 ? 'N' : v.toFixed(0)}]},
  gforce:{label:'G-force', series:[{k:'gLat', name:'lat', c:'chSteer', sym:true, fmt:v => v.toFixed(2)}, {k:'gLon', name:'long', c:'chRpm', sym:true, fmt:v => v.toFixed(2)}]},
  tyretemp:{label:'Tyre core', series:CORNERS.map((n, i) => ({k:'t' + n, name:n, c:'ch' + n, min:20, max:() => 140, fmt:v => fv('temp', v)}))},
  tyrepsi:{label:'Tyre pressure', series:CORNERS.map((n, i) => ({k:'p' + n, name:n, c:'ch' + n, min:20, max:() => 36, fmt:v => fv('press', v)}))},
  fuel:{label:'Fuel', series:[{k:'fuel', name:'L', c:'chSpeed', min:0, max:() => REC.fuelMax || 100, fmt:v => v.toFixed(1)}]},
};
// rows: ROWDEFS ids; T: the ring (live or frozen); win: samples shown; hover: samples back from the newest, or null.
// Returns the first row's first series min/max over the window, for the header.
function drawLive(cv, rows, T, hover, o){
  const [g, w, h] = fitCanvas(cv), tk = Pit.tokens(), win = o.win, n = Math.min(T.n, win), lh = h / Math.max(1, rows.length);
  const at = (arr, k) => arr[(T.i - n + k + TRACE_N) % TRACE_N], xOf = k => w - (n - 1 - k) * w / Math.max(1, win - 1);
  const hk = hover == null ? n - 1 : Math.max(0, n - 1 - hover);
  let range = null;
  rows.forEach((id, r) => {
    const def = ROWDEFS[id]; if (!def) return;
    const top = r * lh, tb = 16;   // a title band per lane: the plot starts under it, so the title never covers a trace
    g.save(); g.translate(0, top + tb); chGrid(g, w, lh - tb, tk); g.restore();
    if (r) { g.strokeStyle = tk.line; g.beginPath(); g.moveTo(0, Math.round(top) + .5); g.lineTo(w, Math.round(top) + .5); g.stroke(); }
    let sym = 0.05;
    for (const s of def.series) if (s.sym) for (let k = 0; k < n; k++) sym = Math.max(sym, Math.abs(at(T[s.k], k)));
    const parts = [[def.label.toUpperCase(), tk.dim]];
    for (const s of def.series) {
      const arr = T[s.k], lo = s.sym ? -sym : s.min, hi = s.sym ? sym : s.max();
      if (n > 1) {
        g.beginPath(); for (let k = 0; k < n; k++) { const y = chY(at(arr, k), lo, hi, top + tb, lh - tb); k ? g.lineTo(xOf(k), y) : g.moveTo(xOf(k), y); }
        g.strokeStyle = tk[s.c]; g.lineWidth = 1.5; g.lineJoin = 'round'; g.stroke();
      }
      if (!range && n) { let a = Infinity, b = -Infinity; for (let k = 0; k < n; k++) { const v = at(arr, k); a = Math.min(a, v); b = Math.max(b, v); } range = {lo:a, hi:b, s}; }
      parts.push([`${typeof s.name === 'function' ? s.name() : s.name} ${n ? s.fmt(at(arr, hk)) : '—'}`, tk[s.c]]);
    }
    chLabel(g, 6, top + 3, parts, tk);
  });
  if (hover != null && n) chCursor(g, xOf(hk), h, tk);
  return range;
}

// ---------- lap comparison traces (distance axis), MoTeC lane order ----------
const LANES = {
  delta:{label:'Δ time · below = CMP faster'},
  speed:{label:'Speed', ser:[['speed', null]], fmt:v => fv('speed', v), u:() => un('speed').u, min:0, max:(a, b) => Math.max(100, ...a, ...(b || []))},
  pedals:{label:'Throttle & brake', ser:[['thr', 'chThr'], ['brk', 'chBrk']], fmt:v => (100 * v).toFixed(0), u:() => '%', min:0, max:() => 1},
  steer:{label:'Steering', ser:[['steer', null]], fmt:v => v.toFixed(2), sym:true},
  gear:{label:'Gear', ser:[['gear', null]], fmt:v => v.toFixed(0), min:0, max:() => 7},
  rpm:{label:'RPM', ser:[['rpm', null]], fmt:v => v.toFixed(0), u:() => 'rpm', min:0, max:(a, b) => Math.max(1000, ...a, ...(b || []))},
};
// ref, cmp: laps with .data; cursor: 0..1 or null; o.len: track length in metres (0: percent).
// Each lane: a 14 px title band, then the plot with its axis range at the right edge; 6 px and a rule between lanes.
// Returns {lh, axis, range}: range = the first value lane's data min and max over both laps, for the module header.
function drawTraces(cv, lanes, ref, cmp, cursor, o){
  const [g, w, h] = fitCanvas(cv), tk = Pit.tokens(), axis = 16, TB = 14, GAP = 6, n = Math.max(1, lanes.length), lh = (h - axis - GAP * (n - 1)) / n, xOf = i => i / (NB - 1) * w;
  const ci = cursor == null ? null : Math.round(cursor * (NB - 1)), tags = [];
  let range = null;
  const edge = (y, t, base) => {   // an axis figure at the lane's right edge, on a --bg strip so a trace under it stays readable
    g.font = `500 10px ${tk.num}`; g.textAlign = 'right'; g.textBaseline = base;
    const tw = g.measureText(t).width + 6, y0 = base === 'top' ? y - 1 : y - 12;
    g.fillStyle = tk.bg; g.globalAlpha = .85; g.fillRect(w - tw - 2, y0, tw + 2, 13); g.globalAlpha = 1; g.fillStyle = tk.dim; g.fillText(t, w - 4, y);
  };
  lanes.forEach((id, r) => {
    const L = LANES[id]; if (!L || !ref) return;
    const top = r * (lh + GAP), pt = top + TB, ph = lh - TB;   // plot top and height, under the title band
    if (r) { g.strokeStyle = tk.line; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Math.round(top - GAP / 2) + .5); g.lineTo(w, Math.round(top - GAP / 2) + .5); g.stroke(); }
    g.save(); g.translate(0, pt); chGrid(g, w, ph, tk); g.restore();
    const parts = [[L.label.toUpperCase(), tk.dim]];
    if (id === 'delta') {
      if (cmp) {
        const d = new Float32Array(NB); let m = 50; for (let i = 0; i < NB; i++) { d[i] = cmp.data.t[i] - ref.data.t[i]; m = Math.max(m, Math.abs(d[i])); }
        const y0 = pt + ph / 2, yv = v => y0 - v / m * (ph / 2 - 3);
        for (const [sign, col] of [[1, tk.bad], [-1, tk.ok]]) {   // above zero: CMP losing; below: gaining
          g.beginPath(); g.moveTo(0, y0); for (let i = 0; i < NB; i++) g.lineTo(xOf(i), yv(sign > 0 ? Math.max(0, d[i]) : Math.min(0, d[i]))); g.lineTo(w, y0); g.closePath();
          g.fillStyle = col; g.globalAlpha = .3; g.fill(); g.globalAlpha = 1;
        }
        g.strokeStyle = tk.line; g.beginPath(); g.moveTo(0, Math.round(y0) + .5); g.lineTo(w, Math.round(y0) + .5); g.stroke();
        g.beginPath(); for (let i = 0; i < NB; i++) i ? g.lineTo(xOf(i), yv(d[i])) : g.moveTo(0, yv(d[i])); g.strokeStyle = tk.text; g.lineWidth = 1.5; g.stroke();
        edge(pt + 1, `+${(m / 1000).toFixed(2)} s`, 'top'); edge(pt + ph - 1, `${MINUS}${(m / 1000).toFixed(2)} s`, 'bottom');
        if (ci != null) tags.push([xOf(ci), yv(d[ci]), fmtDelta(d[ci]), tk.text]);
      } else parts.push(['needs a CMP lap', tk.dim]);
    } else {
      let lo = L.min, hi = L.max ? L.max(ref.data[L.ser[0][0]], cmp && cmp.data[L.ser[0][0]]) : 1;
      if (L.sym) { let m = 0.05; for (const l of [ref, cmp]) if (l) for (const v of l.data.steer) m = Math.max(m, Math.abs(v)); lo = -m; hi = m; }
      for (const [lap, dash, base] of [[ref, false, tk.chRef], [cmp, true, tk.chCmp]]) {
        if (!lap) continue;
        for (const [k, cc] of L.ser) {
          const a = lap.data[k], col = cc ? tk[cc] : base;
          g.beginPath(); for (let i = 0; i < NB; i++) { const y = chY(a[i], lo, hi, pt, ph); i ? g.lineTo(xOf(i), y) : g.moveTo(0, y); }
          g.strokeStyle = col; g.lineWidth = dash ? 1.25 : 1.5; g.setLineDash(dash ? [4, 3] : []); g.lineJoin = 'round'; g.stroke(); g.setLineDash([]);
          if (ci != null) tags.push([xOf(ci), chY(a[ci], lo, hi, pt, ph), (dash ? 'C ' : 'R ') + L.fmt(a[ci]), col]);
        }
      }
      const u = L.u ? ' ' + L.u() : '';
      edge(pt + 1, L.fmt(hi) + u, 'top'); edge(pt + ph - 1, L.fmt(lo) + u, 'bottom');
      if (!range) {
        let a = Infinity, b = -Infinity; for (const l of [ref, cmp]) if (l) for (const v of l.data[L.ser[0][0]]) { if (v < a) a = v; if (v > b) b = v; }
        if (a <= b) range = {label:L.label, lo:L.fmt(a), hi:L.fmt(b), u:L.u ? L.u() : ''};
      }
    }
    chLabel(g, 6, top + 1, parts, tk);
  });
  // distance axis
  g.font = `500 10px ${tk.num}`; g.fillStyle = tk.dim; g.textBaseline = 'bottom';
  const len = o.len > 0 ? o.len : 100, step = [100, 200, 250, 500, 1000, 2000].find(s => len / s * 56 < w) || 5000;
  for (let x = 0; x <= len; x += o.len > 0 ? step : 10) { const px = x / len * w; g.textAlign = px < 20 ? 'left' : px > w - 30 ? 'right' : 'center'; g.fillText(o.len > 0 ? x + ' m' : x + ' %', px, h - 2); }
  if (ci != null) { chCursor(g, xOf(ci), h - axis, tk); for (const [x, y, t, c] of tags) chTag(g, x, y, t, c, tk, w); }
  return {lh, axis, range};
}

// ---------- G-G (friction circle) from the live ring ----------
function drawGG(cv, o){
  const T = o.T, [g, w, h] = fitCanvas(cv), tk = Pit.tokens(), n = T.n, at = (a, k) => a[(T.i - n + k + TRACE_N) % TRACE_N];
  const R = Math.min(w, h) / 2 - 16, cx = w / 2, cy = h / 2, m = clamp(Math.max(REC.gHist.maxLat, REC.gHist.maxLon) * 1.15, 1.5, 3), px = v => cx + v / m * R, py = v => cy - v / m * R;
  g.strokeStyle = tk.line; g.lineWidth = 1; g.font = `500 10px ${tk.num}`; g.fillStyle = tk.dim; g.textAlign = 'left'; g.textBaseline = 'bottom';
  for (const r of [1, 2, 3].filter(r => r < m)) { const rr = r / m * R; g.beginPath(); g.arc(cx, cy, rr, 0, 7); g.stroke(); g.fillText(r + ' g', cx + rr * .707 + 3, cy - rr * .707 - 3); }
  g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
  if (!n) return;
  const from = Math.max(0, n - (o.trail || 150));   // the last ~5 s as a trail
  g.fillStyle = tk.chLap; g.globalAlpha = .35;
  for (let k = from; k < n; k++) { g.beginPath(); g.arc(px(at(T.gLat, k)), py(at(T.gLon, k)), 2, 0, 7); g.fill(); }
  g.globalAlpha = 1;
  g.beginPath(); g.arc(px(at(T.gLat, n - 1)), py(at(T.gLon, n - 1)), 5, 0, 7); g.fillStyle = tk.accent; g.fill(); g.strokeStyle = tk.bg; g.lineWidth = 1.5; g.stroke();
}

// ---------- the track map: recorded racing lines, the field, zoom, pan, follow ----------
function trackFor(name){ if (!name || typeof TRACKS === 'undefined') return null; name = name.toLowerCase(); return Object.hasOwn(TRACKS, name) ? TRACKS[name] : /nurburgring_24h|nordschleife/.test(name) ? TRACKS.nurburgring_24h : null; }
function cumOf(pts){                // cumulative distance along a line, cached on the array
  if (pts._cum) return pts._cum;
  const c = new Float64Array(pts.length); for (let i = 1; i < pts.length; i++) c[i] = c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  Object.defineProperty(pts, '_cum', {value:c}); return c;
}
function atFrac(pts, f){            // the point a fraction f of the way along the line, by distance
  const c = cumOf(pts), d = ((f % 1) + 1) % 1 * c[c.length - 1]; let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] < d) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], t = c[hi] > c[lo] ? (d - c[lo]) / (c[hi] - c[lo]) : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function atSpl(pts, s){             // the point at ACC's lap fraction s (each point carries it); lines without it fall back to distance
  const n = pts.length - 1;
  if (n < 1 || pts[0].length < 3 || pts[n].length < 3) return atFrac(pts, s);
  s = ((s % 1) + 1) % 1; let lo = 0, hi = n;
  if (s <= pts[0][2]) return [pts[0][0], pts[0][1]];
  if (s >= pts[n][2]) return [pts[n][0], pts[n][1]];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][2] < s) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], t = b[2] > a[2] ? (s - a[2]) / (b[2] - a[2]) : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
const PIT_LOCS =['pit', 'entry', 'exit'];
// a car in the pit lane sits where its track position is, so draw it at the nearest point of the drawn pit lane instead
// (within 150 m; no pit lane drawn for the track, or none that near: it stays where it is)
function onPitLane(pit, q){
  let best = null, bd = 150 * 150;
  for (let i = 0; i < pit.length - 1; i++) {
    const [ax, az] = pit[i], dx = pit[i + 1][0] - ax, dz = pit[i + 1][1] - az, l2 = dx * dx + dz * dz;
    const t = l2 ? clamp(((q[0] - ax) * dx + (q[1] - az) * dz) / l2, 0, 1) : 0, x = ax + t * dx, z = az + t * dz, d = (x - q[0]) ** 2 + (z - q[1]) ** 2;
    if (d < bd) { bd = d; best = [x, z]; }
  }
  return best || q;
}
// The field comes every 250 ms or so: between updates each car carries on at its own pace, and the step a new update makes
// is blended away over ~150 ms, so the dots glide instead of jumping. SMOOTH: car index -> {s, t, v, e, te, last}.
const SMOOTH = new Map();
function smoothSpl(car, now){
  const wrap = d => d - Math.round(d), m = SMOOTH.get(car.i);
  const shown = m => m.s + m.v * Math.min(now - m.t, 1000) + m.e * Math.exp(-(now - m.te) / 150);   // ponytail: 1 s at most on a stalled feed
  if (!m) { SMOOTH.set(car.i, {s:car.spl, t:now, v:0, e:0, te:now, last:car.spl}); return car.spl; }
  if (car.spl !== m.s) {
    const d = wrap(car.spl - m.s), dt = now - m.t, was = shown(m), jump = Math.abs(d) > 0.05 || dt > 2000;   // a reset or a pit teleport: no glide
    m.v = jump || dt < 30 ? (jump ? 0 : m.v) : m.v ? (m.v + d / dt) / 2 : d / dt;
    m.e = jump ? 0 : Math.abs(wrap(was - car.spl)) < 0.02 ? wrap(was - car.spl) : 0;
    m.s = car.spl; m.t = m.te = now;
    if (jump) m.last = car.spl;
  }
  const p = shown(m), back = wrap(p - m.last);
  if (back >= 0 || back <= -0.01) m.last = p;   // a correction never slides a car backwards: it holds until the car catches up
  return ((m.last % 1) + 1) % 1;
}
// tracks.js layouts have their own frame and ACC's x/z another. A line whose points carry the lap fraction (a third of a lap
// is enough) fixes the similarity between them: rotation, scale, shift, mirrored or not, and a start line up to 5 % off.
// ALIGN: track -> {key, B} where B is the layout in ACC's frame ({loop (closed), pit, labels}), or B null when nothing fits.
const ALIGN = new Map();
function alignLayout(name, t, pts){
  if (!pts || pts.length < 30 || pts[0].length < 3) return null;
  let q0 = 1, q1 = 0; for (const q of pts) { if (q[2] < q0) q0 = q[2]; if (q[2] > q1) q1 = q[2]; }
  if (q1 - q0 < 0.3) return null;
  const key = `${Math.floor(pts.length / 50)}:${pts[0][0]}`, had = ALIGN.get(name);   // ponytail: a growing line refits every 50 points
  if (had && had.key === key) return had.B;
  const N = Math.min(200, pts.length), S = []; for (let k = 0; k < N; k++) S.push(pts[Math.floor(k * pts.length / N)]);
  let fit = null;
  for (let d = -0.05; d <= 0.0501; d += 0.0025) for (const f of [1, -1]) {
    const a = S.map(q => { const [x, y] = atFrac(t.loop, q[2] + d); return [x, f * y]; });
    let ax = 0, ay = 0, bx = 0, bz = 0; a.forEach(([x, y], i) => { ax += x; ay += y; bx += S[i][0]; bz += S[i][1]; }); ax /= N; ay /= N; bx /= N; bz /= N;
    let sxx = 0, sxy = 0, saa = 0;
    a.forEach(([x, y], i) => { const u = x - ax, v = y - ay, P = S[i][0] - bx, Q = S[i][1] - bz; sxx += u * P + v * Q; sxy += u * Q - v * P; saa += u * u + v * v; });
    const th = Math.atan2(sxy, sxx), sc = Math.hypot(sxx, sxy) / saa, co = sc * Math.cos(th), si = sc * Math.sin(th);
    let e = 0; a.forEach(([x, y], i) => { const u = x - ax, v = y - ay; e += (bx + co * u - si * v - S[i][0]) ** 2 + (bz + si * u + co * v - S[i][1]) ** 2; });
    if (!fit || e < fit.e) fit = {e, sc, map:([x, y]) => { const u = x - ax, v = f * y - ay; return [bx + co * u - si * v, bz + si * u + co * v]; }};
  }
  const len = fit.sc * cumOf(t.loop)[t.loop.length - 1], ok = Math.sqrt(fit.e / N) < Math.max(30, 0.012 * len);   // a wrong layout or config: no drawing under the line
  const B = ok ? {loop:[...t.loop, t.loop[0]].map(fit.map), pit:t.pit.map(fit.map), labels:t.labels.map(([x, y, n]) => [...fit.map([x, y]), n])} : null;
  ALIGN.set(name, {key, B});
  return B;
}
// view: {zoom, follow, dx, dy} (pan in metres); o: {field, labels (none|number|short|gap), corners, size (s|m|l), lines, colourBy}. Returns {hits:[{i,x,y}], info, empty, noField}.
function drawMap(cv, view, c, o){
  const [g, w, h] = fitCanvas(cv), tk = Pit.tokens(), r = c.r, out = {hits:[], info:'', empty:false, noField:false};
  if (!r) return out;
  const lines = REC.lines, curLine = REC.curLine, p = r.session.car_position_m, own = p && (p[0] || p[2]);
  const shown = o.lines === 'all' || o.lines == null ? lines : [], best = bestLine();
  const t = trackFor(r.fixed.track), L = layoutFor(r.fixed.track);   // L: the layout saved by the bridge, there from the start of the session
  if (!t && !(own && (L || lines.length || curLine.length > 2))) { out.empty = true; return out; }
  // the drawn layout (tracks.js) under your lines, once a line has fixed where it lies; until then it is the map, in its own frame
  const B = null, onDrawing = !!t;   // a track with a drawn layout is only ever that layout: your laps are never drawn over it
  const D = onDrawing ? {loop:[...t.loop, t.loop[0]], pit:t.pit, labels:t.labels} : B;
  const me = onDrawing ? atFrac(t.loop, r.session.track_position) : [p[0], p[2]];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const pts of onDrawing ? [D.loop, D.pit] : [curLine, ...lines.map(l => l.pts), ...(L ? [L.pts] : []), ...(D ? [D.loop] : [])]) for (const [x, z] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  // the field: placed by spline on the best recorded line (no coordinate frame needed), else by broadcast x/z once checked
  const F = c.field, geo = onDrawing ? {pts:t.loop} : best || lines[0] || L && {pts:L.pts} || D && {pts:D.loop}, cars = [];
  if (o.field && F && c.bc && c.bc.state === 'live') {
    const now = performance.now();
    for (const car of c.cars.values()) {
      if (car.i === c.me) continue;
      const q = geo && car.spl != null ? atSpl(geo.pts, smoothSpl(car, now)) : F.xz_ok && Array.isArray(car.xz) ? car.xz : null;
      if (q) cars.push([car, PIT_LOCS.includes(car.loc) && D ? onPitLane(D.pit, q) : q]);
    }
    out.noField = !geo && !F.xz_ok;
  }
  const foc = c.focus !== 'self' ? cars.find(([car]) => car.i === c.focus) : null;
  const pad = 20, base = Math.min((w - 2 * pad) / Math.max(400, x1 - x0), (h - 2 * pad) / Math.max(400, z1 - z0)), sc = base * view.zoom;
  const tgt = foc ? foc[1] : me;
  const cx = view.follow ? tgt[0] : (x0 + x1) / 2 + view.dx, cz = view.follow ? tgt[1] : (z0 + z1) / 2 + view.dy;
  const X = x => w / 2 + (x - cx) * sc, Y = z => h / 2 + (z - cz) * sc;
  view.sc = sc; view.mid = [(x0 + x1) / 2, (z0 + z1) / 2]; view.c = [cx, cz];   // for panning out of follow
  const path = (pts, color, width, alpha) => { if (pts.length < 2) return; g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = width; g.beginPath(); pts.forEach(([x, z], i) => i && Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]) < 60 ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z))); g.stroke(); };   // a jump over 60 m (garage, reset) breaks the line, never a straight across
  g.lineJoin = g.lineCap = 'round';
  const keepL = onDrawing || o.lines === 'saved' && !!L;   // the saved layout alone: finished laps are not drawn again
  const avoid = [];
  if (D) {   // the drawn layout: road and pit lane dashed; your lines go on top
    g.setLineDash([4, 3]); path(D.pit, tk.line, 2, 1); g.setLineDash([]);
    path(D.loop, tk.line, 16, 1); if (!lines.length && !L) path(D.loop, tk.muted, 2, 1);
  }
  if (L && !onDrawing) path(L.pts, tk.line, 14, 1);
  if (!keepL) lines.forEach(l => path(l.pts, tk.line, 14, 1));                       // the width of road this driver uses
  if (!onDrawing) shown.slice().reverse().forEach((l, i, arr) => path(l.pts, tk.muted, 1.5, 0.15 + 0.5 * (i + 1) / arr.length));   // older laps fainter
  if (best && !keepL) path(best.pts, o.colourBy === 'delta' ? tk.muted : tk.pb, 2.5, 1);   // your best: ● --pb (◆ --best is the field's session best)
  if (!onDrawing && L && L.sec.length && o.sectors !== false && o.colourBy !== 'delta') {   // sector colours, as on a timing screen: S1 blue, S2 red, S3 green
    const SC = [tk.chLap, tk.chBrk, tk.chThr], b = [0, ...L.sec, 1];
    for (let k = 0; k < b.length - 1; k++) {
      const seg = L.pts.filter(q => q[2] >= b[k] && q[2] <= b[k + 1]); path(seg, SC[k % 3], 3.5, .9);
      if (seg.length > 1) { const [mx, mz] = seg[seg.length >> 1]; g.globalAlpha = 1; chTag(g, X(mx), Y(mz), 'S' + (k + 1), SC[k % 3], tk, w); }
    }
    g.globalAlpha = 1;
  }
  if (!onDrawing && !keepL) path(curLine, tk.chLap, 2.5, 1);
  g.globalAlpha = 1;
  if (D && o.corners !== false) {   // corner names over the lines; car labels keep clear of them
    const fz = Math.round(10 * mapScale(o)); g.font = `500 ${fz}px ${tk.font}`; g.fillStyle = tk.dim; g.textBaseline = 'middle'; g.textAlign = 'left';
    for (const [x, z, n] of D.labels) { g.fillText(n, X(x), Y(z)); avoid.push([X(x), Y(z) - fz / 2, g.measureText(n).width, fz]); }
  }
  // Analysis: the comparison lap coloured by where it gains (--ok) and loses (--bad); the labels are the 20 parts of Where the time goes
  const ref = lapById(c.sel.ref), cmp = lapById(c.sel.cmp), dGeo = cmp && lines.find(l => l.n === cmp.n && cmp.src !== 'import') || geo;
  if (o.colourBy === 'delta' && ref && cmp && ref.data && cmp.data && dGeo) {
    const S = 40;
    for (let k = 0; k < S; k++) {
      const a = Math.round(k / S * (NB - 1)), b = Math.round((k + 1) / S * (NB - 1)), d = (cmp.data.t[b] - cmp.data.t[a]) - (ref.data.t[b] - ref.data.t[a]);
      const seg = []; for (let j = 0; j <= 6; j++) seg.push(atFrac(dGeo.pts, (k + j / 6) / S));
      const col = Math.abs(d) < 10 ? tk.muted : d < 0 ? tk.ok : tk.bad;   // under 10 ms: neither gain nor loss
      path(seg, col, 4, 1);
    }
    for (let k = 0; k < 20; k++) {
      const a = Math.round(k / 20 * (NB - 1)), b = Math.round((k + 1) / 20 * (NB - 1)), d = (cmp.data.t[b] - cmp.data.t[a]) - (ref.data.t[b] - ref.data.t[a]);
      if (Math.abs(d) < 10) continue;
      const [mx, mz] = atFrac(dGeo.pts, (k + .5) / 20); g.globalAlpha = 1; chTag(g, X(mx), Y(mz), fmtDelta(d), d < 0 ? tk.ok : tk.bad, tk, w);
    }
    g.globalAlpha = 1;
    if (c.sel.cursor != null) { const [qx, qz] = atFrac(dGeo.pts, c.sel.cursor); g.strokeStyle = tk.text; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(qx) - 6, Y(qz)); g.lineTo(X(qx) + 6, Y(qz)); g.moveTo(X(qx), Y(qz) - 6); g.lineTo(X(qx), Y(qz) + 6); g.stroke(); }
  }
  const sf = lines.length ? (best || lines[0]).pts[0] : D && D.loop[0]; if (sf) { g.fillStyle = tk.text; g.fillRect(X(sf[0]) - 5, Y(sf[1]) - 1.5, 10, 3); }   // start/finish
  const dots = cars.map(([car, [x, z]]) => ({car, sx:X(x), sy:Y(z)})), mx = X(me[0]), my = Y(me[1]);
  drawField(g, tk, c, o, dots, mx, my, foc && foc[0], r.session.in_pit_lane, w, h, out, avoid);
  if (c.me != null) out.hits.push({i:c.me, x:mx, y:my});
  if (onDrawing) { out.info = [`${(r.session.track_position * 100).toFixed(1)} % of lap`, cars.length ? `${cars.length + 1} cars` : '', view.zoom > 1.01 ? `×${view.zoom.toFixed(1)}` : ''].filter(Boolean).join(' · '); return out; }
  out.info = [lines.length ? `${lines.length} lap${lines.length > 1 ? 's' : ''}` : L ? 'saved layout' : 'first lap', best ? `● fastest traced L${best.n}` : '',
    REC.spread ? `line spread ${REC.spread.m.toFixed(1)} m` : '', cars.length ? `${cars.length + 1} cars` : '', view.zoom > 1.01 ? `×${view.zoom.toFixed(1)}` : ''].filter(Boolean).join(' · ');
  return out;
}
// the field's dots (and your own disc) with their labels, over a map already drawn; dots: [{car, sx, sy}] and avoid: [[x, y, w, h]]
// (boxes no label may cover) in canvas pixels
function drawField(g, tk, c, o, dots, mx, my, foc, inPit, w, h, out, avoid = []){
  const k = mapScale(o);
  // other cars: circles for GT3, squares for every other class; hollow in the pit lane; ring on the focus car
  for (const {car, sx, sy} of dots) {
    const pit = PIT_LOCS.includes(car.loc), sq = car.class && car.class !== 'GT3';
    g.beginPath(); sq ? g.rect(sx - 4.5 * k, sy - 4.5 * k, 9 * k, 9 * k) : g.arc(sx, sy, 5 * k, 0, 7);
    if (pit) { g.strokeStyle = tk.muted; g.lineWidth = 1.5; g.stroke(); } else { g.fillStyle = tk.muted; g.fill(); g.strokeStyle = tk.bg; g.lineWidth = 1; g.stroke(); }
    if (car === foc) { g.beginPath(); g.arc(sx, sy, 10 * k, 0, 7); g.strokeStyle = tk.accent; g.lineWidth = 2; g.stroke(); }
    out.hits.push({i:car.i, x:sx, y:sy});
  }
  meDisc(g, mx, my, tk, inPit, k);
  if (o.labels !== 'none') {
    // labels in priority order (focus car, then the nearest on track, then by position), each at the first of four spots
    // whose box overlaps nothing placed yet (your disc counts); a label with no free spot is skipped, the dot stays
    const fs = Math.round(clamp(Math.min(w, h) / 60, 10, 14) * k);
    g.font = `600 ${fs}px ${tk.num}`; g.textBaseline = 'middle'; g.textAlign = 'left';
    const taken = [...avoid, [mx - 9 * k, my - 9 * k, 18 * k, 18 * k], ...dots.map(d => [d.sx - 6 * k, d.sy - 6 * k, 12 * k, 12 * k])], hit = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    const meCar = c.cars && c.cars.get(c.me), meLb = (o.labels === 'short' && meCar && Pit.carName(meCar, 'code')) || 'YOU';   // your own car is named too
    g.fillStyle = tk.me; g.fillText(meLb, mx + 10 * k, my); taken.push([mx + 10 * k, my - fs / 2, g.measureText(meLb).width, fs + 1]);
    const pri = d => d.car === foc ? -1e9 : d.car.rel != null && isFinite(d.car.rel) ? Math.abs(d.car.rel) : 1e6 + (d.car.pos || 99);
    for (const d of dots.slice().sort((a, b) => pri(a) - pri(b))) {
      const lb = o.labels === 'gap' ? (d.car.rel != null && isFinite(d.car.rel) ? fmtRel(d.car.rel) : '') : o.labels === 'short' ? Pit.carName(d.car, 'code')
        : o.labels === 'name' ? Pit.carName(d.car, 'last') : o.labels === 'both' ? `${d.car.num != null ? d.car.num : ''} ${Pit.carName(d.car, 'code')}`.trim()
        : d.car.num != null ? String(d.car.num) : ''; if (!lb) continue;
      const tw = g.measureText(lb).width, th = fs + 1;
      const o8 = 8 * k, spot = [[d.sx + o8, d.sy - th / 2], [d.sx - o8 - tw, d.sy - th / 2], [d.sx - tw / 2, d.sy - o8 - th], [d.sx - tw / 2, d.sy + o8]].map(([x, y]) => [x, y, tw, th])
        .find(b => b[0] >= 0 && b[1] >= 0 && b[0] + b[2] <= w && b[1] + b[3] <= h && !taken.some(t => hit(b, t)));
      if (!spot) continue;
      taken.push(spot); g.fillStyle = d.car === foc ? tk.accent : tk.muted; g.fillText(lb, spot[0], spot[1] + th / 2);
    }
  }
}
function mapScale(o){ return {s:0.75, l:1.4}[o.size] || 1; }   // the map's Size option: cars, labels and corner names
function meDisc(g, x, y, tk, pit, k = 1){   // own car: a --me disc, --bg outline and a --bg centre dot; hollow in the pit lane
  g.beginPath(); g.arc(x, y, 7 * k, 0, 7);
  if (pit) { g.strokeStyle = tk.me; g.lineWidth = 2; g.stroke(); }
  else { g.fillStyle = tk.me; g.fill(); g.strokeStyle = tk.bg; g.lineWidth = 1.5; g.stroke(); }
  g.beginPath(); g.arc(x, y, 2 * k, 0, 7); g.fillStyle = pit ? tk.me : tk.bg; g.fill();
}
// Wheel to zoom, drag to pan, double-click to follow; a click without a drag goes to onClick(x, y) in canvas pixels.
function bindMapControls(cv, view, onChange, onClick){
  let drag = null;
  cv.addEventListener('wheel', e => {   // zoom about the pointer: the point under it stays under it
    e.preventDefault();
    const z0 = view.zoom, z1 = clamp(z0 * (e.deltaY < 0 ? 1.25 : 0.8), 1, 40); if (z1 === z0) return;
    if (view.sc && view.c && view.mid && !view.follow) {   // following: the car stays in the middle
      const b = cv.getBoundingClientRect(), px = e.clientX - b.left - b.width / 2, py = e.clientY - b.top - b.height / 2, sc1 = view.sc * z1 / z0;
      view.dx += px / view.sc - px / sc1; view.dy += py / view.sc - py / sc1;
    }
    view.zoom = z1; if (z1 === 1) view.dx = view.dy = 0; onChange();
  }, {passive:false});
  cv.addEventListener('pointerdown', e => { drag = {x:e.clientX, y:e.clientY, moved:false}; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
    const sc = view.sc || 1;
    if (view.follow && view.c) { view.follow = false; view.dx = view.c[0] - view.mid[0]; view.dy = view.c[1] - view.mid[1]; }
    view.dx -= (e.clientX - drag.x) / sc; view.dy -= (e.clientY - drag.y) / sc; drag.x = e.clientX; drag.y = e.clientY; drag.moved = true; onChange();
  });
  cv.addEventListener('pointerup', e => { const d = drag; drag = null; if (d && !d.moved && onClick) { const b = cv.getBoundingClientRect(); onClick(e.clientX - b.left, e.clientY - b.top); } });
  cv.addEventListener('dblclick', () => { view.follow = !view.follow; if (view.follow && view.zoom < 4) view.zoom = 4; onChange(); });
}
