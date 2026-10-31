// A circuit for the simulator: a closed loop in metres, the speed a GT3 could hold at every point of it, and the pit lane.
import { at, mod } from "../util.js";
import { accCap, brakeCap, circle, latMax, TOP_SPEED } from "./physics.js";

const bisectRight = (a: number[], x: number): number => {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (x < a[m]!) hi = m; else lo = m + 1; }
  return lo;
};
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

/** The loop scaled so its length is `metres`. */
export function scaleLoop(pts: [number, number][], metres: number): [number, number][] {
  const n = pts.length;
  let len = 0;
  for (let i = 0; i < n; i++) len += dist(pts[(i + n - 1) % n]!, pts[i]!);
  const sc = metres / len;
  return pts.map(([x, z]) => [x * sc, z * sc]);
}

/** A closed Catmull-Rom curve through the control points. */
function smooth(ctrl: [number, number][], per: number): [number, number][] {
  const n = ctrl.length, out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = at(ctrl, i - 1), p1 = ctrl[i]!, p2 = at(ctrl, i + 1), p3 = at(ctrl, i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

/** The made-up circuit: a long straight into a hairpin, a fast sweeper, a chicane and a tight infield. */
export const DEMO_LOOP = smooth([
  [0, 0], [300, 0], [650, 0], [950, 0], [1180, 20], [1290, 110], [1250, 230], [1130, 280], [1080, 380], [1150, 470],
  [1150, 600], [1010, 680], [830, 650], [720, 560], [600, 600], [520, 720], [380, 770], [250, 700], [250, 560],
  [370, 470], [330, 360], [180, 320], [60, 380], [-110, 330], [-180, 200], [-120, 80],
], 14);

export const LANE_IN = -240, LANE_OUT = 210; // metres from the line: the pit lane runs past it
export const LANE_OFFSET = -16; // metres to the side of the racing line

export class Circuit {
  readonly n: number;
  readonly ds: number;
  /** The profile's speeds were scaled by this to hit the reference lap; accelerations scale with them. */
  readonly k: number;
  /** m/s along the loop for a car at the reference lap time. */
  readonly v: number[];
  readonly curv: number[];
  readonly acc: number[];
  /** Fraction of the reference lap time elapsed at each point. */
  readonly tcum: number[];

  constructor(readonly pts: [number, number][], readonly len: number, readonly lapMs: number) {
    const n = this.n = pts.length;
    const ds = this.ds = len / n;
    const k = Math.max(2, Math.round(25 / ds)); // bends measured over ~50 m, so a kink in the drawing is not a hairpin
    let curv: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = at(pts, i - k), b = pts[i]!, c = pts[(i + k) % n]!;
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      curv.push((2 * cr) / ((dist(a, b) * dist(b, c) * dist(a, c)) || 1));
    }
    curv = curv.map((_, i) => [-2, -1, 0, 1, 2].reduce((s, j) => s + curv[mod(i + j, n)]!, 0) / 5);
    // the fastest each point can be taken at, then braking backwards and pulling forwards with the grip the corner leaves
    const v = curv.map((c) => { const d = Math.abs(c) - latMax(0) * (0.35 / 3600); return d <= 1e-6 ? TOP_SPEED : Math.min(TOP_SPEED, Math.sqrt(latMax(0) / d)); });
    const use = (i: number, s: number) => (s * s * Math.abs(curv[mod(i, n)]!)) / latMax(s);
    for (let rep = 0; rep < 2; rep++) { // round the lap twice
      for (let i = n - 1; i >= 0; i--) {
        const s = v[i]!, j = mod(i - 1, n);
        v[j] = Math.min(v[j]!, Math.sqrt(s * s + 2 * brakeCap(s) * circle(use(j, s)) * ds));
      }
      for (let i = 0; i < n; i++) {
        const s = v[i]!, j = (i + 1) % n;
        v[j] = Math.min(v[j]!, Math.sqrt(s * s + 2 * accCap(s) * circle(use(i, s)) * ds));
      }
    }
    const t = [0.0];
    for (let i = 0; i < n; i++) t.push(t[t.length - 1]! + (2 * ds) / (v[i]! + v[(i + 1) % n]!));
    const s = (this.k = t[t.length - 1]! / (lapMs / 1000)); // speeds scaled to the GT3 lap, not to a car model
    this.v = v.map((x) => x * s);
    this.curv = curv;
    this.tcum = t.map((x) => x / t[t.length - 1]!);
    const acc = this.v.map((_, i) => (this.v[(i + 1) % n]! ** 2 - this.v[mod(i - 1, n)]! ** 2) / (4 * ds));
    this.acc = acc.map((_, i) => [-3, -2, -1, 0, 1, 2, 3].reduce((q, j) => q + acc[mod(i + j, n)]!, 0) / 7); // smoothed, so the pedals do not flicker
  }

  private lerp(a: readonly number[], d: number): number {
    const f = mod(d, this.len) / this.ds, i = Math.floor(f) % this.n;
    return a[i]! + (a[(i + 1) % this.n]! - a[i]!) * (f - Math.floor(f));
  }
  speed(d: number): number { return this.lerp(this.v, d); }
  curvature(d: number): number { return this.lerp(this.curv, d); }
  accel(d: number): number { return this.lerp(this.acc, d); }

  /** The reference car's time at metre d of its lap, ms. */
  timeAt(d: number): number {
    const f = mod(d, this.len) / this.ds, i = Math.floor(f) % this.n;
    return (this.tcum[i]! + (this.tcum[i + 1]! - this.tcum[i]!) * (f - Math.floor(f))) * this.lapMs;
  }

  /** Metre of the lap the reference car reaches after ms. */
  distAt(ms: number): number {
    const x = mod(ms, this.lapMs) / this.lapMs;
    const i = Math.min(this.n - 1, bisectRight(this.tcum, x) - 1);
    return (i + (x - this.tcum[i]!) / (this.tcum[i + 1]! - this.tcum[i]!)) * this.ds;
  }

  /** World position (x, z) at metre d, lat metres to the left of the line (the sign only matters to the picture). */
  pos(d: number, lat = 0): [number, number] {
    const f = mod(d, this.len) / this.ds, i = Math.floor(f) % this.n, t = f - Math.floor(f);
    const a = this.pts[i]!, b = this.pts[(i + 1) % this.n]!;
    const dx = b[0] - a[0], dz = b[1] - a[1], m = Math.hypot(dx, dz) || 1;
    return [a[0] + dx * t - (dz / m) * lat, a[1] + dz * t + (dx / m) * lat];
  }
}
