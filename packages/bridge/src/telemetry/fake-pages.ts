// The simulated ACC session behind --simulate-acc.
import { at, mod, Rec } from "../util.js";
import { SIM_TRACKS, trackLoop } from "./sim-tracks.js";

const bisectRight = (a: number[], x: number): number => {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (x < a[m]!) hi = m; else lo = m + 1; }
  return lo;
};
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export class FakePages {
  lap: number;
  clock: () => number;
  t0: number;
  session: number;
  track = "demo_circuit";
  name = "Demo circuit";
  trackLen = 5000.0;
  loop: [number, number][] | null = null;
  every = 18; // a stop every 18 laps
  lpl = 3.1; // litres a lap
  k: number;
  v: number[] = [];
  curv: number[] = [];
  tcum: number[] = [];
  acc: number[] = [];

  /** session: ACC's kind, 2 race, 1 qualifying. clock is in seconds. */
  constructor({ lapMs = 60000, clock = () => performance.now() / 1000, session = 2, track }: { lapMs?: number; clock?: () => number; session?: number; track?: string } = {}) {
    this.lap = lapMs; this.clock = clock; this.t0 = clock(); this.session = session;
    const sim = track ? SIM_TRACKS[track] : undefined;
    if (sim) { // a tracks.js layout at its real length, with a GT3's lap and fuel
      [this.track, this.name, this.trackLen, this.lap, this.lpl, this.every] = sim;
      this.loop = trackLoop(this.track, this.trackLen);
      this.profile();
    }
    this.k = this.lap / 60000; // the session's times scale with the lap
  }

  /** A GT3's speed along the loop from its bends (1.7 g in corners, 14 m/s² braking, 5.5 m/s² pulling), scaled to the lap time. */
  private profile(): void {
    const pts = this.loop!, n = pts.length;
    const ds = this.trackLen / n;
    const k = Math.max(2, Math.round(25 / ds)); // bends measured over ~50 m, so a kink in the drawing is not a hairpin
    let curv: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = at(pts, i - k), b = pts[i]!, c = pts[(i + k) % n]!;
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      curv.push((2 * cr) / ((dist(a, b) * dist(b, c) * dist(a, c)) || 1));
    }
    curv = curv.map((_, i) => [-2, -1, 0, 1, 2].reduce((s, j) => s + curv[mod(i + j, n)]!, 0) / 5);
    const v = curv.map((c) => Math.min(78.0, Math.sqrt((1.7 * 9.81) / Math.max(Math.abs(c), 1e-4))));
    for (let rep = 0; rep < 2; rep++) { // round the lap twice: braking backwards, pulling forwards
      for (let i = n - 1; i >= 0; i--) v[mod(i - 1, n)] = Math.min(v[mod(i - 1, n)]!, Math.sqrt(v[i]! ** 2 + 2 * 14 * ds));
      for (let i = 0; i < n; i++) v[(i + 1) % n] = Math.min(v[(i + 1) % n]!, Math.sqrt(v[i]! ** 2 + 2 * 5.5 * ds));
    }
    const t = [0.0];
    for (let i = 0; i < n; i++) t.push(t[t.length - 1]! + (2 * ds) / (v[i]! + v[(i + 1) % n]!));
    const s = t[t.length - 1]! / (this.lap / 1000); // speeds scaled to the GT3 lap, not to a car model
    this.v = v.map((x) => x * s); this.curv = curv; this.tcum = t.map((x) => x / t[t.length - 1]!);
    const acc = this.v.map((_, i) => (this.v[(i + 1) % n]! ** 2 - this.v[mod(i - 1, n)]! ** 2) / (4 * ds));
    this.acc = acc.map((_, i) => [-3, -2, -1, 0, 1, 2, 3].reduce((q, j) => q + acc[mod(i + j, n)]!, 0) / 7); // smoothed, so the pedals do not flicker
  }

  /** World position (metres) on the circuit, a little off the ideal line, differently every lap. */
  private where(w: number, lap: number): number[] {
    let x: number, z: number, dx: number, dz: number;
    if (this.loop) {
      const pts = this.loop, f = (w / (2 * Math.PI)) * pts.length;
      const i = Math.floor(f) % pts.length;
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      dx = b[0] - a[0]; dz = b[1] - a[1];
      const t = f - Math.floor(f);
      x = a[0] + dx * t; z = a[1] + dz * t;
    } else {
      x = 800 * Math.cos(w); z = 450 * Math.sin(w) + 120 * Math.sin(2 * w);
      dx = -800 * Math.sin(w); dz = 450 * Math.cos(w) + 240 * Math.cos(2 * w);
    }
    const off = 2.0 * Math.sin(3 * w + lap * 1.7) + 0.8 * Math.sin(7 * w + lap);
    const n = Math.hypot(dx, dz) || 1;
    return [x - (dz / n) * off, 0.0, z + (dx / n) * off];
  }

  read(): Rec {
    const el = (this.clock() - this.t0) * 1000;
    const t = el + 3.5 * this.lap;
    const pos = mod(t, this.lap) / this.lap, laps = Math.floor(t / this.lap);
    let w = pos * 2 * Math.PI;
    const e = this.every, k = this.k;
    const u = mod(t / this.lap, e); // the stint: every 18 laps a stop, in the lane for the last 5 % of a lap and the first 8 % of the next
    const lane = u > e - 0.05 || u < 0.08, box = 0.01 <= u && u < 0.06; // stood in the box for 3 s of a 60 s lap, taking the fuel
    const burn = this.lpl * (u + e * (1 - clamp((u - 0.01) / 0.05, 0, 1))); // the last stint's burn until the box, refilled in it
    let sp = box ? 0.0 : lane ? 60.0 : 175 + 70 * Math.sin(w * 6);
    let gas = box ? 0.0 : lane ? 0.3 : clamp(0.6 + 0.5 * Math.sin(w * 6 + 0.4), 0, 1);
    let brake = lane ? 0.0 : Math.max(0.0, -Math.sin(w * 6 + 0.4) - 0.5);
    let steer = 0.3 * Math.sin(w * 5);
    let accG = [1.2 * Math.sin(w * 5), 0.0, 0.8 * Math.cos(w * 5)];
    let rpm = Math.trunc(5200 + 2200 * Math.sin(w * 25) ** 2);
    let d = pos;
    if (this.loop) { // a real layout: where the car is by the speed profile, and the pedals from it
      const n = this.loop.length;
      const i = Math.min(n - 1, bisectRight(this.tcum, pos) - 1);
      d = (i + (pos - this.tcum[i]!) / (this.tcum[i + 1]! - this.tcum[i]!)) / n;
      const v = this.v[i]!, a = this.acc[i]!, c = this.curv[i]!;
      if (!lane) {
        sp = v * 3.6; steer = clamp(c * 25, -1, 1);
        if (a < -1.5) { gas = 0.0; brake = Math.min(1.0, -a / 10); }
        else { gas = Math.abs(c) < 0.003 ? 1.0 : Math.max(0.2, Math.min(1.0, 0.45 + a / 4)); brake = 0.0; }
        accG = [clamp((v * v * c) / 9.81, -2.2, 2.2), 0.0, a / 9.81];
      }
      const g = clamp(Math.trunc(sp / 45), 0, 5);
      rpm = Math.trunc(g < 5 ? 4800 + 3000 * (sp / 45 - g) : Math.min(7900, 4800 + (3000 * (sp - 225)) / 60));
    }
    w = d * 2 * Math.PI;
    const yellow = laps % 7 === 3 && 0.33 < pos && pos < 0.66;
    const lapsPad = [24.1, 24.0, 25.2, 25.3].map((x, i) => Math.round((x - (t / this.lap) * [0.21, 0.2, 0.12, 0.12][i]!) * 100) / 100);
    return {
      status: 2, session: this.session, gas, brake, fuel: e * this.lpl + 4.2 - burn, gear: 2 + clamp(Math.trunc(sp / 45), 0, 5), rpm,
      steer, speed: sp, acc_g: accG,
      pressure: [27.6, 27.8, 26.6, 26.8], core_temp: [84.0, 86.0, 79.0, 81.0], damage: laps >= 2 ? [27.6, 7.6, 70.3, 0.6, 106.2] : [0, 0, 0, 0, 0],
      tyres_out: 0, limiter: +lane,
      air: 22.4, road: 29.1, brake_temp: [412.0, 405.0, 330.0, 338.0], clutch: 0.0, bias: 0.565, tc_on: 0, abs_on: 0,
      susp_damage: laps >= 2 ? [0.07, 0.0, 0.0, 0.0] : [0, 0, 0, 0], water: 92.0, brake_press: [0, 0, 0, 0], front_pad_compound: 0, rear_pad_compound: 0,
      pad: lapsPad, disc: [31.8, 31.8, 31.9, 31.9],
      laps, position: 7, cur_ms: Math.trunc(mod(t, this.lap)),
      last_ms: laps ? this.lap - 500 + 110 * laps + ((laps * 7919) % 400) : 0,
      best_ms: laps > 1 ? this.lap - 120 : 2147483647, time_left: 3.2e6 * k - t, in_box: +box, sector: Math.trunc(d * 3),
      last_sector_ms: Math.floor(this.lap / 3),
      compound: "dry_compound", track_pos: d, xyz: this.where(w, laps), me: 7, penalty_time: 0.0,
      flag: yellow ? 2 : 0, penalty: 0, pit_lane: +lane, mandatory_done: +(laps >= 20), wind: 2.3, wind_dir: 3.73,
      tc: 3, tc_cut: 2, map: 0, abs: 2, fuel_per_lap: this.lpl - 0.1, rain_lights: 0, lights_stage: 0, exhaust: 610.0, wiper: 0,
      stint_total_left: Math.trunc(3600000 * k - el), stint_left: Math.trunc(3600000 * k - el), rain_tyres: 0, session_index: 0,
      used_fuel: burn, delta_ms: Math.trunc(-214 + 100 * Math.sin(w)), est_lap_ms: this.lap, valid: +(laps % 5 !== 2),
      fuel_laps: 12.0, track_status: "", missing_pits: this.session === 2 ? +(laps < 20) : 255, clock: 14 * 3600 + el / 1000,
      g_flags: [0, 0, +yellow, 0, 0, 0, 0, 0], grip: 2, rain: [0, 1, 2], tyre_set: 3,
      gap_ahead: Math.trunc(1840 - 90 * (t / this.lap)), gap_behind: Math.trunc(950 + 60 * (t / this.lap)),
      car: "ferrari_296_gt3", track: this.track, name: "Daniel", sectors: 3, max_rpm: 8000, max_fuel: 120.0,
      fuel_rate: 1.0, tyre_rate: 1.0, track_len: this.trackLen, timed: 1, extra_lap: 0, pit_open: Math.trunc(1200000 * k), pit_close: Math.trunc(2400000 * k),
      online: 0,
    };
  }
}
