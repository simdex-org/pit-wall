// A generic GT3 (after the silhouettes of the 650S and 720S GT3: a low wedge nose over a long splitter, a teardrop canopy, wide
// rear haunches, side intakes, a swan-neck wing) built from three.js geometry and drawn with WebGL, whose depth buffer lets parts
// meet and cross without one showing through another. Every triangle names its part, so each part is painted by the damage ACC
// reports for it: the five body zones (front, rear, left, right, centre), each corner's suspension (s0..s3, FL FR RL RR) and brake
// pads (b0..b3); the glass, tyres, steering, seat and cage are drawn neutral, since ACC says nothing about them.
// Frame: metres, x forward (nose +), y to the car's left, z up.
import type * as THREE from "three";
import { Tokens, tokens } from "./canvas";

type T3 = typeof THREE;
type V3 = [number, number, number];
type Layer = "shell" | "inner" | "glass" | "frame";
type PartFn = (x: number, y: number, z: number) => string;
interface LayerData { pos: number[]; nor: number[]; part: string[]; kind: string[] }

const rgbOf = (s: string): number[] => (s.match(/\d+(\.\d+)?/g) ?? [0, 0, 0]).slice(0, 3).map(Number);

/** Level 0..1 as --ok, --warn, --bad in between. */
export function levelColour(t: number, tk: Pick<Tokens, "ok" | "warn" | "bad">): number[] {
  const a = rgbOf(tk.ok), b = rgbOf(tk.warn), c = rgbOf(tk.bad), u = Math.max(0, Math.min(1, t));
  const [p, q, f] = u < 0.5 ? [a, b, u * 2] : [b, c, (u - 0.5) * 2];
  return p!.map((v, i) => v + (q![i]! - v) * f!);
}

/** Where each part's figure sits on the car, and the way that surface faces. */
export const ANCHOR: Record<string, [V3, V3]> = {
  front: [[2.5, 0, 0.4], [1, 0, 0]], rear: [[-2.5, 0, 0.95], [-1, 0, 0]], left: [[-0.3, 1.05, 0.55], [0, 1, 0]], right: [[-0.3, -1.05, 0.55], [0, -1, 0]],
  centre: [[-0.2, 0, 1.3], [0, 0, 1]], s0: [[1.36, 1.08, 0.34], [0.5, 0.85, 0]], s1: [[1.36, -1.08, 0.34], [0.5, -0.85, 0]], s2: [[-1.32, 1.08, 0.34], [-0.5, 0.85, 0]],
  s3: [[-1.32, -1.08, 0.34], [-0.5, -0.85, 0]],
};
export const VIEWS: Record<string, [az: number, el: number]> = {
  iso: [0.75, 0.34], top: [Math.PI, 1.5707], front: [0, 0.08], rear: [Math.PI, 0.08], left: [Math.PI / 2, 0.06], right: [-Math.PI / 2, 0.06],
};

export interface CarModel {
  group: THREE.Group;
  meshes: Record<Layer, THREE.Mesh>;
  mats: Record<Layer, THREE.Material>;
  /** lv: part to level 0..1 or null; xray: the bodywork see-through. */
  update(lv: Record<string, number | null>, tk: Tokens, xray: boolean): void;
}

