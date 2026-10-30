'use strict';
// car3d.js: a generic GT3 as a low-poly mesh and a small canvas renderer for it (no library: faces sorted far to near and
// filled, flat-shaded). Every face says which part it is, so each part is painted by the damage ACC reports for it.
// Frame: metres, x forward (nose +), y to the car's left, z up. Parts: the five body zones ACC reports (front, rear, left,
// right, centre), the four corners' suspension (s0..s3, FL FR RL RR), the four brakes (b0..b3), and parts ACC says
// nothing about: glass, tyres, the steering wheel (drawn neutral).

const CAR3D = (() => {
  const F = [];   // faces: {p:[[x,y,z]...], part, kind, bias}
  const face = (p, part, kind = 'body', bias = 0) => F.push({p, part, kind, bias});
  const zoneAt = (x, y, z) => x > 1.15 ? 'front' : x < -1.15 ? 'rear' : Math.abs(y) > 0.62 && z < 0.9 ? (y > 0 ? 'left' : 'right') : 'centre';
  const zoneOf = p => { let x = 0, y = 0, z = 0; for (const q of p) { x += q[0]; y += q[1]; z += q[2]; } return zoneAt(x / p.length, y / p.length, z / p.length); };
  // rings of points joined into quads; part: a name, or null to take each face's zone from where it lies
  const AXLES = [1.35, -1.30], ARCH = .43;   // wheel centres (x) and the radius of the arch cut into the body side over them
  const inArch = q => { const m = q.reduce((s, p) => [s[0] + p[0] / q.length, s[1] + p[1] / q.length, s[2] + p[2] / q.length], [0, 0, 0]);
    return Math.abs(m[1]) > .74 && AXLES.some(x => Math.hypot(m[0] - x, m[2] - .34) < ARCH); };
  const loft = (rings, part, kind, closed = true, arches = false) => {
    for (let i = 0; i < rings.length - 1; i++) {
      const a = rings[i], b = rings[i + 1], n = a.length;
      for (let k = 0; k < (closed ? n : n - 1); k++) { const q = [a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]]; if (!(arches && inArch(q))) face(q, part || zoneOf(q), kind); }
    }
  };
  const box = (x0, x1, y0, y1, z0, z1, part, kind) => {
    const P = (i, j, k) => [[x0, x1][i], [y0, y1][j], [z0, z1][k]];
    for (const q of [[P(0,0,0), P(1,0,0), P(1,1,0), P(0,1,0)], [P(0,0,1), P(1,0,1), P(1,1,1), P(0,1,1)], [P(0,0,0), P(1,0,0), P(1,0,1), P(0,0,1)],
      [P(0,1,0), P(1,1,0), P(1,1,1), P(0,1,1)], [P(0,0,0), P(0,1,0), P(0,1,1), P(0,0,1)], [P(1,0,0), P(1,1,0), P(1,1,1), P(1,0,1)]]) face(q, part, kind);
  };
  const both = fn => { fn(1); fn(-1); };   // build a part on the left (+1) and mirrored on the right (-1)
  const side = s => s > 0 ? 'left' : 'right';

  // ---- the body tub: key sections from tail to nose (x, half width, bottom z, beltline z, crown z: the hood/deck centre),
  // smoothed along the car (Catmull-Rom, SUB sections between keys) and round in section (a superellipse whose top dips
  // from the fenders to the hood, so the arches stand proud as on a GT3) ----
  const S = [[-2.33, .86, .30, .86, .90], [-2.22, .95, .16, .92, .94], [-1.75, 1.0, .10, .93, .95], [-1.30, 1.01, .10, .91, .93], [-0.85, .98, .09, .87, .90],
    [-0.30, .93, .09, .81, .83], [0.40, .93, .09, .77, .78], [0.90, .98, .09, .74, .69], [1.35, 1.0, .10, .73, .62], [1.80, .98, .12, .66, .55],
    [2.15, .92, .14, .53, .47], [2.33, .82, .18, .41, .39]];
  const smooth = (K, SUB) => {
    const cr = (a, b, c, d, t) => .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t), out = [];
    for (let i = 0; i < K.length - 1; i++) for (let k = 0; k < SUB; k++)
      out.push(K[i].map((_, j) => cr(K[Math.max(0, i - 1)][j], K[i][j], K[i + 1][j], K[Math.min(K.length - 1, i + 2)][j], k / SUB)));
    return [...out, K[K.length - 1]];
  };
  const ring = ([x, w, zb, zt, zc]) => {
    const M = 14, half = [], zm = (zb + zt) / 2;
    for (let k = 0; k <= M; k++) {
      const th = -Math.PI / 2 + Math.PI * k / M, c = Math.cos(th), sn = Math.sin(th), y = w * Math.pow(Math.abs(c), .4);
      const top = zc + (zt - zc) * Math.pow(y / w, 1.6);
      half.push([x, y, sn < 0 ? zm - (zm - zb) * Math.pow(-sn, .4) : zm + (top - zm) * Math.pow(sn, .4)]);
    }
    return [...half, ...half.slice(1, -1).reverse().map(([a, b, c]) => [a, -b, c])];   // bottom centre, up the left, over, down the right
  };
  const rings = smooth(S, 3).map(ring);
  loft(rings, null, 'body', true, true);
  for (const x of AXLES) both(sg => { const well = []; for (let k = 0; k < 16; k++) { const a = k / 16 * 2 * Math.PI; well.push([x + ARCH * Math.cos(a), sg * .70, .34 + ARCH * Math.sin(a)]); } face(well, 'tyre', 'tyre', -.05); });   // wheel wells
  face(rings[0].slice().reverse(), 'rear', 'body');
  face(rings[rings.length - 1], 'front', 'body');
  // ---- the cabin: windscreen, roof and rear window over a rounded section; the side windows between the A and C pillars ----
  const C = smooth([[0.95, .72, .75, .70, .76], [0.22, .80, .80, .58, 1.17], [-0.55, .82, .85, .58, 1.19], [-1.28, .76, .93, .66, .96]], 3);
  const cab = C.map(([x, wb, zb, wr, zr]) => { const top = []; for (let k = 0; k <= 6; k++) { const y = wr * (1 - k / 3); top.push([x, y, zr + .03 * (1 - (y / wr) ** 2)]); } return [[x, wb, zb], ...top, [x, -wb, zb]]; });
  for (let i = 0; i < cab.length - 1; i++) {
    const a = cab[i], b = cab[i + 1], xm = (a[0][0] + b[0][0]) / 2, n = a.length;
    for (let k = 1; k < n - 2; k++) face([a[k], a[k + 1], b[k + 1], b[k]], 'centre', xm > .24 || xm < -.6 ? 'glass' : 'body');   // windscreen, roof, rear window
    const win = xm < .78 && xm > -.95 ? 'glass' : 'body';   // the side window, else the A or C pillar
    face([a[0], b[0], b[1], a[1]], 'centre', win);
    face([a[n - 1], b[n - 1], b[n - 2], a[n - 2]], 'centre', win);
  }
  box(-0.05, 0.30, -.14, .14, 1.17, 1.25, 'centre', 'body');                 // roof scoop
  // ---- aero and details ----
  box(2.05, 2.42, -.90, .90, .10, .13, 'front', 'carbon');                   // splitter
  both(s => face([[2.22, s * .80, .30], [2.36, s * .93, .30], [2.30, s * .90, .36]], 'front', 'carbon'));   // canards
  both(s => face([[2.02, s * .55, .55], [2.22, s * .80, .47], [2.24, s * .80, .43], [2.05, s * .55, .51]], 'front', 'light', .02));   // headlights
  face([[2.335, .45, .22], [2.335, -.45, .22], [2.335, -.45, .34], [2.335, .45, .34]], 'front', 'vent', .02);   // grille
  both(s => face([[1.45, s * .15, .605], [1.80, s * .15, .57], [1.80, s * .45, .58], [1.45, s * .45, .61]], 'front', 'vent', .01));   // hood vents
  both(s => { box(.66, .82, s > 0 ? .97 : -1.09, s > 0 ? 1.09 : -.97, .80, .89, side(s), 'body'); box(.70, .78, s > 0 ? .84 : -.98, s > 0 ? .98 : -.84, .78, .82, side(s), 'carbon'); });   // mirrors on their stalks
  both(s => box(-.90, .88, s > 0 ? .86 : -.95, s > 0 ? .95 : -.86, .07, .13, side(s), 'carbon'));   // side skirts
  both(s => face([[-2.335, s * .40, .74], [-2.335, s * .82, .74], [-2.335, s * .82, .80], [-2.335, s * .40, .80]], 'rear', 'light', .02));   // tail lights
  face([[-2.335, .70, .31], [-2.335, -.70, .31], [-2.335, -.70, .46], [-2.335, .70, .46]], 'rear', 'vent', .02);   // the opening over the diffuser
  both(s => { const ex = []; for (let k = 0; k < 10; k++) { const a = k / 10 * 2 * Math.PI; ex.push([-2.34, s * .28 + .05 * Math.cos(a), .52 + .05 * Math.sin(a)]); } face(ex, 'rear', 'vent', .03); });   // exhausts
  box(-2.42, -2.04, -.93, .93, 1.17, 1.21, 'rear', 'carbon');                // wing main plane
  box(-2.36, -2.18, -.93, .93, 1.25, 1.27, 'rear', 'carbon');                // gurney flap
  both(s => box(-2.46, -1.98, s > 0 ? .93 : -.95, s > 0 ? .95 : -.93, 1.00, 1.31, 'rear', 'carbon'));   // end plates
  both(s => box(-2.24, -2.14, s > 0 ? .33 : -.37, s > 0 ? .37 : -.33, .92, 1.17, 'rear', 'carbon'));    // swan necks
  for (const y of [-.75, -.45, -.15, .15, .45, .75]) face([[-1.85, y, .10], [-2.36, y, .10], [-2.36, y, .36], [-2.10, y, .18]], 'rear', 'carbon');   // diffuser fins
  face([[-1.85, -.9, .10], [-1.85, .9, .10], [-2.36, .9, .32], [-2.36, -.9, .32]], 'rear', 'carbon');   // diffuser floor
  // ---- wheels, brakes, suspension, steering: corner i = FL FR RL RR ----
  const AX = [1.35, 1.35, -1.30, -1.30], SY = [1, -1, 1, -1], R = .34, N = 18;
  for (let i = 0; i < 4; i++) {
    const x = AX[i], s = SY[i], yi = s * .71, yo = s * 1.01, rim = [], disc = [], tread = [];
    for (let k = 0; k < N; k++) { const a = k / N * 2 * Math.PI, c = Math.cos(a), sn = Math.sin(a); tread.push([x + R * c, yo, .34 + R * sn]); rim.push([x + R * .72 * c, yo + s * .004, .34 + R * .72 * sn]); disc.push([x + R * .42 * c, yo + s * .008, .34 + R * .42 * sn]); }
    const inner = tread.map(([a, , c]) => [a, yi, c]);
    loft([inner, tread], 'tyre', 'tyre');
    face(tread.slice(), 'tyre', 'tyre');                                     // the sidewall
    face(rim, 's' + i, 'rim', .01);                                          // the wheel: that corner's suspension
    face(disc, 'b' + i, 'brake', .02);                                       // the brake: its pads
    // wishbones and the damper, inside the arch (seen with the body see-through)
    for (const [z0, z1] of [[.15, .17], [.44, .46]]) face([[x - .22, s * .36, z0], [x + .22, s * .36, z0], [x, s * .74, z1]], 's' + i, 'arm');
    box(x - .04, x + .04, s > 0 ? .40 : -.70, s > 0 ? .70 : -.40, .20, .24, 's' + i, 'arm');
    if (i < 2) box(x - .16, x - .12, s > 0 ? .20 : -.74, s > 0 ? .74 : -.20, .26, .29, 's' + i, 'arm');   // track rod of the steering
  }
  box(1.19, 1.25, -.22, .22, .25, .29, 'steer', 'neutral');                  // steering rack
  { const n = 14, wc = [], hub = [.38, .38, .90]; for (let k = 0; k < n; k++) { const a = k / n * 2 * Math.PI; wc.push([hub[0] + .02 * Math.cos(a), hub[1] + .17 * Math.cos(a), hub[2] + .14 * Math.sin(a)]); } face(wc, 'steer', 'neutral'); }
  box(.10, .36, .20, .56, .30, .78, 'seat', 'neutral');                       // seat (a reference, no data)

  // where each part's label sits, and which way it faces (labels on the far side are hidden)
  const ANCHOR = {front:[[2.45, 0, .40], [1, 0, 0]], rear:[[-2.45, 0, .95], [-1, 0, 0]], left:[[-.2, 1.02, .50], [0, 1, 0]], right:[[-.2, -1.02, .50], [0, -1, 0]],
    centre:[[-.2, 0, 1.30], [0, 0, 1]], s0:[[1.35, 1.05, .34], [.5, .85, 0]], s1:[[1.35, -1.05, .34], [.5, -.85, 0]], s2:[[-1.30, 1.05, .34], [-.5, .85, 0]], s3:[[-1.30, -1.05, .34], [-.5, -.85, 0]]};
  const VIEWS = {iso:[.75, .38], top:[Math.PI, 1.5707], front:[0, .10], rear:[Math.PI, .10], left:[Math.PI / 2, .10], right:[-Math.PI / 2, .10]};
  return {faces:F, ANCHOR, VIEWS};
})();

