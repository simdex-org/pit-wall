// The Pit Wall GT3: a car of our own, not after any real one. A low wedge nose with a long splitter, fenders that stand
// proud of a hood channel, a diamond canopy, and a wing on a single dorsal fin. Built from a lofted body, glass, frames and wheels;
// the wheel arches are cut on the GPU so their edge is a true circle.
// Frame: metres, x forward (nose +), y to the car's left, z up. Part names are the ones car3d.ts colours by damage.
import type * as THREE from "three";
import { assemble, CarModel, makeKit } from "./car3d";

type T3 = typeof THREE;

const AX = [1.4, -1.36], WY = 0.89, WZ = 0.345;

// x, half width, bottom z, shoulder z, crown z (the hood or deck centre); the fenders rise over the crown
const KEY = [[-2.38, 0.64, 0.34, 0.72, 0.74], [-2.3, 0.8, 0.26, 0.8, 0.82], [-2.1, 0.96, 0.18, 0.88, 0.9], [-1.75, 1.05, 0.14, 0.93, 0.94], [-1.36, 1.07, 0.12, 0.93, 0.94],
  [-1.0, 1.03, 0.11, 0.9, 0.92], [-0.6, 0.97, 0.1, 0.84, 0.87], [0.1, 0.95, 0.1, 0.8, 0.8], [0.7, 0.99, 0.11, 0.82, 0.77], [1.05, 1.05, 0.12, 0.84, 0.7],
  [1.4, 1.06, 0.12, 0.82, 0.66], [1.75, 1.04, 0.13, 0.74, 0.6], [2.0, 0.96, 0.15, 0.58, 0.51], [2.2, 0.82, 0.17, 0.42, 0.4], [2.34, 0.62, 0.17, 0.3, 0.31]];

