'use strict';
// car3d.js: a generic GT3 (after the silhouettes of the 650S and 720S GT3: a low wedge nose over a long splitter, a teardrop
// canopy, wide rear haunches, side intakes, a swan-neck wing) built from three.js geometry and drawn with WebGL, whose depth
// buffer lets parts meet and cross without one showing through another. three.js (MIT, web/vendor) is loaded only when a
// Car damage 3D module opens. Every triangle names its part, so each part is painted by the damage ACC reports for it:
// the five body zones (front, rear, left, right, centre), each corner's suspension (s0..s3, FL FR RL RR) and brake pads
// (b0..b3); the glass, tyres, steering, seat and cage are drawn neutral, since ACC says nothing about them.
// Frame: metres, x forward (nose +), y to the car's left, z up.

let THREE_P = null;
const loadThree = () => THREE_P || (THREE_P = import('/vendor/three.module.min.js'));

// level 0..1 -> --ok, --warn, --bad in between (tk colours are 'rgb(r, g, b)')
const rgbOf = s => (s.match(/\d+(\.\d+)?/g) || [0, 0, 0]).slice(0, 3).map(Number);
function levelColour(t, tk){
  const a = rgbOf(tk.ok), b = rgbOf(tk.warn), c = rgbOf(tk.bad), u = Math.max(0, Math.min(1, t));
  const [p, q, f] = u < .5 ? [a, b, u * 2] : [b, c, (u - .5) * 2];
  return p.map((v, i) => v + (q[i] - v) * f);
}