/** The car as triangles in four layers: shell (bodywork and aero), inner (wheels, wells, suspension, steering, seat), glass and frames. */
export function buildCar(T: T3): CarModel {
  const layers = {} as Record<Layer, LayerData>;
  for (const k of ["shell", "inner", "glass", "frame"] as Layer[]) layers[k] = { pos: [], nor: [], part: [], kind: [] };
  const zoneAt: PartFn = (x, y, z) => (x > 1.15 ? "front" : x < -1.15 ? "rear" : Math.abs(y) > 0.62 && z < 0.92 ? (y > 0 ? "left" : "right") : "centre");
  const tri = (layer: Layer, a: number[], b: number[], c: number[], na: number[], nb: number[], nc: number[], part: string | PartFn, kind: string) => {
    const o = layers[layer];
    o.pos.push(...a, ...b, ...c);
    o.nor.push(...na, ...nb, ...nc);
    o.part.push(typeof part === "function" ? part((a[0]! + b[0]! + c[0]!) / 3, (a[1]! + b[1]! + c[1]!) / 3, (a[2]! + b[2]! + c[2]!) / 3) : part);
    o.kind.push(kind);
  };
  /** Any three.js geometry, placed by a matrix, into a layer. */
  const geo = (layer: Layer, g0: THREE.BufferGeometry, m: THREE.Matrix4 | null, part: string, kind: string) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (m) g.applyMatrix4(m);
    g.computeVertexNormals();
    const p = g.attributes.position!.array, n = g.attributes.normal!.array;
    for (let i = 0; i < p.length; i += 9) {
      tri(layer, [p[i]!, p[i + 1]!, p[i + 2]!], [p[i + 3]!, p[i + 4]!, p[i + 5]!], [p[i + 6]!, p[i + 7]!, p[i + 8]!], [n[i]!, n[i + 1]!, n[i + 2]!], [n[i + 3]!, n[i + 4]!, n[i + 5]!], [n[i + 6]!, n[i + 7]!, n[i + 8]!], part, kind);
    }
    g.dispose();
  };
  const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz, "ZYX")), new T.Vector3(sx, sy, sz));
  const box = (layer: Layer, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, part: string, kind: string) =>
    geo(layer, new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), part, kind);
  const v3 = (a: number[]) => new T.Vector3(a[0], a[1], a[2]);
  const rod = (layer: Layer, a: number[], b: number[], r: number, part: string, kind: string) => { // a cylinder from a to b
    const A = v3(a), B = v3(b), d = B.clone().sub(A), g = new T.CylinderGeometry(r, r, d.length(), 8, 1);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize()));
    const mid = A.clone().add(B).multiplyScalar(0.5);
    g.translate(mid.x, mid.y, mid.z);
    geo(layer, g, null, part, kind);
  };
  const tube = (layer: Layer, pts: number[][], r: number, closed: boolean, part: string, kind: string) =>
    geo(layer, new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(v3), closed), pts.length * 4, r, 6, closed), null, part, kind);
  /** A flat shape drawn in the x-z plane (u = x, v = z), extruded `depth` towards -y from y0 + depth. */
  const plate = (layer: Layer, pts: number[][], y0: number, depth: number, part: string, kind: string) => {
    const g = new T.ExtrudeGeometry(new T.Shape(pts.map(([u, v]) => new T.Vector2(u, v))), { depth, bevelEnabled: false, curveSegments: 6 });
    g.rotateX(Math.PI / 2);
    g.translate(0, y0 + depth, 0);
    geo(layer, g, null, part, kind);
  };
  /** A flat shape drawn in the x-y plane, extruded `depth` up from z0. */
  const flat = (layer: Layer, pts: number[][], z0: number, depth: number, part: string, kind: string) => {
    const g = new T.ExtrudeGeometry(new T.Shape(pts.map(([u, v]) => new T.Vector2(u, v))), { depth, bevelEnabled: false });
    g.translate(0, 0, z0);
    geo(layer, g, null, part, kind);
  };
  const quadN = (a: number[], b: number[], c: number[]) => {
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!], l = Math.hypot(...n) || 1;
    return n.map((e) => e / l);
  };
  const quad = (layer: Layer, a: number[], b: number[], c: number[], d: number[], part: string | PartFn, kind: string) => {
    const n = quadN(a, b, c);
    tri(layer, a, b, c, n, n, n, part, kind);
    tri(layer, a, c, d, n, n, n, part, kind);
  };
  const both = (fn: (s: number) => void) => { fn(1); fn(-1); };
  const sideOf = (s: number) => (s > 0 ? "left" : "right");

  // ---- the body: key sections from tail to nose (x, half width, bottom z, beltline z, crown z: the hood or deck centre),
  // smoothed along the car (Catmull-Rom), round in section (a superellipse whose top dips from the fenders to the hood) ----
  const KEY = [[-2.4, 0.7, 0.38, 0.78, 0.8], [-2.32, 0.88, 0.24, 0.88, 0.91], [-2.2, 0.97, 0.16, 0.94, 0.96], [-1.8, 1.02, 0.11, 0.95, 0.97], [-1.32, 1.03, 0.11, 0.93, 0.95], [-0.88, 1.0, 0.1, 0.88, 0.91],
    [-0.4, 0.94, 0.1, 0.8, 0.83], [0.3, 0.93, 0.1, 0.76, 0.77], [0.88, 0.99, 0.1, 0.78, 0.7], [1.36, 1.02, 0.11, 0.81, 0.62], [1.82, 0.99, 0.13, 0.7, 0.54],
    [2.16, 0.93, 0.15, 0.5, 0.45], [2.36, 0.8, 0.19, 0.38, 0.36]];
  const smooth = (K: number[][], SUB: number): number[][] => {
    const cr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
    const out: number[][] = [];
    for (let i = 0; i < K.length - 1; i++) {
      for (let k = 0; k < SUB; k++) out.push(K[i]!.map((_, j) => cr(K[Math.max(0, i - 1)]![j]!, K[i]![j]!, K[i + 1]![j]!, K[Math.min(K.length - 1, i + 2)]![j]!, k / SUB)));
    }
    return [...out, K[K.length - 1]!];
  };
  const SEC = smooth(KEY, 6), RM = 22;
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
    for (let k = 0; k <= RM; k++) half.push(ringPt(s, -Math.PI / 2 + (Math.PI * k) / RM));
    return [...half, ...half.slice(1, -1).reverse().map(([a, b, c]) => [a!, -b!, c!])];
  };
  const topZ = (x: number, y: number) => { const [, w, , zt, zc] = secAt(x); return zc! + (zt! - zc!) * Math.pow(Math.min(1, Math.abs(y) / w!), 1.6); }; // the upper surface
  const sideY = (x: number, z: number) => { // the side surface
    const [, w, zb, zt] = secAt(x), zm = (zb! + zt!) / 2, f = z < zm ? (zm - z) / (zm - zb!) : (z - zm) / (zt! - zm);
    const sn = Math.pow(Math.min(1, Math.max(0, f)), 2.5);
    return w! * Math.pow(Math.sqrt(1 - sn * sn), 0.4);
  };
  const AX = [1.36, -1.32], AR = 0.42;
  const inArch = (x: number, y: number, z: number) => Math.abs(y) > 0.6 && AX.some((a) => Math.hypot(x - a, z - 0.34) < AR);
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
      const m = [0, 1, 2].map((j) => (P(a!)[j]! + P(b!)[j]! + P(c!)[j]! + P(d!)[j]!) / 4);
      const ny = (N(a!)[1]! + N(b!)[1]! + N(c!)[1]! + N(d!)[1]!) / 4, kind = m[2]! < 0.15 ? "carbon" : "body"; // the floor is carbon, not a zone's paint
      if (inArch(m[0]!, m[1]!, m[2]!) && Math.abs(ny) > 0.55) continue; // the wheel arch openings: cut in the side only; the fender stays over the wheel
      tri("shell", P(a!), P(b!), P(c!), N(a!), N(b!), N(c!), zoneAt, kind);
      tri("shell", P(a!), P(c!), P(d!), N(a!), N(c!), N(d!), zoneAt, kind);
    }
    g.dispose();
    for (const [r, part, dir] of [[R[0]!, "rear", -1], [R[R.length - 1]!, "front", 1]] as [number[][], string, number][]) { // tail and nose caps
      const cx = r[0]![0]!, cz = r.reduce((s, p) => s + p[2]!, 0) / n, nv = [dir, 0, 0];
      for (let k = 0; k < n; k++) tri("shell", [cx, 0, cz], r[k]!, r[(k + 1) % n]!, nv, nv, nv, part, "body");
    }
  }
  // ---- wheel arches: a lip round each opening and a dark well inside ----
  for (const ax of AX) {
    both((s) => {
      const lip: number[][] = [];
      for (let k = 0; k <= 24; k++) {
        const a = -0.25 + ((Math.PI + 0.5) * k) / 24, x = ax + (AR + 0.005) * Math.cos(a), z = 0.34 + (AR + 0.005) * Math.sin(a);
        const zc = Math.min(z, secAt(x)[3]! - 0.09); // the opening's edge: round below, flat under the fender's shoulder
        lip.push([x, s * (sideY(x, zc) - 0.004), zc]);
      }
      tube("shell", lip, 0.022, false, ax > 0 ? "front" : "rear", "carbon");
      geo("inner", new T.CylinderGeometry(0.355, 0.355, 0.32, 28, 1, true, -Math.PI * 0.6, Math.PI * 1.2), M(ax, s * 0.83, 0.34), "well", "well"); // the drum over the wheel's top, just clear of the tyre and under the fender
      geo("inner", new T.CircleGeometry(0.355, 28), M(ax, s * 0.67, 0.34, Math.PI / 2), "well", "well");
    });
  }
  // ---- the cabin: a teardrop canopy; windscreen, side windows and rear window are glass in black frames ----
  const CK = smooth([[0.98, 0.74, 0.76, 0.68, 0.78], [0.62, 0.79, 0.78, 0.62, 1.05], [0.2, 0.81, 0.81, 0.57, 1.17], [-0.5, 0.83, 0.86, 0.56, 1.19], [-1.0, 0.82, 0.9, 0.62, 1.07], [-1.4, 0.78, 0.94, 0.7, 0.97]], 4), CN = 10;
  const cab: number[][][] = CK.map(([x, wb, zb, wr, zr]) => {
    const top: number[][] = [];
    for (let k = 0; k <= CN; k++) { const y = wr! * (1 - (2 * k) / CN); top.push([x!, y, zr! + 0.035 * (1 - (y / wr!) ** 2)]); }
    return [[x!, wb! + 0.03, zb! - 0.07], ...top, [x!, -wb! - 0.03, zb! - 0.07]]; // the base sinks into the bodywork: no gap under the windows
  });
  const xs = cab.map((r) => r[0]![0]!), WS = [0.98, 0.3], RW = [-0.62, -1.4], SW = [0.8, -1.02]; // windscreen, rear window, side window x ranges
  const inR = (x: number, [a, b]: number[]) => x <= Math.max(a!, b!) + 1e-6 && x >= Math.min(a!, b!) - 1e-6, m = cab[0]!.length;
  for (let i = 0; i < cab.length - 1; i++) {
    const a = cab[i]!, b = cab[i + 1]!, xm = (xs[i]! + xs[i + 1]!) / 2, glassTop = inR(xm, WS) || inR(xm, RW);
    for (let k = 1; k < m - 2; k++) quad(glassTop ? "glass" : "shell", a[k]!, a[k + 1]!, b[k + 1]!, b[k]!, "centre", glassTop ? "glass" : "body");
    for (const [p, q] of [[0, 1], [m - 1, m - 2]] as [number, number][]) { // the sides: window glass over the door's top, or a pillar
      const mid = (c: number[][]) => c[p]!.map((v, e) => v + (c[q]![e]! - v) * 0.22);
      if (inR(xm, SW)) { quad("shell", a[p]!, b[p]!, mid(b), mid(a), p === 0 ? "left" : "right", "body"); quad("glass", mid(a), mid(b), b[q]!, a[q]!, "centre", "glass"); }
      else quad("shell", a[p]!, b[p]!, b[q]!, a[q]!, "centre", "body");
    }
  }
  // frames: the outline of each window, a little proud of the glass
  const near = (x: number) => xs.reduce((bi, v, i) => (Math.abs(v - x) < Math.abs(xs[bi]! - x) ? i : bi), 0);
  for (const rg of [WS, RW]) {
    const lo = Math.min(near(rg[0]!), near(rg[1]!)), hi = Math.max(near(rg[0]!), near(rg[1]!)), out: number[][] = [];
    for (let k = 1; k < m - 1; k++) out.push(cab[lo]![k]!);
    for (let i = lo + 1; i <= hi; i++) out.push(cab[i]![m - 2]!);
    for (let k = m - 3; k >= 1; k--) out.push(cab[hi]![k]!);
    for (let i = hi - 1; i > lo; i--) out.push(cab[i]![1]!);
    tube("frame", out.map(([x, y, z]) => [x!, y! * 1.012, z! + 0.006]), 0.016, true, "frame", "frame");
  }
  both((s) => { // the side window's frame: along its sill, up the pillars, along the roof edge
    const lo = Math.min(near(SW[0]!), near(SW[1]!)), hi = Math.max(near(SW[0]!), near(SW[1]!)), p = s > 0 ? 0 : m - 1, q = s > 0 ? 1 : m - 2, out: number[][] = [];
    for (let i = lo; i <= hi; i++) out.push(cab[i]![p]!.map((v, e) => v + (cab[i]![q]![e]! - v) * 0.22));
    for (let i = hi; i >= lo; i--) out.push(cab[i]![q]!);
    tube("frame", out.map(([x, y, z]) => [x!, y! * 1.01, z!]), 0.016, true, "frame", "frame");
  });
  // ---- aero and details, each on the surface it belongs to ----
  flat("shell", [[1.98, -0.97], [2.36, -0.92], [2.5, -0.55], [2.53, 0], [2.5, 0.55], [2.36, 0.92], [1.98, 0.97]], 0.09, 0.035, "front", "carbon"); // splitter
  both((s) => plate("shell", [[2.2, 0.24], [2.42, 0.3], [2.34, 0.35]], s > 0 ? 0.8 : -0.84, 0.04, "front", "carbon")); // canards
  both((s) => { // headlights: a swept slit along each front fender, and the intakes under them
    const g = [[2.02, 0.5], [2.16, 0.62], [2.28, 0.74], [2.27, 0.79], [2.12, 0.7], [1.98, 0.57]].map(([x, y]) => [x!, s * y!, topZ(x!, y!) + 0.006]), up = [0, 0, 1];
    for (const [i, j, k] of [[0, 1, 5], [1, 4, 5], [1, 2, 4], [2, 3, 4]] as number[][]) tri("shell", g[i!]!, g[j!]!, g[k!]!, up, up, up, "front", "light");
    const pts = [[2.375, 0.3, 0.21], [2.375, 0.66, 0.21], [2.33, 0.72, 0.33], [2.375, 0.3, 0.33]].map(([x, y, z]) => [x!, s * y!, z!]);
    quad("shell", pts[0]!, pts[1]!, pts[2]!, pts[3]!, "front", "vent");
  });
  quad("shell", [2.38, 0.26, 0.21], [2.38, -0.26, 0.21], [2.38, -0.26, 0.32], [2.38, 0.26, 0.32], "front", "vent"); // the central intake
  const onTop = (x0: number, x1: number, y0: number, y1: number, part: string, kind: string, N = 6) => { // a strip lying on the upper surface
    for (let j = 0; j < N; j++) {
      const ya = y0 + ((y1 - y0) * j) / N, yb = y0 + ((y1 - y0) * (j + 1)) / N, P = (x: number, y: number) => [x, y, topZ(x, y) + 0.006];
      quad("shell", P(x0, ya), P(x1, ya), P(x1, yb), P(x0, yb), part, kind);
    }
  };
  const onSide = (s: number, x0: number, x1: number, zlo: (t: number) => number, zhi: (t: number) => number, part: string, kind: string, N = 16) => { // a patch on the side surface
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < 4; i++) {
        const P = (tj: number, ti: number) => { const x = x0 + (x1 - x0) * tj, z = zlo(tj) + (zhi(tj) - zlo(tj)) * ti; return [x, s * (sideY(x, z) + 0.012), z]; }; // clear of the body, so the two never fight over a pixel
        const q = [P(j / N, i / 4), P((j + 1) / N, i / 4), P((j + 1) / N, (i + 1) / 4), P(j / N, (i + 1) / 4)];
        const o = s > 0 ? q : q.reverse();
        quad("shell", o[0]!, o[1]!, o[2]!, o[3]!, part, kind);
      }
    }
  };
  for (let k = 0; k < 5; k++) both((s) => { const x = 1.48 + k * 0.07; onTop(x, x + 0.035, s * 0.14, s * 0.46, "front", "vent"); }); // hood louvres
  for (let k = 0; k < 4; k++) both((s) => { const x = 1.62 + k * 0.06; onTop(x, x + 0.03, s * 0.64, s * 0.84, "front", "vent"); }); // fender louvres
  both((s) => { // the intake behind the door (a scoop narrowing forward), and the side skirt
    onSide(s, -0.4, -1.02, (t) => 0.44 + 0.1 * (1 - t), () => 0.72, sideOf(s), "well"); // black, like a real intake: it is a hole, not paint
    plate("shell", [[-0.95, 0.07], [0.95, 0.07], [0.98, 0.14], [-0.98, 0.14]], s > 0 ? 0.9 : -0.98, 0.08, sideOf(s), "carbon");
  });
  both((s) => { // mirrors: a pod on a stalk from the door top
    geo("shell", new T.SphereGeometry(1, 14, 10), M(0.64, s * 0.99, 0.88, 0, 0, s * 0.15, 0.12, 0.06, 0.045), sideOf(s), "body");
    rod("shell", [0.62, s * 0.8, 0.79], [0.64, s * 0.95, 0.87], 0.012, sideOf(s), "carbon");
  });
  // the tail: lights across it, a mesh grille, the exhausts and the diffuser with its fins
  both((s) => {
    const lb: number[][] = [];
    for (let k = 0; k <= 8; k++) { const y = 0.18 + (0.62 * k) / 8, x = -2.4 + 0.35 * Math.max(0, (y - 0.55) / 0.25) ** 2; lb.push([x, s * Math.min(y, sideY(x, 0.74) + 0.004), 0.74]); }
    tube("shell", lb, 0.018, false, "rear", "light");
  });
  quad("shell", [-2.405, -0.52, 0.44], [-2.405, 0.52, 0.44], [-2.405, 0.52, 0.64], [-2.405, -0.52, 0.64], "rear", "vent");
  both((s) => {
    geo("shell", new T.CylinderGeometry(0.055, 0.055, 0.1, 16, 1, true), M(-2.4, s * 0.2, 0.53, 0, 0, Math.PI / 2), "rear", "vent");
    geo("shell", new T.CircleGeometry(0.05, 16), M(-2.36, s * 0.2, 0.53, 0, Math.PI / 2, 0), "rear", "vent");
  });
  flat("shell", [[-1.8, -0.92], [-1.8, 0.92], [-2.42, 0.92], [-2.42, -0.92]], 0.09, 0.02, "rear", "carbon");
  for (const y of [-0.7, -0.42, -0.14, 0.14, 0.42, 0.7]) plate("shell", [[-1.85, 0.1], [-2.42, 0.1], [-2.42, 0.38], [-2.1, 0.18]], y - 0.01, 0.02, "rear", "carbon");
  // the wing: an airfoil on two swan necks, with end plates and a gurney flap
  const foil = [[0, 0], [0.05, 0.035], [0.16, 0.055], [0.3, 0.045], [0.42, 0.02], [0.44, 0.005], [0.3, 0.005], [0.15, -0.005], [0.05, -0.008]].map(([u, v]) => [-2.02 - u!, 1.2 + v! - u! * 0.08]);
  plate("shell", foil, -0.95, 1.9, "rear", "carbon");
  plate("shell", [[-2.44, 1.165], [-2.462, 1.165], [-2.462, 1.215], [-2.44, 1.205]], -0.95, 1.9, "rear", "carbon");
  both((s) => plate("shell", [[-1.96, 1.02], [-2.5, 1.0], [-2.52, 1.3], [-2.3, 1.33], [-1.98, 1.24]], s > 0 ? 0.95 : -0.97, 0.02, "rear", "carbon"));
  both((s) => plate("shell", [[-1.98, topZ(-1.98, 0.34) - 0.02], [-2.08, topZ(-2.08, 0.34) - 0.02], [-2.16, 1.1], [-2.24, 1.27], [-2.17, 1.29], [-2.07, 1.12]], s > 0 ? 0.32 : -0.35, 0.03, "rear", "carbon"));
  // ---- wheels: tyre, ten-spoke rim (that corner's suspension), brake disc and caliper (its pads) ----
  const tyreProfile = [[0.24, -0.15], [0.3, -0.155], [0.335, -0.145], [0.343, -0.11], [0.345, 0], [0.343, 0.11], [0.335, 0.145], [0.3, 0.155], [0.24, 0.15]].map(([r, y]) => new T.Vector2(r, y));
  ([[AX[0]!, 1], [AX[0]!, -1], [AX[1]!, 1], [AX[1]!, -1]] as [number, number][]).forEach(([x, s], i) => {
    const y = s * 0.84, part = "s" + i, front = x > 0;
    geo("inner", new T.LatheGeometry(tyreProfile, 36), M(x, y, 0.34), "tyre", "tyre");
    geo("inner", new T.CylinderGeometry(0.243, 0.243, 0.24, 28, 1, true), M(x, y, 0.34), part, "rim"); // the barrel
    geo("inner", new T.TorusGeometry(0.243, 0.012, 6, 28), M(x, y + s * 0.115, 0.34, Math.PI / 2), part, "rim"); // the lip
    for (let k = 0; k < 10; k++) { const a = (k / 10) * 2 * Math.PI; geo("inner", new T.BoxGeometry(0.205, 0.018, 0.028), M(x + 0.12 * Math.cos(a), y + s * 0.095, 0.34 + 0.12 * Math.sin(a), 0, -a, 0), part, "rim"); }
    geo("inner", new T.CylinderGeometry(0.045, 0.05, 0.05, 12), M(x, y + s * 0.1, 0.34), part, "rim"); // the hub
    geo("inner", new T.CylinderGeometry(0.19, 0.19, 0.03, 28), M(x, y - s * 0.02, 0.34), "b" + i, "brake"); // the disc
    geo("inner", new T.BoxGeometry(0.1, 0.07, 0.15), M(x + (front ? 0.13 : -0.13), y - s * 0.01, 0.45, 0, front ? -0.6 : 0.6, 0), "b" + i, "brake"); // the caliper
    // double wishbones, the damper and, at the front, the track rod: seen through the bodywork
    for (const [zi, zo] of [[0.18, 0.2], [0.46, 0.5]] as [number, number][]) {
      rod("inner", [x - 0.22, s * 0.34, zi], [x, s * 0.72, zo], 0.014, part, "arm");
      rod("inner", [x + 0.22, s * 0.34, zi], [x, s * 0.72, zo], 0.014, part, "arm");
    }
    rod("inner", [x, s * 0.7, 0.24], [x - 0.05 * Math.sign(x), s * 0.4, 0.66], 0.028, part, "arm");
    if (front) rod("inner", [x - 0.14, s * 0.22, 0.27], [x - 0.12, s * 0.72, 0.28], 0.012, part, "arm");
  });
  // ---- inside: steering rack, column and wheel, seat, roll cage (no data from ACC: neutral) ----
  rod("inner", [1.22, -0.24, 0.27], [1.22, 0.24, 0.27], 0.02, "steer", "neutral");
  rod("inner", [1.2, 0.38, 0.3], [0.45, 0.38, 0.8], 0.018, "steer", "neutral");
  geo("inner", new T.TorusGeometry(0.15, 0.016, 8, 24), M(0.42, 0.38, 0.82, 0, -1.1, 0), "steer", "neutral");
  box("inner", 0.02, 0.12, 0.22, 0.56, 0.22, 0.82, "seat", "neutral");
  box("inner", 0.02, 0.38, 0.22, 0.56, 0.2, 0.3, "seat", "neutral");
  for (const [a, b] of [[[0.78, 0.62, 0.3], [0.2, 0.55, 1.12]], [[0.78, -0.62, 0.3], [0.2, -0.55, 1.12]], [[0.2, 0.55, 1.12], [0.2, -0.55, 1.12]], [[0.2, 0.55, 1.12], [-0.7, 0.55, 1.12]],
    [[0.2, -0.55, 1.12], [-0.7, -0.55, 1.12]], [[-0.7, 0.55, 1.12], [-0.7, -0.55, 1.12]], [[-0.7, 0.55, 1.12], [-0.75, 0.62, 0.35]], [[-0.7, -0.55, 1.12], [-0.75, -0.62, 0.35]]] as number[][][]) {
    rod("inner", a!, b!, 0.02, "cage", "neutral");
  }

  // ---- into three.js: one mesh per layer, colours per triangle ----
  const mats = {
    shell: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.08, side: T.DoubleSide }),
    inner: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1, side: T.DoubleSide }),
    glass: new T.MeshStandardMaterial({ color: 0x1b2733, roughness: 0.08, metalness: 0.4, transparent: true, opacity: 0.88, side: T.DoubleSide, depthWrite: false }),
    frame: new T.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.6 }),
  };
  const meshes = {} as Record<Layer, THREE.Mesh>;
  for (const k of ["shell", "inner", "glass", "frame"] as Layer[]) {
    const o = layers[k], g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(o.pos, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(o.nor, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(new Float32Array(o.pos.length).fill(1), 3));
    meshes[k] = new T.Mesh(g, mats[k]);
    meshes[k].renderOrder = k === "glass" ? 2 : 1;
  }
  const group = new T.Group();
  for (const k of ["inner", "shell", "frame", "glass"] as Layer[]) group.add(meshes[k]);
  let key = "";
  return {
    group, meshes, mats,
    update(lv, tk, xray) {
      const k2 = JSON.stringify([lv, tk.ok, tk.warn, tk.bad, tk.raise, tk.bg, xray]);
      if (k2 === key) return;
      key = k2;
      const lin = (rgb: number[]) => new T.Color().setRGB(rgb[0]! / 255, rgb[1]! / 255, rgb[2]! / 255, T.SRGBColorSpace);
      const base = rgbOf(tk.raise), dark = rgbOf(tk.bg);
      const cache: Record<string, THREE.Color> = {};
      const colourOf = (part: string, kind: string): THREE.Color => {
        const id = part + "|" + kind;
        if (cache[id]) return cache[id]!;
        const t = lv[part];
        let c: number[];
        if (kind === "tyre") c = [26, 28, 31];
        else if (kind === "well") c = [14, 15, 17];
        else if (kind === "neutral" || t == null) c = [128, 133, 140];
        else {
          c = levelColour(t, tk);
          if (kind === "carbon") c = c.map((v, i) => v * 0.5 + base[i]! * 0.5);
          else if (kind === "vent") c = c.map((v, i) => v * 0.18 + dark[i]! * 0.82);
          else if (kind === "light") c = c.map((v) => v + (255 - v) * 0.6);
          else if (kind === "rim") c = c.map((v) => v * 0.85);
        }
        return (cache[id] = lin(c));
      };
      for (const k of ["shell", "inner"] as const) {
        const o = layers[k], col = meshes[k].geometry.attributes.color!, a = col.array as Float32Array;
        for (let t = 0; t < o.part.length; t++) {
          const c = colourOf(o.part[t]!, o.kind[t]!);
          for (let v = 0; v < 3; v++) { a[9 * t + 3 * v] = c.r; a[9 * t + 3 * v + 1] = c.g; a[9 * t + 3 * v + 2] = c.b; }
        }
        col.needsUpdate = true;
      }
      mats.shell.transparent = xray; mats.shell.opacity = xray ? 0.16 : 1; mats.shell.depthWrite = !xray; mats.shell.needsUpdate = true;
      mats.glass.opacity = xray ? 0.12 : 0.88; mats.frame.transparent = xray; mats.frame.opacity = xray ? 0.3 : 1; mats.frame.needsUpdate = true;
    },
  };
}