export function buildCar2(T: T3): CarModel {
  const { layers, tri, geo, M, box, rod, plate, flat, quad, both, sideOf } = makeKit(T);
  const sq = (layer: "shell" | "glass", a: number[], b: number[], c: number[], d: number[], n: number[][], part: string, kind: string) => { // a quad with a normal per corner, so it shades smoothly into its neighbours
    tri(layer, a, b, c, n[0]!, n[1]!, n[2]!, part, kind);
    tri(layer, a, c, d, n[0]!, n[2]!, n[3]!, part, kind);
  };
  const zoneAt = (x: number, y: number) => (x > 1.25 ? "front" : x < -1.3 ? "rear" : Math.abs(y) > 0.6 ? (y > 0 ? "left" : "right") : "centre");

  const smooth = (K: number[][], SUB: number): number[][] => {
    const cr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
    const out: number[][] = [];
    for (let i = 0; i < K.length - 1; i++) {
      for (let k = 0; k < SUB; k++) out.push(K[i]!.map((_, j) => cr(K[Math.max(0, i - 1)]![j]!, K[i]![j]!, K[i + 1]![j]!, K[Math.min(K.length - 1, i + 2)]![j]!, k / SUB)));
    }
    return [...out, K[K.length - 1]!];
  };
  const SEC = smooth(KEY, 12), RM = 56;
  const secAt = (x: number): number[] => {
    for (let i = 0; i < SEC.length - 1; i++) {
      if (x <= SEC[i + 1]![0]!) { const a = SEC[i]!, b = SEC[i + 1]!, t = (x - a[0]!) / (b[0]! - a[0]!); return a.map((v, j) => v + (b[j]! - v) * t); }
    }
    return SEC[SEC.length - 1]!;
  };
  const ringPt = ([x, w, zb, zt, zc]: number[], th: number): number[] => {
    const c = Math.cos(th), sn = Math.sin(th), y = w! * Math.pow(Math.abs(c), 0.4), zm = (zb! + zt!) / 2, top = zc! + (zt! - zc!) * Math.pow(y / w!, 1.6);
    return [x!, y, sn < 0 ? zm - (zm - zb!) * Math.pow(-sn, 0.4) : zm + (top - zm) * Math.pow(sn, 0.4)];
  };
  const ring = (s: number[]): number[][] => {
    const half: number[][] = [];
    for (let k = 0; k <= RM; k++) { // half the steps by angle, half by height: the side is steep in z at its middle
      const t = (2 * k) / RM - 1;
      half.push(ringPt(s, (Math.PI / 2) * 0.5 * t + 0.5 * Math.sign(t) * Math.asin(Math.pow(Math.abs(t), 2.5))));
    }
    return [...half, ...half.slice(1, -1).reverse().map(([a, b, c]) => [a!, -b!, c!])];
  };
  const topZ = (x: number, y: number) => { const [, w, , zt, zc] = secAt(x); return zc! + (zt! - zc!) * Math.pow(Math.min(1, Math.abs(y) / w!), 1.6); };
  const sideY = (x: number, z: number) => {
    const [, w, zb, zt] = secAt(x), zm = (zb! + zt!) / 2, f = z < zm ? (zm - z) / (zm - zb!) : (z - zm) / (zt! - zm);
    const sn = Math.pow(Math.min(1, Math.max(0, f)), 2.5);
    return w! * Math.pow(Math.sqrt(1 - sn * sn), 0.4);
  };

  // ---- the body, tail to nose ----
  {
    const R = SEC.map(ring), n = R[0]!.length, pos: number[] = [], idx: number[] = [], quads: number[][] = [];
    for (const r of R) for (const p of r) pos.push(...p);
    for (let i = 0; i < R.length - 1; i++) for (let k = 0; k < n; k++) quads.push([i * n + k, i * n + ((k + 1) % n), (i + 1) * n + ((k + 1) % n), (i + 1) * n + k]);
    for (const [a, b, c, d] of quads) idx.push(a!, b!, c!, a!, c!, d!);
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const nn = g.attributes.normal!.array;
    const P = (i: number) => [pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!], N = (i: number) => [nn[3 * i]!, nn[3 * i + 1]!, nn[3 * i + 2]!];
    for (const [a, b, c, d] of quads) {
      const m = [0, 1, 2].map((j) => (P(a!)[j]! + P(b!)[j]! + P(c!)[j]! + P(d!)[j]!) / 4), zone = zoneAt(m[0]!, m[1]!), kind = m[2]! < 0.15 ? "carbon" : "body";
      tri("shell", P(a!), P(b!), P(c!), N(a!), N(b!), N(c!), zone, kind);
      tri("shell", P(a!), P(c!), P(d!), N(a!), N(c!), N(d!), zone, kind);
    }
    g.dispose();
    for (const [r, part, dir] of [[R[0]!, "rear", -1], [R[R.length - 1]!, "front", 1]] as [number[][], string, number][]) { // tail and nose caps
      const cx = r[0]![0]!, cz = r.reduce((s, p) => s + p[2]!, 0) / n, nv = [dir, 0, 0];
      for (let k = 0; k < n; k++) tri("shell", [cx, 0, cz], r[k]!, r[(k + 1) % n]!, nv, nv, nv, part, "body");
    }
  }

  // ---- wheel arches: the opening itself is cut in the shader; here the dark well behind it ----
  for (const ax of AX) {
    both((s) => {
      geo("frame", new T.CylinderGeometry(0.35, 0.35, 0.42, 40, 1, true, -2.2, 4.4), M(ax, s * 0.81, WZ), "frame", "frame"); // the upper two thirds only, and not past the bodywork: below the car it would show as a ring round the tyre
      for (const t0 of [0.69, -2.25]) geo("shell", new T.CylinderGeometry(0.357, 0.357, 0.14, 24, 1, true, t0, 1.56), M(ax, s * 0.97, WZ, 0, 0, 0, -1, 1, 1), ax > 0 ? "front" : "rear", "liner"); // the arch's edge has a thickness: a liner facing in, only below the top of the opening, so it never shows through the fender
      geo("frame", new T.CircleGeometry(0.35, 40), M(ax, s * 0.62, WZ, Math.PI / 2), "frame", "frame");
    });
  }

  // ---- the canopy: a diamond in plan, widest mid-door; smoked glass, flush with the bodywork ----
  const CK = smooth([[1.12, 0.8, 0.68, 0.74, 0.7], [0.8, 0.83, 0.74, 0.71, 0.91], [0.45, 0.85, 0.8, 0.65, 1.1], [0.0, 0.86, 0.84, 0.62, 1.22], [-0.5, 0.86, 0.86, 0.62, 1.24],
    [-0.9, 0.85, 0.89, 0.65, 1.16], [-1.25, 0.83, 0.92, 0.7, 1.04], [-1.6, 0.79, 0.94, 0.74, 0.96]], 4), CN = 10;
  const cab: number[][][] = CK.map(([x, wb, zb, wr, zr]) => {
    const top: number[][] = [];
    for (let k = 0; k <= CN; k++) { const y = wr! * (1 - (2 * k) / CN); top.push([x!, y, zr! + 0.035 * (1 - (y / wr!) ** 2)]); }
    return [[x!, wb! + 0.07, zb! - 0.16], ...top, [x!, -wb! - 0.07, zb! - 0.16]];
  });
  const WS = [1.12, 0.35], RW = [-0.9, -1.6], SW = [0.7, -1.15];
  const sill = (c: number[][], p: number, q: number) => { // where the side glass starts: just above the bodywork, so the two never cut through each other
    const a = c[p]!, b = c[q]!, t = Math.max(0.22, (topZ(a[0]!, a[1]!) + 0.012 - a[2]!) / (b[2]! - a[2]!));
    return a.map((v, e) => v + (b[e]! - v) * t);
  };
  const m = cab[0]!.length;
  const norm = (i: number, k: number): number[] => { // the canopy surface's normal at a grid point, from its neighbours, pointing out of the cabin
    const i0 = Math.max(0, i - 1), i1 = Math.min(cab.length - 1, i + 1), k0 = Math.max(0, k - 1), k1 = Math.min(m - 1, k + 1), P = cab[i]![k]!;
    const u = cab[i1]![k]!.map((v, e) => v - cab[i0]![k]![e]!), w = cab[i]![k1]!.map((v, e) => v - cab[i]![k0]![e]!);
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!], l = Math.hypot(...n) || 1, out = [0, P[1]!, P[2]! - 0.7];
    const f = n[0]! * out[0]! + n[1]! * out[1]! + n[2]! * out[2]! < 0 ? -1 : 1;
    return n.map((v) => (f * v) / l);
  };
  const inR = (x: number, [a, b]: number[]) => x <= Math.max(a!, b!) + 1e-6 && x >= Math.min(a!, b!) - 1e-6;
  for (let i = 0; i < cab.length - 1; i++) {
    const a = cab[i]!, b = cab[i + 1]!, xm = (cab[i]![0]![0]! + cab[i + 1]![0]![0]!) / 2, glassTop = inR(xm, WS) || inR(xm, RW);
    for (let k = 1; k < m - 2; k++) sq(glassTop ? "glass" : "shell", a[k]!, a[k + 1]!, b[k + 1]!, b[k]!, [norm(i, k), norm(i, k + 1), norm(i + 1, k + 1), norm(i + 1, k)], "centre", glassTop ? "glass" : "body");
    for (const [p, q] of [[0, 1], [m - 1, m - 2]] as [number, number][]) {
      const mid = (c: number[][]) => sill(c, p, q);
      const [np0, np1, nq0, nq1] = [norm(i, p), norm(i + 1, p), norm(i, q), norm(i + 1, q)];
      if (inR(xm, SW)) { sq("shell", a[p]!, b[p]!, mid(b), mid(a), [np0, np1, np1, np0], p === 0 ? "left" : "right", "body"); sq("glass", mid(a), mid(b), b[q]!, a[q]!, [np0, np1, nq1, nq0], "centre", "glass"); }
      else sq("shell", a[p]!, b[p]!, b[q]!, a[q]!, [np0, np1, nq1, nq0], "centre", "body");
    }
  }
  for (let i = 0; i < cab.length - 1; i++) { // an opaque dark liner just inside the canopy: looking through one window you see a cabin, not the window on the far side
    const sh = (p: number[]) => [p[0]!, p[1]! * 0.94, 0.75 + (p[2]! - 0.75) * 0.94];
    for (let k = 0; k < m - 1; k++) quad("frame", sh(cab[i]![k]!), sh(cab[i + 1]![k]!), sh(cab[i + 1]![k + 1]!), sh(cab[i]![k + 1]!), "frame", "frame");
  }
  box("frame", 0.5, 0.95, -0.7, 0.7, 0.5, 0.7, "frame", "frame"); // the dashboard and the rear bulkhead: dark, so the glass shows a cabin, not a void
  box("frame", -1.5, -1.3, -0.7, 0.7, 0.45, 1.0, "frame", "frame");

  // ---- the nose: splitter on rods, dive planes and a grille ----
  const onTop = (x0: number, x1: number, y0: number, y1: number, part: string, kind: string, N = 8) => {
    for (let j = 0; j < N; j++) {
      const ya = y0 + ((y1 - y0) * j) / N, yb = y0 + ((y1 - y0) * (j + 1)) / N, P = (x: number, y: number) => [x, y, topZ(x, y) + 0.014];
      quad("shell", P(x0, ya), P(x1, ya), P(x1, yb), P(x0, yb), part, kind);
    }
  };
  flat("shell", [[1.95, -0.98], [2.3, -0.94], [2.46, -0.6], [2.5, 0], [2.46, 0.6], [2.3, 0.94], [1.95, 0.98]], 0.075, 0.03, "front", "carbon");
  for (const y of [-0.75, -0.4, 0.4, 0.75]) rod("shell", [2.25, y, 0.1], [2.25, y, 0.19], 0.008, "front", "carbon");
  both((s) => plate("shell", [[2.1, 0.24], [2.34, 0.27], [2.2, 0.33]], s > 0 ? 0.8 : -0.84, 0.04, "front", "carbon"));
  quad("shell", [2.345, 0.42, 0.2], [2.345, -0.42, 0.2], [2.345, -0.42, 0.28], [2.345, 0.42, 0.28], "front", "vent");
  for (let k = 0; k < 4; k++) both((s) => onTop(1.5 + k * 0.08, 1.53 + k * 0.08, s * 0.12, s * 0.4, "front", "vent", 4));

  // ---- the sides: mirrors on stalks from the door top, a scoop on the roof ----
  both((s) => {
    geo("shell", new T.SphereGeometry(1, 24, 16), M(0.8, s * 1.03, 0.865, 0, 0, s * 0.12, 0.11, 0.06, 0.045), sideOf(s), "body");
    rod("shell", [0.78, s * 0.86, 0.78], [0.8, s * 0.99, 0.86], 0.016, sideOf(s), "carbon");
  });
  box("shell", -0.1, 0.3, -0.1, 0.1, 1.2, 1.28, "centre", "well");

  // ---- the tail: an exhaust slot, a diffuser with strakes; the wing on one dorsal fin ----
  quad("shell", [-2.385, -0.28, 0.4], [-2.385, 0.28, 0.4], [-2.385, 0.28, 0.5], [-2.385, -0.28, 0.5], "rear", "vent");
  flat("shell", [[-1.75, -0.9], [-1.75, 0.9], [-2.46, 0.78], [-2.46, -0.78]], 0.09, 0.025, "rear", "carbon");
  for (const y of [-0.6, -0.3, 0, 0.3, 0.6]) plate("shell", [[-1.8, 0.1], [-2.46, 0.1], [-2.46, 0.27], [-2.1, 0.17]], y - 0.01, 0.02, "rear", "carbon");
  plate("shell", [[-0.9, 0.95], [-0.9, 1.1], [-1.5, 1.06], [-1.95, 1.12], [-2.12, 1.25], [-2.3, 1.27], [-2.3, 1.14], [-2.2, 0.88]], -0.015, 0.03, "rear", "carbon");
  const foil = [[0, 0], [0.05, 0.035], [0.18, 0.055], [0.32, 0.045], [0.44, 0.018], [0.46, 0.004], [0.32, 0.004], [0.16, -0.006], [0.05, -0.008]].map(([u, v]) => [-2.16 - u!, 1.27 + v! - u! * 0.1]);
  plate("shell", foil, -0.98, 1.96, "rear", "carbon");
  const flap = [[0, 0], [0.04, 0.03], [0.14, 0.04], [0.24, 0.025], [0.26, 0.008], [0.14, 0], [0.04, -0.006]].map(([u, v]) => [-2.5 - u!, 1.34 + v! + u! * 0.15]);
  plate("shell", flap, -0.98, 1.96, "rear", "carbon");
  both((s) => plate("shell", [[-2.1, 1.12], [-2.72, 1.14], [-2.76, 1.5], [-2.18, 1.46]], s > 0 ? 0.98 : -1.0, 0.02, "rear", "carbon"));

  // ---- wheels: tyre, twelve-spoke rim with a centre nut, vented disc and caliper (its pads), and that corner's suspension ----
  const tyreProfile = [[0.25, -0.125], [0.3, -0.132], [0.335, -0.12], [0.345, -0.09], [0.347, 0], [0.345, 0.09], [0.335, 0.12], [0.3, 0.132], [0.25, 0.125]].map(([r, y]) => new T.Vector2(r, y));
  ([[AX[0]!, 1], [AX[0]!, -1], [AX[1]!, 1], [AX[1]!, -1]] as [number, number][]).forEach(([x, s], i) => {
    const y = s * WY, part = "s" + i, front = x > 0;
    geo("inner", new T.LatheGeometry(tyreProfile, 40), M(x, y, WZ), "tyre", "tyre");
    geo("inner", new T.CylinderGeometry(0.245, 0.245, 0.22, 32, 1, true), M(x, y, WZ), part, "rim");
    geo("inner", new T.TorusGeometry(0.245, 0.014, 6, 32), M(x, y + s * 0.118, WZ, Math.PI / 2), part, "rim");
    for (let k = 0; k < 12; k++) { const a = (k / 12) * 2 * Math.PI; geo("inner", new T.BoxGeometry(0.2, 0.016, 0.026), M(x + 0.125 * Math.cos(a), y + s * 0.1, WZ + 0.125 * Math.sin(a), 0, -a, 0), part, "rim"); }
    geo("inner", new T.CylinderGeometry(0.05, 0.055, 0.05, 16), M(x, y + s * 0.105, WZ), part, "rim");
    geo("inner", new T.CylinderGeometry(0.03, 0.03, 0.04, 6), M(x, y + s * 0.13, WZ), part, "rim");
    geo("inner", new T.CylinderGeometry(0.2, 0.2, 0.032, 36), M(x, y - s * 0.02, WZ), "b" + i, "brake");
    geo("inner", new T.CylinderGeometry(0.1, 0.1, 0.05, 20), M(x, y - s * 0.01, WZ), "b" + i, "brake");
    geo("inner", new T.BoxGeometry(0.1, 0.075, 0.17), M(x + (front ? 0.14 : -0.14), y - s * 0.01, WZ + 0.11, 0, front ? -0.6 : 0.6, 0), "b" + i, "brake");

    // double wishbones (two tubes per arm, meeting at a ball joint on the upright), a pushrod to a rocker, a coil-over damper with its spring,
    // the upright with its hub and, at the front, the track rod: seen through the bodywork
    const Y = (v: number) => s * v, up = [x, Y(0.7), 0.5], lo = [x, Y(0.72), 0.19], fx = front ? 1 : -1;
    for (const [j, top] of [[lo, false], [up, true]] as [number[], boolean][]) {
      const zc = top ? 0.52 : 0.17;
      rod("inner", [x - 0.26, Y(0.3), zc], j, 0.013, part, "arm");
      rod("inner", [x + 0.26, Y(0.3), zc], j, 0.013, part, "arm");
      rod("inner", [x - 0.26, Y(0.3), zc], [x + 0.26, Y(0.3), zc], 0.016, part, "arm");
      geo("inner", new T.SphereGeometry(0.03, 10, 8), M(j[0]!, j[1]!, j[2]!), part, "arm");
    }
    rod("inner", up, lo, 0.026, part, "arm"); // the upright
    rod("inner", [x, Y(0.7), WZ], [x, Y(0.8), WZ], 0.035, part, "arm"); // the hub
    const rk = [x - 0.06 * fx, Y(0.4), Math.min(0.7, topZ(x, 0.4) - 0.16)]; // the rocker, high on the chassis but under the hood
    rod("inner", [x + 0.02 * fx, Y(0.69), 0.2], rk, 0.014, part, "arm"); // pushrod from the lower joint
    geo("inner", new T.CylinderGeometry(0.03, 0.03, 0.12, 12), M(rk[0]!, rk[1]!, rk[2]!, Math.PI / 2, 0, 0), part, "arm");
    const d0 = rk, d1 = [x - 0.06 * fx, Y(0.18), Math.min(0.9, topZ(x, 0.18) - 0.1)], dv = [d1[0]! - d0[0]!, d1[1]! - d0[1]!, d1[2]! - d0[2]!];
    const mid = [d0[0]! + dv[0]! * 0.5, d0[1]! + dv[1]! * 0.5, d0[2]! + dv[2]! * 0.5];
    rod("inner", d0, mid, 0.026, part, "arm"); // damper body
    rod("inner", mid, d1, 0.012, part, "arm"); // damper rod
    for (let k = 1; k < 9; k++) { // the spring: rings round the damper
      const t = 0.15 + (k / 9) * 0.7, c = [d0[0]! + dv[0]! * t, d0[1]! + dv[1]! * t, d0[2]! + dv[2]! * t], n = new T.Vector3(dv[0], dv[1], dv[2]).normalize();
      const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), n);
      geo("inner", new T.TorusGeometry(0.045, 0.006, 5, 14), new T.Matrix4().compose(new T.Vector3(c[0], c[1], c[2]), q, new T.Vector3(1, 1, 1)), part, "rim");
    }
    if (front) rod("inner", [x - 0.16, Y(0.22), 0.27], [x - 0.12, Y(0.74), 0.3], 0.011, part, "arm"); // the track rod
  });

  return assemble(T, layers, AX);
}