const CAR3D = {
  ANCHOR: {front:[[2.50, 0, .40], [1, 0, 0]], rear:[[-2.50, 0, .95], [-1, 0, 0]], left:[[-.3, 1.05, .55], [0, 1, 0]], right:[[-.3, -1.05, .55], [0, -1, 0]],
    centre:[[-.2, 0, 1.30], [0, 0, 1]], s0:[[1.36, 1.08, .34], [.5, .85, 0]], s1:[[1.36, -1.08, .34], [.5, -.85, 0]], s2:[[-1.32, 1.08, .34], [-.5, .85, 0]],
    s3:[[-1.32, -1.08, .34], [-.5, -.85, 0]]},
  VIEWS: {iso:[.75, .34], top:[Math.PI, 1.5707], front:[0, .08], rear:[Math.PI, .08], left:[Math.PI / 2, .06], right:[-Math.PI / 2, .06]},

  // The car as triangles in four layers: shell (bodywork and aero, see-through on demand), inner (wheels, wells, suspension,
  // steering, seat), glass and frames. Each triangle carries its part and kind; colours are set per triangle on update.
  build(T){
    const L = {shell:null, inner:null, glass:null, frame:null};
    for (const k in L) L[k] = {pos:[], nor:[], part:[], kind:[]};
    const zoneAt = (x, y, z) => x > 1.15 ? 'front' : x < -1.15 ? 'rear' : Math.abs(y) > .62 && z < .92 ? (y > 0 ? 'left' : 'right') : 'centre';
    const tri = (layer, a, b, c, na, nb, nc, part, kind) => {
      const o = L[layer]; o.pos.push(...a, ...b, ...c); o.nor.push(...na, ...nb, ...nc);
      o.part.push(typeof part === 'function' ? part((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3) : part); o.kind.push(kind);
    };
    // any three.js geometry, placed by a matrix, into a layer
    const geo = (layer, g, m, part, kind) => {
      g = g.index ? g.toNonIndexed() : g; if (m) g.applyMatrix4(m); g.computeVertexNormals();
      const p = g.attributes.position.array, n = g.attributes.normal.array;
      for (let i = 0; i < p.length; i += 9) tri(layer, [p[i], p[i + 1], p[i + 2]], [p[i + 3], p[i + 4], p[i + 5]], [p[i + 6], p[i + 7], p[i + 8]],
        [n[i], n[i + 1], n[i + 2]], [n[i + 3], n[i + 4], n[i + 5]], [n[i + 6], n[i + 7], n[i + 8]], part, kind);
      g.dispose();
    };
    const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz, 'ZYX')), new T.Vector3(sx, sy, sz));
    const box = (layer, x0, x1, y0, y1, z0, z1, part, kind) => geo(layer, new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), part, kind);
    const rod = (layer, a, b, r, part, kind) => {   // a cylinder from a to b
      const A = new T.Vector3(...a), B = new T.Vector3(...b), d = B.clone().sub(A), g = new T.CylinderGeometry(r, r, d.length(), 8, 1);
      g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize())); g.translate(...A.clone().add(B).multiplyScalar(.5).toArray());
      geo(layer, g, null, part, kind);
    };
    const tube = (layer, pts, r, closed, part, kind) => geo(layer, new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(p => new T.Vector3(...p)), closed), pts.length * 4, r, 6, closed), null, part, kind);
    // a flat shape drawn in the x-z plane (u = x, v = z), extruded `depth` towards -y from y0 + depth
    const plate = (layer, pts, y0, depth, part, kind) => {
      const g = new T.ExtrudeGeometry(new T.Shape(pts.map(([u, v]) => new T.Vector2(u, v))), {depth, bevelEnabled:false, curveSegments:6});
      g.rotateX(Math.PI / 2); g.translate(0, y0 + depth, 0);   // shape y -> z, extrusion -> -y
      geo(layer, g, null, part, kind);
    };
    // a flat shape drawn in the x-y plane, extruded `depth` up from z0
    const flat = (layer, pts, z0, depth, part, kind) => { const g = new T.ExtrudeGeometry(new T.Shape(pts.map(([u, v]) => new T.Vector2(u, v))), {depth, bevelEnabled:false}); g.translate(0, 0, z0); geo(layer, g, null, part, kind); };
    const quadN = (a, b, c) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1; return n.map(e => e / l); };
    const quad = (layer, a, b, c, d, part, kind) => { const n = quadN(a, b, c); tri(layer, a, b, c, n, n, n, part, kind); tri(layer, a, c, d, n, n, n, part, kind); };
    const both = fn => { fn(1); fn(-1); };
    const sideOf = s => s > 0 ? 'left' : 'right';

    // ---- the body: key sections from tail to nose (x, half width, bottom z, beltline z, crown z: the hood or deck centre),
    // smoothed along the car (Catmull-Rom), round in section (a superellipse whose top dips from the fenders to the hood) ----
    const KEY = [[-2.40, .70, .38, .78, .80], [-2.32, .88, .24, .88, .91], [-2.20, .97, .16, .94, .96], [-1.80, 1.02, .11, .95, .97], [-1.32, 1.03, .11, .93, .95], [-0.88, 1.0, .10, .88, .91],
      [-0.40, .94, .10, .80, .83], [0.30, .93, .10, .76, .77], [0.88, .99, .10, .78, .70], [1.36, 1.02, .11, .81, .62], [1.82, .99, .13, .70, .54],
      [2.16, .93, .15, .50, .45], [2.36, .80, .19, .38, .36]];
    const smooth = (K, SUB) => {
      const cr = (a, b, c, d, t) => .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t), out = [];
      for (let i = 0; i < K.length - 1; i++) for (let k = 0; k < SUB; k++)
        out.push(K[i].map((_, j) => cr(K[Math.max(0, i - 1)][j], K[i][j], K[i + 1][j], K[Math.min(K.length - 1, i + 2)][j], k / SUB)));
      return [...out, K[K.length - 1]];
    };
    const SEC = smooth(KEY, 6), RM = 22;
    const secAt = x => { for (let i = 0; i < SEC.length - 1; i++) if (x <= SEC[i + 1][0]) { const a = SEC[i], b = SEC[i + 1], t = (x - a[0]) / (b[0] - a[0]); return a.map((v, j) => v + (b[j] - v) * t); } return SEC[SEC.length - 1]; };
    const ringPt = ([x, w, zb, zt, zc], th) => {
      const c = Math.cos(th), sn = Math.sin(th), y = w * Math.pow(Math.abs(c), .4), zm = (zb + zt) / 2, top = zc + (zt - zc) * Math.pow(y / w, 1.6);
      return [x, y, sn < 0 ? zm - (zm - zb) * Math.pow(-sn, .4) : zm + (top - zm) * Math.pow(sn, .4)];
    };
    const ring = s => { const half = []; for (let k = 0; k <= RM; k++) half.push(ringPt(s, -Math.PI / 2 + Math.PI * k / RM)); return [...half, ...half.slice(1, -1).reverse().map(([a, b, c]) => [a, -b, c])]; };
    const topZ = (x, y) => { const [, w, , zt, zc] = secAt(x); return zc + (zt - zc) * Math.pow(Math.min(1, Math.abs(y) / w), 1.6); };   // the upper surface
    const sideY = (x, z) => { const [, w, zb, zt] = secAt(x), zm = (zb + zt) / 2, f = z < zm ? (zm - z) / (zm - zb) : (z - zm) / (zt - zm);
      const sn = Math.pow(Math.min(1, Math.max(0, f)), 2.5); return w * Math.pow(Math.sqrt(1 - sn * sn), .4); };   // the side surface
    const AX = [1.36, -1.32], AR = .42, inArch = (x, y, z) => Math.abs(y) > .6 && AX.some(a => Math.hypot(x - a, z - .34) < AR);
    {
      const R = SEC.map(ring), n = R[0].length, pos = [], idx = [], quads = [];
      for (const r of R) for (const p of r) pos.push(...p);
      for (let i = 0; i < R.length - 1; i++) for (let k = 0; k < n; k++) quads.push([i * n + k, i * n + (k + 1) % n, (i + 1) * n + (k + 1) % n, (i + 1) * n + k]);
      for (const [a, b, c, d] of quads) idx.push(a, b, c, a, c, d);
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const nn = g.attributes.normal.array, P = i => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]], N = i => [nn[3 * i], nn[3 * i + 1], nn[3 * i + 2]];
      for (const [a, b, c, d] of quads) {
        const m = [0, 1, 2].map(j => (P(a)[j] + P(b)[j] + P(c)[j] + P(d)[j]) / 4);
        if (inArch(...m)) continue;   // the wheel arch openings
        tri('shell', P(a), P(b), P(c), N(a), N(b), N(c), zoneAt, 'body'); tri('shell', P(a), P(c), P(d), N(a), N(c), N(d), zoneAt, 'body');
      }
      g.dispose();
      for (const [r, part, dir] of [[R[0], 'rear', -1], [R[R.length - 1], 'front', 1]]) {   // tail and nose caps
        const cx = r[0][0], cz = r.reduce((s, p) => s + p[2], 0) / n, nv = [dir, 0, 0];
        for (let k = 0; k < n; k++) tri('shell', [cx, 0, cz], r[k], r[(k + 1) % n], nv, nv, nv, part, 'body');
      }
    }
    // ---- wheel arches: a lip round each opening and a dark well inside ----
    for (const ax of AX) both(s => {
      const lip = [];
      for (let k = 0; k <= 24; k++) { const a = -.25 + (Math.PI + .5) * k / 24, x = ax + (AR + .005) * Math.cos(a), z = .34 + (AR + .005) * Math.sin(a); const zc = Math.min(z, secAt(x)[3] - .05); lip.push([x, s * (sideY(x, zc) - .004), zc]); }   // never above the fender
      tube('shell', lip, .022, false, ax > 0 ? 'front' : 'rear', 'carbon');
      geo('inner', new T.CylinderGeometry(AR + .02, AR + .02, .42, 24, 1, true, Math.PI * .95, Math.PI * 1.1), M(ax, s * .80, .34), 'well', 'well');   // the drum over the wheel
      geo('inner', new T.CircleGeometry(AR + .02, 24), M(ax, s * .59, .34, Math.PI / 2), 'well', 'well');
    });
    // ---- the cabin: a teardrop canopy; windscreen, side windows and rear window are glass in black frames ----
    const CK = smooth([[0.98, .74, .76, .68, .78], [0.62, .79, .78, .62, 1.05], [0.20, .81, .81, .57, 1.17], [-0.50, .83, .86, .56, 1.19], [-1.00, .82, .90, .62, 1.07],
      [-1.40, .78, .94, .70, .97]], 4), CN = 10;
    const cab = CK.map(([x, wb, zb, wr, zr]) => { const top = []; for (let k = 0; k <= CN; k++) { const y = wr * (1 - 2 * k / CN); top.push([x, y, zr + .035 * (1 - (y / wr) ** 2)]); } return [[x, wb, zb], ...top, [x, -wb, zb]]; });
    const xs = cab.map(r => r[0][0]), WS = [0.98, 0.30], RW = [-0.62, -1.40], SW = [0.80, -1.02];   // windscreen, rear window, side window x ranges
    const inR = (x, [a, b]) => x <= Math.max(a, b) + 1e-6 && x >= Math.min(a, b) - 1e-6, m = cab[0].length;
    for (let i = 0; i < cab.length - 1; i++) {
      const a = cab[i], b = cab[i + 1], xm = (xs[i] + xs[i + 1]) / 2, glassTop = inR(xm, WS) || inR(xm, RW);
      for (let k = 1; k < m - 2; k++) quad(glassTop ? 'glass' : 'shell', a[k], a[k + 1], b[k + 1], b[k], 'centre', glassTop ? 'glass' : 'body');
      for (const [p, q] of [[0, 1], [m - 1, m - 2]]) {   // the sides: window glass over a body-colour strip, or a pillar
        const mid = c => c[p].map((v, e) => v + (c[q][e] - v) * .22);
        if (inR(xm, SW)) { quad('shell', a[p], b[p], mid(b), mid(a), 'centre', 'body'); quad('glass', mid(a), mid(b), b[q], a[q], 'centre', 'glass'); }
        else quad('shell', a[p], b[p], b[q], a[q], 'centre', 'body');
      }
    }
    // frames: the outline of each window, a little proud of the glass
    const near = x => xs.reduce((bi, v, i) => Math.abs(v - x) < Math.abs(xs[bi] - x) ? i : bi, 0);
    for (const rg of [WS, RW]) {
      const lo = Math.min(near(rg[0]), near(rg[1])), hi = Math.max(near(rg[0]), near(rg[1])), out = [];
      for (let k = 1; k < m - 1; k++) out.push(cab[lo][k]);
      for (let i = lo + 1; i <= hi; i++) out.push(cab[i][m - 2]);
      for (let k = m - 3; k >= 1; k--) out.push(cab[hi][k]);
      for (let i = hi - 1; i > lo; i--) out.push(cab[i][1]);
      tube('frame', out.map(([x, y, z]) => [x, y * 1.012, z + .006]), .016, true, 'frame', 'frame');
    }
    both(s => {   // the side window's frame: along its sill, up the pillars, along the roof edge
      const lo = Math.min(near(SW[0]), near(SW[1])), hi = Math.max(near(SW[0]), near(SW[1])), p = s > 0 ? 0 : m - 1, q = s > 0 ? 1 : m - 2, out = [];
      for (let i = lo; i <= hi; i++) out.push(cab[i][p].map((v, e) => v + (cab[i][q][e] - v) * .22));
      for (let i = hi; i >= lo; i--) out.push(cab[i][q]);
      tube('frame', out.map(([x, y, z]) => [x, y * 1.01, z]), .016, true, 'frame', 'frame');
    });
    // ---- aero and details, each on the surface it belongs to ----
    flat('shell', [[1.98, -.97], [2.36, -.92], [2.50, -.55], [2.53, 0], [2.50, .55], [2.36, .92], [1.98, .97]], .09, .035, 'front', 'carbon');   // splitter
    both(s => plate('shell', [[2.20, .24], [2.42, .30], [2.34, .35]], s > 0 ? .80 : -.84, .04, 'front', 'carbon'));   // canards
    both(s => {   // headlights: a swept slit along each front fender, and the intakes under them
      const g = [[2.02, .50], [2.16, .62], [2.28, .74], [2.27, .79], [2.12, .70], [1.98, .57]].map(([x, y]) => [x, s * y, topZ(x, y) + .006]), up = [0, 0, 1];
      for (const [i, j, k] of [[0, 1, 5], [1, 4, 5], [1, 2, 4], [2, 3, 4]]) tri('shell', g[i], g[j], g[k], up, up, up, 'front', 'light');
      const pts = [[2.375, .30, .21], [2.375, .66, .21], [2.33, .72, .33], [2.375, .30, .33]].map(([x, y, z]) => [x, s * y, z]);
      quad('shell', ...pts, 'front', 'vent');
    });
    quad('shell', [2.38, .26, .21], [2.38, -.26, .21], [2.38, -.26, .32], [2.38, .26, .32], 'front', 'vent');   // the central intake
    const onTop = (x0, x1, y0, y1, part, kind, N = 6) => {   // a strip lying on the upper surface, x0..x1 by y0..y1
      for (let j = 0; j < N; j++) { const ya = y0 + (y1 - y0) * j / N, yb = y0 + (y1 - y0) * (j + 1) / N, P = (x, y) => [x, y, topZ(x, y) + .006];
        quad('shell', P(x0, ya), P(x1, ya), P(x1, yb), P(x0, yb), part, kind); }
    };
    const onSide = (s, x0, x1, zlo, zhi, part, kind, N = 8) => {   // a patch on the side surface: x0..x1, from zlo(t) to zhi(t) along it
      for (let j = 0; j < N; j++) for (let i = 0; i < 4; i++) {
        const P = (tj, ti) => { const x = x0 + (x1 - x0) * tj, z = zlo(tj) + (zhi(tj) - zlo(tj)) * ti; return [x, s * (sideY(x, z) + .006), z]; };
        const q = [P(j / N, i / 4), P((j + 1) / N, i / 4), P((j + 1) / N, (i + 1) / 4), P(j / N, (i + 1) / 4)];
        quad('shell', ...(s > 0 ? q : q.reverse()), part, kind);
      }
    };
    for (let k = 0; k < 5; k++) both(s => { const x = 1.48 + k * .07; onTop(x, x + .035, s * .14, s * .46, 'front', 'vent'); });   // hood louvres
    for (let k = 0; k < 4; k++) both(s => { const x = 1.62 + k * .06; onTop(x, x + .03, s * .64, s * .84, 'front', 'vent'); });   // fender louvres
    both(s => {   // the intake behind the door (a scoop narrowing forward), and the side skirt
      onSide(s, -.40, -1.02, t => .44 + .10 * (1 - t), t => .72, sideOf(s), 'vent');
      plate('shell', [[-.95, .07], [.95, .07], [.98, .14], [-.98, .14]], s > 0 ? .90 : -.98, .08, sideOf(s), 'carbon');
    });
    both(s => {   // mirrors: a pod on a stalk from the door top
      geo('shell', new T.SphereGeometry(1, 14, 10), M(.64, s * .99, .88, 0, 0, s * .15, .12, .06, .045), sideOf(s), 'body');
      rod('shell', [.62, s * .80, .79], [.64, s * .95, .87], .012, sideOf(s), 'carbon');
    });
    // the tail: lights across it, a mesh grille, the exhausts and the diffuser with its fins
    // on the tail (its last section, x -2.40): a light bar wrapping round it, the grille and two exhausts
    both(s => { const lb = []; for (let k = 0; k <= 8; k++) { const y = .18 + .62 * k / 8, x = -2.40 + .35 * Math.max(0, (y - .55) / .25) ** 2; lb.push([x, s * Math.min(y, sideY(x, .74) + .004), .74]); }
      tube('shell', lb, .018, false, 'rear', 'light'); });
    quad('shell', [-2.405, -.52, .44], [-2.405, .52, .44], [-2.405, .52, .64], [-2.405, -.52, .64], 'rear', 'vent');
    both(s => { geo('shell', new T.CylinderGeometry(.055, .055, .10, 16, 1, true), M(-2.40, s * .20, .53, 0, 0, Math.PI / 2), 'rear', 'vent');
      geo('shell', new T.CircleGeometry(.05, 16), M(-2.36, s * .20, .53, 0, Math.PI / 2, 0), 'rear', 'vent'); });
    flat('shell', [[-1.80, -.92], [-1.80, .92], [-2.42, .92], [-2.42, -.92]], .09, .02, 'rear', 'carbon');
    for (const y of [-.70, -.42, -.14, .14, .42, .70]) plate('shell', [[-1.85, .10], [-2.42, .10], [-2.42, .38], [-2.10, .18]], y - .01, .02, 'rear', 'carbon');
    // the wing: an airfoil on two swan necks, with end plates and a gurney flap
    const foil = [[0, 0], [.05, .035], [.16, .055], [.30, .045], [.42, .02], [.44, .005], [.30, .005], [.15, -.005], [.05, -.008]].map(([u, v]) => [-2.02 - u, 1.20 + v - u * .08]);
    plate('shell', foil, -.95, 1.90, 'rear', 'carbon');
    plate('shell', [[-2.44, 1.165], [-2.462, 1.165], [-2.462, 1.215], [-2.44, 1.205]], -.95, 1.90, 'rear', 'carbon');
    both(s => plate('shell', [[-1.96, 1.02], [-2.50, 1.00], [-2.52, 1.30], [-2.30, 1.33], [-1.98, 1.24]], s > 0 ? .95 : -.97, .02, 'rear', 'carbon'));
    both(s => plate('shell', [[-1.98, topZ(-1.98, .34) - .02], [-2.08, topZ(-2.08, .34) - .02], [-2.16, 1.10], [-2.24, 1.27], [-2.17, 1.29], [-2.07, 1.12]], s > 0 ? .32 : -.35, .03, 'rear', 'carbon'));
    // ---- wheels: tyre, ten-spoke rim (that corner's suspension), brake disc and caliper (its pads) ----
    const tyreProfile = [[.24, -.15], [.30, -.155], [.335, -.145], [.343, -.11], [.345, 0], [.343, .11], [.335, .145], [.30, .155], [.24, .15]].map(([r, y]) => new T.Vector2(r, y));
    [[AX[0], 1], [AX[0], -1], [AX[1], 1], [AX[1], -1]].forEach(([x, s], i) => {
      const y = s * .84, part = 's' + i, front = x > 0;
      geo('inner', new T.LatheGeometry(tyreProfile, 36), M(x, y, .34), 'tyre', 'tyre');
      geo('inner', new T.CylinderGeometry(.243, .243, .24, 28, 1, true), M(x, y, .34), part, 'rim');   // the barrel
      geo('inner', new T.TorusGeometry(.243, .012, 6, 28), M(x, y + s * .115, .34, Math.PI / 2), part, 'rim');   // the lip
      for (let k = 0; k < 10; k++) { const a = k / 10 * 2 * Math.PI; geo('inner', new T.BoxGeometry(.205, .018, .028), M(x + .12 * Math.cos(a), y + s * .095, .34 + .12 * Math.sin(a), 0, -a, 0), part, 'rim'); }
      geo('inner', new T.CylinderGeometry(.045, .05, .05, 12), M(x, y + s * .10, .34), part, 'rim');   // the hub
      geo('inner', new T.CylinderGeometry(.19, .19, .03, 28), M(x, y - s * .02, .34), 'b' + i, 'brake');   // the disc
      geo('inner', new T.BoxGeometry(.10, .07, .15), M(x + (front ? .13 : -.13), y - s * .01, .45, 0, front ? -.6 : .6, 0), 'b' + i, 'brake');   // the caliper
      // double wishbones, the damper and, at the front, the track rod: seen through the bodywork
      for (const [zi, zo] of [[.18, .20], [.46, .50]]) { rod('inner', [x - .22, s * .34, zi], [x, s * .72, zo], .014, part, 'arm'); rod('inner', [x + .22, s * .34, zi], [x, s * .72, zo], .014, part, 'arm'); }
      rod('inner', [x, s * .70, .24], [x - .05 * Math.sign(x), s * .40, .66], .028, part, 'arm');
      if (front) rod('inner', [x - .14, s * .22, .27], [x - .12, s * .72, .28], .012, part, 'arm');
    });
    // ---- inside: steering rack, column and wheel, seat, roll cage (no data from ACC: neutral) ----
    rod('inner', [1.22, -.24, .27], [1.22, .24, .27], .02, 'steer', 'neutral');
    rod('inner', [1.20, .38, .30], [.45, .38, .80], .018, 'steer', 'neutral');
    geo('inner', new T.TorusGeometry(.15, .016, 8, 24), M(.42, .38, .82, 0, -1.1, 0), 'steer', 'neutral');
    box('inner', .02, .12, .22, .56, .22, .82, 'seat', 'neutral'); box('inner', .02, .38, .22, .56, .20, .30, 'seat', 'neutral');
    for (const [a, b] of [[[.78, .62, .30], [.20, .55, 1.12]], [[.78, -.62, .30], [.20, -.55, 1.12]], [[.20, .55, 1.12], [.20, -.55, 1.12]], [[.20, .55, 1.12], [-.70, .55, 1.12]],
      [[.20, -.55, 1.12], [-.70, -.55, 1.12]], [[-.70, .55, 1.12], [-.70, -.55, 1.12]], [[-.70, .55, 1.12], [-.75, .62, .35]], [[-.70, -.55, 1.12], [-.75, -.62, .35]]]) rod('inner', a, b, .02, 'cage', 'neutral');

    // ---- into three.js: one mesh per layer, colours per triangle ----
    const meshes = {}, mats = {
      shell:new T.MeshStandardMaterial({vertexColors:true, roughness:.42, metalness:.08, side:T.DoubleSide}),
      inner:new T.MeshStandardMaterial({vertexColors:true, roughness:.7, metalness:.1, side:T.DoubleSide}),
      glass:new T.MeshStandardMaterial({color:0x1b2733, roughness:.08, metalness:.4, transparent:true, opacity:.88, side:T.DoubleSide, depthWrite:false}),
      frame:new T.MeshStandardMaterial({color:0x0b0c0e, roughness:.6})};
    for (const k in L) {
      const o = L[k], g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(o.pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(o.nor, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(o.pos.length).fill(1), 3));
      meshes[k] = new T.Mesh(g, mats[k]); meshes[k].renderOrder = k === 'glass' ? 2 : 1;
    }
    const group = new T.Group(); for (const k of ['inner', 'shell', 'frame', 'glass']) group.add(meshes[k]);
    let key = '';
    return {group, meshes, mats,
      // lv: part -> level 0..1 or null; tk: the theme tokens; xray: the bodywork see-through
      update(lv, tk, xray){
        const k2 = JSON.stringify([lv, tk.ok, tk.warn, tk.bad, tk.raise, tk.bg, xray]); if (k2 === key) return; key = k2;
        const lin = rgb => new T.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, T.SRGBColorSpace), base = rgbOf(tk.raise), dark = rgbOf(tk.bg);
        const cache = {}, colourOf = (part, kind) => {
          const id = part + '|' + kind; if (cache[id]) return cache[id];
          const t = lv[part]; let c;
          if (kind === 'tyre') c = [26, 28, 31];
          else if (kind === 'well') c = [14, 15, 17];
          else if (kind === 'neutral' || t == null) c = [128, 133, 140];
          else {
            c = levelColour(t, tk);
            if (kind === 'carbon') c = c.map((v, i) => v * .5 + base[i] * .5);
            else if (kind === 'vent') c = c.map((v, i) => v * .18 + dark[i] * .82);
            else if (kind === 'light') c = c.map(v => v + (255 - v) * .6);
            else if (kind === 'rim') c = c.map(v => v * .85);
          }
          return (cache[id] = lin(c));
        };
        for (const k of ['shell', 'inner']) {
          const o = L[k], col = meshes[k].geometry.attributes.color, a = col.array;
          for (let t = 0; t < o.part.length; t++) { const c = colourOf(o.part[t], o.kind[t]); for (let v = 0; v < 3; v++) { a[9 * t + 3 * v] = c.r; a[9 * t + 3 * v + 1] = c.g; a[9 * t + 3 * v + 2] = c.b; } }
          col.needsUpdate = true;
        }
        mats.shell.transparent = xray; mats.shell.opacity = xray ? .16 : 1; mats.shell.depthWrite = !xray; mats.shell.needsUpdate = true;
        mats.glass.opacity = xray ? .12 : .88; mats.frame.transparent = xray; mats.frame.opacity = xray ? .3 : 1; mats.frame.needsUpdate = true;
      }};
  },
};