export interface CarView {
  /** Draws the car and returns the label anchors: part to [x, y, facing the camera]. */
  draw(view: { az: number; el: number; x: boolean }, lv: Record<string, number | null>): Record<string, [number, number, boolean]>;
  dispose(): void;
}

let threeP: Promise<T3> | null = null;
const loadThree = () => (threeP ??= import("three"));

/** The car in a WebGL canvas of its own inside host. Rejects when three.js cannot load or there is no WebGL. */
export async function car3dView(host: HTMLElement): Promise<CarView> {
  const T = await loadThree();
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.domElement.className = "c3-gl";
  host.prepend(renderer.domElement);
  const scene = new T.Scene(), car = buildCar(T), cam = new T.PerspectiveCamera(28, 1, 0.1, 100);
  scene.add(car.group);
  scene.add(new T.HemisphereLight(0xffffff, 0x2a2d33, 2.3));
  const sun = new T.DirectionalLight(0xffffff, 1.9); sun.position.set(4, 5, 7); scene.add(sun);
  const rim = new T.DirectionalLight(0xffffff, 0.7); rim.position.set(-5, -4, 3); scene.add(rim);
  const centre = new T.Vector3(0, 0, 0.62), BOX: number[][] = []; // what the camera looks at, and the corners of the car's box
  for (const x of [-2.55, 2.55]) for (const y of [-1.1, 1.1]) for (const z of [0, 1.33]) BOX.push([x, y, z - 0.62]);
  const dot = (p: number[], q: number[]) => p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!;
  return {
    draw(view, lv) {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return {};
      renderer.setSize(w, h, false);
      car.update(lv, tokens(), view.x);
      const ca = Math.cos(view.az), sa = Math.sin(view.az), ce = Math.cos(view.el), se = Math.sin(view.el), a = w / h, f = (cam.fov * Math.PI) / 360;
      const d = [ce * ca, ce * sa, se], r = [-sa, ca, 0], u = [-se * ca, -se * sa, ce];
      let dist = 0; // far enough that every corner of the box is inside the view, with a margin
      for (const p of BOX) { const z = dot(p, d); dist = Math.max(dist, z + (Math.abs(dot(p, r)) / (Math.tan(f) * a)) * 1.08, z + (Math.abs(dot(p, u)) / Math.tan(f)) * 1.12); }
      cam.aspect = a;
      cam.up.set(u[0]!, u[1]!, u[2]!); // the orbit's own up: never parallel to the view, so Top works
      cam.position.set(centre.x + dist * ce * ca, centre.y + dist * ce * sa, centre.z + dist * se);
      cam.lookAt(centre);
      cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      const out: Record<string, [number, number, boolean]> = {};
      for (const [part, [p, n]] of Object.entries(ANCHOR)) {
        const v = new T.Vector3(p[0], p[1], p[2]).project(cam);
        const facing = n[0] * d[0]! + n[1] * d[1]! + n[2] * d[2]! > 0.2 || view.el > 1.2 || part === "centre";
        out[part] = [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h, facing];
      }
      return out;
    },
    dispose() {
      renderer.dispose();
      for (const k of Object.keys(car.meshes) as Layer[]) { car.meshes[k].geometry.dispose(); car.mats[k].dispose(); }
      renderer.domElement.remove();
    },
  };
}