// level 0..1 -> --ok, --warn, --bad in between (tk colours are 'rgb(r, g, b)'); null: no data
const rgbOf = s => (s.match(/\d+(\.\d+)?/g) || [0, 0, 0]).slice(0, 3).map(Number);
function levelColour(t, tk){
  const a = rgbOf(tk.ok), b = rgbOf(tk.warn), c = rgbOf(tk.bad), u = Math.max(0, Math.min(1, t));
  const [p, q, f] = u < .5 ? [a, b, u * 2] : [b, c, (u - .5) * 2];
  return p.map((v, i) => v + (q[i] - v) * f);
}
// view: {az, el, x}: azimuth and elevation of the camera, x = see-through body. lv: part -> level 0..1 (or null). Returns the
// projected label anchors {part: [x, y, facing]}.
function drawCar3d(cv, view, lv){
  const [g, w, h] = fitCanvas(cv), tk = Pit.tokens(), ca = Math.cos(view.az), sa = Math.sin(view.az), ce = Math.cos(view.el), se = Math.sin(view.el);
  const d = [ce * ca, ce * sa, se], r = [-sa, ca, 0], u = [-se * ca, -se * sa, ce], dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  // a mild perspective, then the whole car fitted to the canvas whichever way it is turned
  const D = 11, Q = p => { const k = D / (D - dot(p, d)), q = [p[0], p[1], p[2] - .6]; return [dot(q, r) * k, -dot(q, u) * k]; };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const f of CAR3D.faces) for (const p of f.p) { const [x, y] = Q(p); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const pad = 26, sc = Math.min((w - 2 * pad) / (x1 - x0), (h - 2 * pad) / (y1 - y0)), ox = w / 2 - (x0 + x1) / 2 * sc, oy = h / 2 - (y0 + y1) / 2 * sc;
  const P = p => { const [x, y] = Q(p); return [ox + x * sc, oy + y * sc]; };
  const L = [.35, .45, .82], dark = rgbOf(tk.bg), base = rgbOf(tk.raise), neutral = rgbOf(tk.dim);
  const inside = f => f.kind === 'arm' || f.kind === 'neutral';   // suspension, steering, seat: under the bodywork, seen only through it
  const list = CAR3D.faces.filter(f => view.x || !inside(f)).map(f => {
    let z = 0; for (const p of f.p) z += dot(p, d);
    const a = f.p[0], b = f.p[1], c = f.p[f.p.length - 1], e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], nl = Math.hypot(...n) || 1;
    return {f, z:z / f.p.length + f.bias, lit:.5 + .5 * Math.abs(dot(n, L)) / nl};
  }).sort((p, q) => p.z - q.z);
  g.lineJoin = 'round';
  for (const {f, lit} of list) {
    const t = lv[f.part], see = view.x && (f.kind === 'body' || f.kind === 'carbon' || f.kind === 'light' || f.kind === 'vent');
    let col, alpha = 1;
    if (f.kind === 'tyre') col = [28, 31, 36];
    else if (f.kind === 'glass') { col = [44, 62, 80]; alpha = view.x ? .12 : 1; }   // dark glass: ACC does not say when it breaks
    else if (f.kind === 'neutral' || t == null) col = neutral;
    else {
      col = levelColour(t, tk);
      if (f.kind === 'carbon') col = col.map((v, i) => v * .55 + base[i] * .45);
      if (f.kind === 'vent') col = col.map((v, i) => v * .25 + dark[i] * .75);
      if (f.kind === 'light') col = col.map(v => v + (255 - v) * .55);
    }
    if (see) alpha = .16;
    const k = f.kind === 'glass' ? 1 : lit, s = f.p.map(P);
    g.beginPath(); s.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath();
    g.globalAlpha = alpha; g.fillStyle = `rgb(${col.map(v => Math.round(v * k)).join(',')})`; g.fill();
    g.globalAlpha = see ? .12 : .18; g.strokeStyle = tk.bg; g.lineWidth = .5; g.stroke();
  }
  g.globalAlpha = 1;
  const out = {};
  for (const [part, [p, n]] of Object.entries(CAR3D.ANCHOR)) { const [x, y] = P(p); out[part] = [x, y, dot(n, d) > .2 || view.el > 1.2 || part === 'centre']; }   // labels on the far side hide; the roof's shows from every side
  return out;
}