// The car in a WebGL canvas of its own inside host: {draw(view, lv) -> label anchors {part: [x, y, facing]}, dispose()};
// rejects when three.js cannot load or there is no WebGL.
async function car3dView(host){
  const T = await loadThree();
  const renderer = new T.WebGLRenderer({antialias:true, alpha:true});
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.domElement.className = 'c3-gl';
  host.prepend(renderer.domElement);
  const scene = new T.Scene(), car = CAR3D.build(T), cam = new T.PerspectiveCamera(28, 1, .1, 100);
  scene.add(car.group);
  scene.add(new T.HemisphereLight(0xffffff, 0x2a2d33, 2.3));
  const sun = new T.DirectionalLight(0xffffff, 1.9); sun.position.set(4, 5, 7); scene.add(sun);
  const rim = new T.DirectionalLight(0xffffff, .7); rim.position.set(-5, -4, 3); scene.add(rim);
  const centre = new T.Vector3(0, 0, .62), BOX = [];   // what the camera looks at, and the corners of the car's box
  for (const x of [-2.55, 2.55]) for (const y of [-1.1, 1.1]) for (const z of [0, 1.33]) BOX.push([x, y, z - .62]);
  return {
    draw(view, lv){
      const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return {};
      renderer.setSize(w, h, false);
      car.update(lv, Pit.tokens(), view.x);
      const ca = Math.cos(view.az), sa = Math.sin(view.az), ce = Math.cos(view.el), se = Math.sin(view.el), a = w / h, f = cam.fov * Math.PI / 360;
      const d = [ce * ca, ce * sa, se], r = [-sa, ca, 0], u = [-se * ca, -se * sa, ce], dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      let dist = 0;   // far enough that every corner of the box is inside the view, with a margin
      for (const p of BOX) { const z = dot(p, d); dist = Math.max(dist, z + Math.abs(dot(p, r)) / (Math.tan(f) * a) * 1.08, z + Math.abs(dot(p, u)) / Math.tan(f) * 1.12); }
      cam.aspect = a; cam.up.set(...u);   // the orbit's own up: never parallel to the view, so Top works
      cam.position.set(centre.x + dist * ce * ca, centre.y + dist * ce * sa, centre.z + dist * se); cam.lookAt(centre); cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      const out = {};
      for (const [part, [p, n]] of Object.entries(CAR3D.ANCHOR)) {
        const v = new T.Vector3(...p).project(cam), facing = n[0] * d[0] + n[1] * d[1] + n[2] * d[2] > .2 || view.el > 1.2 || part === 'centre';
        out[part] = [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h, facing];
      }
      return out;
    },
    dispose(){ renderer.dispose(); for (const k in car.meshes) car.meshes[k].geometry.dispose(); for (const k in car.mats) car.mats[k].dispose(); renderer.domElement.remove(); },
  };
}
