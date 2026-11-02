// Turns raw page values into the dashboard's reading and summary, and keeps what needs history: laps, sectors, stints,
// stops, fuel and lap traces. Log lines collect in `events` for the bridge to drain.
import { defaultConfig } from "../config.js";
import { mean, mod, Rec, sum } from "../util.js";
import {
  carClass, CORNERS, fmtLap, FLAG_TEXT, GFLAGS, LCH, NB, PENALTIES, floatText, RAIN, SERVABLE, SESSIONS, signed, STATUS,
} from "./constants.js";

export type Event = [sev: number, cat: string, text: string];
type Trace = { ms: number; valid: boolean; ch: Record<string, number[]>; line: number[][]; sec: number[] };

/** Samples of a whole lap -> NB points per channel at even track position: exactly recorder.js resample(). */
export function resample(smp: Rec[], ms: number): Record<string, number[]> {
  const d: Record<string, number[]> = Object.fromEntries(LCH.map((k) => [k, new Array<number>(NB).fill(0)]));
  let j = 0;
  for (let i = 0; i < NB; i++) {
    const p = i / (NB - 1);
    while (j < smp.length - 2 && smp[j + 1]!.p < p) j++;
    const a = smp[j]!, b = smp[j + 1]!;
    const f = b.p > a.p ? Math.max(0, Math.min(1, (p - a.p) / (b.p - a.p))) : 0;
    for (const k of LCH) d[k]![i] = a[k] + (b[k] - a[k]) * f;
  }
  d.gear = d.gear!.map((g) => Math.floor(g + 0.5));
  const end = d.t![NB - 1]!;
  if (end > 0 && ms > 0) d.t = d.t!.map((t) => (t * ms) / end);
  return d;
}

const ceil = (x: number): number => { // an argument within 1e-6 of a whole number is that number
  const k = Math.round(x);
  return Math.abs(x - k) < 1e-6 ? k : Math.ceil(x);
};

export class Telemetry {
  config: Rec;
  clock: () => number;
  seq = 0;
  cls = "GT3";
  prev: Rec | null = null;
  splits: number[] = [];
  debrief: Rec[] = [];
  secPos: number[] = [];
  secAt: number[] = []; // the latest crossing of each sector line, whatever lap it was on
  secKept: number[] = []; // where the sectors end, in lap fractions, from the last lap that had them all
  stintStart: number | null = null;
  fuelAtLine: number | null = null;
  lapFuel: number[] = [];
  lapBrakeMax = 0;
  best: number | null = null;
  stint: Rec[] = [];
  laps: Rec[] = [];
  /** The sessions before this one, newest last: {id, kind, track, laps, stints, stops, field}. Lap traces and the field's final state stay in `vault`. */
  past: Rec[] = [];
  vault = new Map<number, { traces: Map<number, Trace>; field?: Rec }>();
  private pastId = 0;
  lapStartPit = false;
  lapSawPit = false;
  lapsVer = 0;
  events: Event[] = [];
  edge: Record<string, boolean> = {};
  adviceIds = new Set<string>();
  stintNo = 1;
  stintRoad: number | null = null;
  stops: Rec[] = [];
  stop: Rec | null = null;
  pending: Rec | null = null;
  cur: Rec[] = [];
  line: number[][] = [];
  traces = new Map<number, Trace>();
  pen: Rec | null = null;
  sessLen = 0;
  raceT: number | null = null;
  tPrev: number | null = null;
  lastSt: Rec = {};

  constructor(config?: Rec, clock: () => number = () => performance.now() / 1000) {
    this.config = config ?? defaultConfig();
    this.clock = clock;
    this.newSession();
  }

  private newSession(old?: Rec): void {
    if (old && this.laps.length) {
      const id = ++this.pastId;
      this.past.push({ id, kind: SESSIONS[old.session] ?? "Session", track: old.track, laps: this.laps.map(({ psi, core, ...l }) => l), stints: this.stints(old), stops: this.stops, field: false });
      this.vault.set(id, { traces: this.traces });
      if (this.past.length > 6) this.vault.delete(this.past.shift()!.id);
    }
    this.prev = null; this.splits = []; this.debrief = []; this.secPos = []; this.secAt = []; this.secKept = [];
    this.stintStart = this.fuelAtLine = null;
    this.lapFuel = []; this.lapBrakeMax = 0; this.best = null; this.stint = [];
    this.laps = []; this.lapStartPit = this.lapSawPit = false; this.lapsVer++;
    this.events = []; this.edge = {}; this.adviceIds = new Set();
    this.stintNo = 1; this.stintRoad = null; this.stops = []; this.stop = null; this.pending = null;
    this.cur = []; this.line = []; this.traces = new Map();
    this.pen = null; this.sessLen = 0; this.raceT = null; this.tPrev = null; this.lastSt = {};
  }

  get th(): Rec {
    const t = this.config.thresholds;
    return t[this.cls] ?? t.GT3;
  }

  /** One reading. ext (from the bridge, all optional): field (bool), car_class and track_m from it, gap_ms (to the leader). */
  update(r: Rec, ext: Rec = {}): Rec {
    this.seq++;
    let p = this.prev;
    if (p && r.session_index !== p.session_index) { this.newSession(p); p = null; }
    const now = this.clock();
    this.cls = ext.car_class || carClass(r.car);
    this.sessLen = Math.max(this.sessLen, r.time_left);
    if (this.stintRoad === null) this.stintRoad = r.road;
    if (this.stintStart === null || r.pit_lane) { this.stintStart = r.laps; this.stint = []; }
    if (p && r.sector > p.sector) { // ACC's exact sector time; the frame's lap time is up to a frame late, so it is the fallback
      const at = (this.splits.length ? this.splits[this.splits.length - 1]! : 0) + r.last_sector_ms;
      this.secPos.push(r.track_pos);
      const n = (r.sectors || 3) - 1; // the line a jump of more than one sector crossed is not known
      if (r.sector === p.sector + 1 && p.sector < n) {
        this.secAt[p.sector] = r.track_pos;
        if (Array.from({ length: n }, (_, i) => this.secAt[i]).every((v) => v !== undefined)) this.secKept = this.secAt.slice(0, n);
      }
      this.splits.push(r.last_sector_ms > 0 && r.last_sector_ms < 600000 && r.cur_ms - at >= 0 && r.cur_ms - at < 250 ? at : r.cur_ms);
    }
    this.lapBrakeMax = Math.max(this.lapBrakeMax, ...r.brake_temp);
    this.lapSawPit = this.lapSawPit || !!r.pit_lane;
    if (p) { this.edges(r, p); this.pits(r, p, now); }
    if (p && r.laps > p.laps) this.lapDone(r, p, ext);
    this.sample(r, now);
    this.prev = r; this.tPrev = now;
    const mp = r.missing_pits, po = r.pit_open, pc = r.pit_close;
    const win = 0 < po && po < pc;
    return {
      what: "pit-wall/session", sequence: this.seq, from: r.name, reading: {
        car: {
          gear: r.gear - 1, speed_kmh: r.speed, rpm: r.rpm, throttle: r.gas, brake: r.brake,
          clutch: r.clutch, reference_delta_s: r.delta_ms / 1000, fuel_litres: r.fuel,
          pit_limiter: !!r.limiter, tyres_off_track: r.tyres_out, abs_in_action: r.abs_on, tc_in_action: r.tc_on,
          tyre_pressure_psi: r.pressure, tyre_core_temp_c: r.core_temp, brake_temp_c: r.brake_temp,
          brake_pad_mm: r.pad, brake_disc_mm: r.disc, brake_bias: r.bias * 100, tc_level: r.tc,
          abs_level: r.abs, acc_g: r.acc_g, steer_angle: r.steer, damage: r.damage,
          air_temp_c: r.air, road_temp_c: r.road, water_temp_c: r.water, exhaust_temp_c: r.exhaust,
          brake_pressure: r.brake_press, suspension_damage: r.susp_damage,
          front_pad_compound: r.front_pad_compound + 1, rear_pad_compound: r.rear_pad_compound + 1,
          rain_lights: !!r.rain_lights, lights_stage: r.lights_stage, wiper: r.wiper,
        },
        session: {
          current_lap_ms: r.cur_ms, last_lap_ms: r.last_ms, best_lap_ms: r.best_ms, lap_is_valid: !!r.valid,
          current_sector: r.sector, in_pit_lane: !!r.pit_lane, compound: r.compound, tc_cut: r.tc_cut,
          engine_map: r.map + 1, completed_laps: r.laps, total_laps: 0, session_time_left_ms: Math.max(0, r.time_left),
          kind: SESSIONS[r.session] ?? "Session", status: r.status >= 0 && r.status < 4 ? STATUS[r.status] : "Off",
          position: r.position, wind_speed_kmh: r.wind * 3.6, wind_direction_deg: mod((r.wind_dir * 180) / Math.PI, 360),
          fuel_per_lap: this.fuelPerLap(r), track_position: r.track_pos, car_position_m: r.xyz,
          gap_ahead_ms: r.gap_ahead, gap_behind_ms: r.gap_behind, track_grip: r.grip, rain: r.rain,
          rain_tyres: !!r.rain_tyres, tyre_set: r.tyre_set,
          flag: r.flag, global_flags: Object.fromEntries(GFLAGS.map((k, i) => [k, !!r.g_flags[i]])), penalty: r.penalty,
          penalty_time_s: r.penalty_time, mandatory_pit_done: !!r.mandatory_done,
          missing_mandatory_pits: mp >= 0 && mp <= 50 ? mp : null, stint_time_left_ms: r.stint_left >= 0 ? r.stint_left : -1,
          stint_total_time_left_ms: r.stint_total_left, in_pit_box: !!r.in_box, clock_s: r.clock,
          estimated_lap_ms: r.est_lap_ms, session_index: r.session_index, used_fuel_l: r.used_fuel,
          track_status: r.track_status, lap_number: r.laps + 1, player_car_id: r.me,
        },
        fixed: {
          car_model: r.car, track: r.track, track_config: "", driver_name: r.name,
          sector_count: r.sectors || 3, max_rpm: r.max_rpm, max_fuel: r.max_fuel,
          track_length_m: ext.track_m || r.track_len, is_timed_race: !!r.timed,
          has_extra_lap: !!r.extra_lap, pit_window_start_ms: win ? po : 0, pit_window_end_ms: win ? pc : 0,
          is_online: !!r.online, fuel_rate: r.fuel_rate, tyre_rate: r.tyre_rate, car_class: this.cls,
        },
        capabilities: { tyre_edge_temps: false, tyre_wear: false, sectors: true, field: !!ext.field, flags: true, traces: true },
      },
    };
  }

  /** Our own figure, the last three green laps, once there are any; ACC's estimate until then. */
  fuelPerLap(r: Rec): number {
    const l = this.lapFuel.slice(-3);
    return l.length ? sum(l) / l.length : r.fuel_per_lap;
  }

  /** Session time so far, ms: from broadcasting when the field is live, else the longest time-left seen minus now. */
  private elapsed(r: Rec): number {
    return this.raceT !== null ? this.raceT : this.sessLen - r.time_left;
  }

  // ---------- the log ----------
  private edgeEvent(key: string, on: boolean, sev: number, cat: string, text: string): void {
    if (on && !this.edge[key]) this.events.push([sev, cat, text]);
    this.edge[key] = on;
  }

  private edges(r: Rec, p: Rec): void {
    const th = this.th;
    if (r.flag !== p.flag && r.flag in FLAG_TEXT) this.events.push([r.flag === 5 || r.flag === 7 ? 0 : 1, "FLAG", FLAG_TEXT[r.flag]!]);
    for (const k of [1, 2, 3]) this.edgeEvent(`y${k}`, !!r.g_flags[k], 1, "FLAG", `Yellow in sector ${k}`);
    if (r.penalty && r.penalty !== p.penalty && r.penalty > 0 && r.penalty < PENALTIES.length) {
      this.events.push([2, "FLAG", `Penalty: ${PENALTIES[r.penalty]![0]} ${PENALTIES[r.penalty]![1]}`]);
    }
    this.edgeEvent("invalid", !r.valid, 1, "CAR", "Lap invalidated");
    this.edgeEvent("off", r.tyres_out >= 3, 1, "CAR", `Off track: ${r.tyres_out} wheels out`);
    this.edgeEvent("dmg", r.damage.some((d: number) => d >= 10), 2, "CAR", "Car damage");
    CORNERS.forEach((c, i) => {
      const hot = th.brake_c[i < 2 ? "front" : "rear"][1];
      this.edgeEvent("tyre" + c, r.core_temp[i] > th.tyre_c[1], 1, "CAR", `${c} tyre ${r.core_temp[i].toFixed(0)} °C, over ${th.tyre_c[1].toFixed(0)}`);
      this.edgeEvent("brk" + c, r.brake_temp[i] > hot, 2, "CAR", `${c} brake ${r.brake_temp[i].toFixed(0)} °C, over ${hot.toFixed(0)}`);
    });
  }

  // ---------- pit stops, measured ----------
  private pits(r: Rec, p: Rec, now: number): void {
    if (r.pit_lane && !p.pit_lane) {
      this.events.push([0, "PIT", `Pit lane in, L${r.laps + 1}`]);
      this.stop = { lap: r.laps + 1, t: now, t_ms: this.elapsed(r), fuel: p.fuel, set: r.tyre_set, box: 0.0, ref: this.lastSt.lap_ref_ms ?? null };
    } else if (this.stop && r.pit_lane) {
      if (r.in_box && r.speed < 1) this.stop.box += now - (this.tPrev as number);
    } else if (this.stop && p.pit_lane && !r.pit_lane) {
      const st = this.stop;
      this.stop = null;
      const laneMs = Math.trunc((now - st.t) * 1000), boxMs = Math.trunc(st.box * 1000);
      this.events.push([0, "PIT", `Pit lane out, lane ${(laneMs / 1000).toFixed(1)} s`]);
      if (boxMs > 0) { // stopped in the box; a drive-through is not a stop
        const added = Math.max(0, r.fuel - st.fuel);
        const rec = { lap: st.lap, t_ms: st.t_ms, lane_ms: laneMs, box_ms: boxMs, loss_ms: null as number | null, fuel_added_l: added,
          set_before: st.set, set_after: r.tyre_set, tyres: r.tyre_set !== st.set };
        this.stops.push(rec);
        this.pending = { rec, in: st.lap, out: Math.max(r.laps + 1, st.lap + 1), ref: st.ref };
        this.stintNo++; this.stintRoad = r.road;
        this.events.push([0, "PIT", `Stop L${st.lap}: lane ${(laneMs / 1000).toFixed(1)} s, box ${(boxMs / 1000).toFixed(1)} s, +${added.toFixed(1)} L, set ${st.set} to ${r.tyre_set}`]);
      }
    }
  }

  // ---------- laps ----------
  private sample(r: Rec, now: number): void {
    const p = r.track_pos, x = r.xyz[0], z = r.xyz[2];
    const last = this.line[this.line.length - 1];
    if ((x || z) && last) { // a jump (garage, reset): the lap is no longer whole. Farther than the car could go since the last frame
      const d = Math.hypot(last[0]! - x, last[1]! - z), dt = Math.max(1 / 30, now - (this.tPrev ?? now));
      if (d > 60 && d > (r.speed / 3.6) * dt * 1.5 + 20) { this.cur = []; this.line = []; }
    }
    const c = this.cur;
    if (!c.length || p > c[c.length - 1]!.p) { // position must advance; drops jitter and the wrap after the line
      c.push({ p, t: r.cur_ms, speed: r.speed, thr: r.gas, brk: r.brake, steer: r.steer, gear: r.gear - 1, rpm: r.rpm, glat: r.acc_g[0], glon: r.acc_g[2], tc: r.tc_on, abs: r.abs_on });
    }
    const l2 = this.line[this.line.length - 1];
    if ((x || z) && (!l2 || Math.hypot(l2[0]! - x, l2[1]! - z) > 1.5)) this.line.push([x, z, p]); // p: ACC's lap fraction here
  }

  private lapDone(r: Rec, p: Rec, ext: Rec): void {
    const ms: number = r.last_ms, n: number = r.laps;
    const lines: [number, string][] = [];
    const th = this.th;
    const whole = this.splits.length + 1 === (r.sectors || 3);
    const a = [0, ...this.splits], b = [...this.splits, ms];
    const sectors = whole && ms > 0 ? b.map((v, i) => v - a[i]!) : [];
    const green = !p.pit_lane && !r.pit_lane && this.fuelAtLine !== null;
    const used = green && (this.fuelAtLine as number) - p.fuel > 0.2 ? (this.fuelAtLine as number) - p.fuel : null; // no refuel in the lap
    if (used !== null) { this.lapFuel.push(used); lines.push([0, `Used ${used.toFixed(2)} L`]); }
    if (!p.valid) lines.push([1, "Lap invalid: track limits"]);
    else if (0 < ms && (this.best === null || ms < this.best)) { this.best = ms; lines.push([0, "Best lap so far"]); }
    else if (this.best) lines.push([0, `${signed((ms - this.best) / 1000)} s off the best lap`]);
    const [lo, hi] = r.rain_tyres ? th.wet_psi : th.dry_psi;
    const out = CORNERS.map((c, i) => [c, r.pressure[i]] as const).filter(([, v]) => !(lo <= v && v <= hi)).map(([c, v]) => `${c} ${v.toFixed(1)}`);
    lines.push(out.length ? [1, `Pressures out of ${floatText(lo)}-${floatText(hi)} psi at the line: ${out.join(", ")}`] : [0, "Pressures in the window"]);
    if (this.lapBrakeMax > Math.max(th.brake_c.front[1], th.brake_c.rear[1])) lines.push([1, `Brakes peaked at ${this.lapBrakeMax.toFixed(0)} °C`]);
    this.debrief.unshift({ lap_number: n, lap_time_ms: ms, sectors_ms: sectors, lines: lines.map(([s, t]) => ({ severity: s, text: t })) });
    this.debrief.length = Math.min(this.debrief.length, 3);
    const usedR = used !== null ? Math.round(used * 100) / 100 : null;
    if (!r.pit_lane && ms > 0) { // the stint so far, for the degradation and brake wear modules
      this.stint.push({ n, ms, valid: !!p.valid, pads: r.pad, fuel: usedR });
      if (this.stint.length > 60) this.stint.splice(0, this.stint.length - 60);
    }
    if (ms > 0) { // OUT: began in the pit lane; IN: went into it
      const item: Rec = { n, ms, s: sectors, valid: !!p.valid, fuel: usedR, out: this.lapStartPit, in: this.lapSawPit && !this.lapStartPit,
        stint: this.stintNo, set: r.tyre_set, wet: !!r.rain_tyres, fuel_end: r.fuel, pos: r.position, gap: ext.gap_ms ?? null,
        psi: [...r.pressure], core: [...r.core_temp], track_c: r.road, trace: false };
      const c = this.cur;
      if (c.length > 60 && c[0]!.p < 0.1 && c[c.length - 1]!.p > 0.9) { // only whole laps: a part lap cannot be compared
        this.traces.set(n, { ms, valid: item.valid, ch: resample(c, ms), line: this.line, sec: this.secPos });
        item.trace = true;
      }
      this.laps.push(item);
      if (this.laps.length > 200) this.laps.splice(0, this.laps.length - 200);
      this.pruneTraces();
      this.lapsVer++;
      this.events.push([item.valid ? 0 : 1, "LAP", `Lap ${n} ${fmtLap(ms)}` + (item.valid ? "" : " (invalid)")]);
    }
    if (this.pending && n >= this.pending.out) { // the out-lap is done: what the stop cost against the pace at the time
      const pd = this.pending;
      this.pending = null;
      const by = new Map<number, number>(this.laps.map((l) => [l.n, l.ms]));
      const la = by.get(pd.in), lb = by.get(pd.out);
      if (la && lb && pd.ref) {
        pd.rec.loss_ms = Math.trunc(la + lb - 2 * pd.ref);
        this.events.push([0, "PIT", `Stop L${pd.in} cost ${(pd.rec.loss_ms / 1000).toFixed(1)} s`]);
      }
    }
    this.splits = []; this.secPos = []; this.lapBrakeMax = 0; this.fuelAtLine = r.fuel;
    this.lapStartPit = this.lapSawPit = !!r.pit_lane;
    this.cur = []; this.line = [];
  }

  /** Keep the last 40 traced laps and the best valid one. */
  private pruneTraces(): void {
    const ok = this.laps.filter((l) => l.trace && l.valid);
    const keep = new Set([...this.traces.keys()].sort((a, b) => a - b).slice(-40));
    if (ok.length) keep.add(ok.reduce((m, l) => (l.ms < m.ms ? l : m)).n);
    for (const n of [...this.traces.keys()]) if (!keep.has(n)) this.traces.delete(n);
    this.laps = this.laps.map((l) => (l.trace && !this.traces.has(l.n) ? { ...l, trace: false } : l));
  }

  /** The track layout worth keeping: the fastest valid whole lap's line (else the fastest whole lap's) and its sector lines, or null. */
  bestLayout(): Rec | null {
    const ts = [...this.traces].filter(([, t]) => t.line.length > 100).map(([n, t]) => [t.valid ? 0 : 1, t.ms, n] as const);
    if (!ts.length) return this.secKept.length ? { sec: this.secKept.map((v) => Math.round(v * 1e5) / 1e5) } : null; // no whole lap yet: just the sectors
    const [inv, ms, n] = ts.reduce((m, x) => (x[0] < m[0] || (x[0] === m[0] && (x[1] < m[1] || (x[1] === m[1] && x[2] < m[2]))) ? x : m));
    const t = this.traces.get(n)!;
    const r5 = (v: number) => Math.round(v * 1e5) / 1e5, r1 = (v: number) => Math.round(v * 10) / 10;
    return { valid: !inv, ms, sec: (this.secKept.length ? this.secKept : t.sec).map(r5), line: t.line.map(([x, z, q]) => [r1(x!), r1(z!), r5(q!)]) };
  }

  /** The field's final state of an earlier session, once the broadcast side has it. */
  attachField(id: number, field: Rec): void {
    const v = this.vault.get(id);
    if (!v) return;
    v.field = field;
    this.past.find((p) => p.id === id)!.field = true;
    this.lapsVer++;
  }

  /** GET /lap?n=N (&s=ID for an earlier session): a whole lap's 400-point channels and its racing line, or null. */
  lapTrace(n: number, session?: number): Rec | null {
    const t = (session === undefined ? this.traces : this.vault.get(session)?.traces)?.get(n);
    if (!t) return null;
    const r3 = (v: number) => Math.round(v * 1000) / 1000, r1 = (v: number) => Math.round(v * 10) / 10, r5 = (v: number) => Math.round(v * 1e5) / 1e5;
    return { n, ms: t.ms, valid: t.valid, ch: Object.fromEntries(LCH.map((k) => [k, t.ch[k]!.map(r3)])), line: t.line.map(([x, z, p]) => [r1(x!), r1(z!), r5(p!)]) };
  }

  // ---------- the summary ----------
  private ownPace(): number | null {
    return mean(this.laps.filter((l) => l.valid && !l.out && !l.in).slice(-3).map((l) => l.ms));
  }

  bestLap(r: Rec): [number | null, string | null] {
    const ok = this.laps.filter((l) => l.valid).map((l) => l.ms);
    if (ok.length) return [Math.min(...ok), "bridge"];
    return r.best_ms > 0 && r.best_ms < 3.6e6 ? [r.best_ms, "acc"] : [null, null];
  }

  /** Mean hot pressure at the line over the last 3 green laps of this stint: what the next stop's correction is based on. */
  pressLine(r: Rec): Rec | null {
    const ls = this.laps.filter((l) => l.stint === this.stintNo && l.valid && !l.out && !l.in).slice(-3);
    if (!ls.length) return null;
    return { psi: [0, 1, 2, 3].map((i) => mean(ls.map((l) => l.psi[i]))), laps: ls.length, track_c_delta: r.road - (this.stintRoad as number) };
  }

  stints(r: Rec): Rec[] {
    const nums = [...new Set([...this.laps.map((l) => l.stint as number), this.stintNo])].sort((a, b) => a - b);
    return nums.map((n) => {
      const ls = this.laps.filter((l) => l.stint === n);
      const ok = ls.filter((l) => l.valid).map((l) => l.ms as number);
      const last = ls[ls.length - 1];
      return { n, from: ls.length ? ls[0]!.n : null, to: last ? last.n : null, laps: ls.length, best_ms: ok.length ? Math.min(...ok) : null,
        avg_ms: mean(ls.filter((l) => l.valid && !l.out && !l.in).map((l) => l.ms)), fuel_per_lap: mean(ls.map((l) => l.fuel)),
        tyre_set: last ? last.set : r.tyre_set, wet: last ? last.wet : !!r.rain_tyres, current: n === this.stintNo };
    });
  }

  penalty(r: Rec): Rec | null {
    const k = r.penalty;
    if (SERVABLE.has(k)) {
      if (!this.pen || this.pen.kind !== k) this.pen = { kind: k, at: r.laps };
      return { kind: k, laps_left: 3 - (r.laps - this.pen.at) };
    }
    if (!k) this.pen = null;
    return null;
  }

  /** Every fuel, lap and stop figure the page shows. race: {leader_dist, leader_pace_ms, mode, elapsed_ms} from the field, or null. */
  strategy(r: Rec, race: Rec | null = null): Rec {
    const cfg = this.config.strategy;
    if (race && race.elapsed_ms != null) this.raceT = race.elapsed_ms;
    const fpl = this.fuelPerLap(r), fuel: number = r.fuel, cap: number = r.max_fuel, reserve: number = cfg.reserve_laps;
    const done: number = r.laps, tp: number = r.track_pos;
    const lapNo = done + 1, dme = done + tp;
    const dl = race && race.leader_dist != null ? race.leader_dist : dme;
    const own = this.ownPace(), [best] = this.bestLap(r);
    let ref: number | null, refSrc: string | null;
    if (race && race.mode === "race" && race.leader_pace_ms) { ref = race.leader_pace_ms; refSrc = "leader"; }
    else if (own) { ref = own; refSrc = "own"; }
    else if (best) { ref = best; refSrc = "best"; }
    else { ref = refSrc = null; }
    const my = own || ref;

    // ACC's shared memory has no race lap count, so there is no "laps" source yet
    let finish: number | null = null, src: string | null = null;
    if (r.session !== 2) { /* practice and qualifying: no flag to plan fuel for, only the fuel-limited box lap */ }
    else if (cfg.laps_override) { finish = done + cfg.laps_override; src = "override"; }
    else if (r.time_left > 0 && ref) {
      const dflag = ceil(dl + r.time_left / ref);
      finish = ceil(dme + ((dflag - dl) * ref) / (my as number)); src = "timed";
    }
    if (finish !== null) finish += r.extra_lap ? 1 : 0;
    const st: Rec = { lap_ref_ms: ref, lap_ref_src: refSrc, my_pace_ms: my, dist_to_go: null, laps_to_go: null, laps_src: src,
      fuel_per_lap: fpl, laps_of_fuel: null, fuel_needed_l: null, fuel_to_add_l: null, fits_tank: null,
      stops_needed: 0, stops_why: null, box_by_lap: null, box_in_laps: null, add_at_box_l: null, spare_l: null,
      save_lpl: null, pit_window: null, mandatory_left: null, reserve_laps: reserve, options: [], rejoin: null };
    let fuelStops = 0;

    const addAt = (lap: number): number => { // fuel to put in when boxing at the end of `lap`: to the flag, capped by the tank space there
      const left = Math.max(0, fuel - (lap - dme) * fpl);
      return Math.min(Math.max(0, ((finish as number) - lap + reserve) * fpl - left), cap - left);
    };

    if (fpl > 0) {
      st.laps_of_fuel = fuel / fpl;
      st.box_by_lap = lapNo + Math.max(0, Math.floor(fuel / fpl - (1 - tp) - reserve));
      st.box_in_laps = st.box_by_lap - lapNo;
      if (finish !== null) {
        const dist = finish - dme;
        const need = (dist + reserve) * fpl;
        Object.assign(st, { dist_to_go: dist, laps_to_go: finish - done, fuel_needed_l: need, fuel_to_add_l: Math.max(0, need - fuel) });
        st.fits_tank = st.fuel_to_add_l <= cap - fuel;
        const perStop = cap - reserve * fpl;
        fuelStops = need <= fuel ? 0 : perStop > 0 ? Math.ceil((need - fuel) / perStop) : 1;
        st.add_at_box_l = addAt(st.box_by_lap);
        if (dist > 0 && 0.9 * fpl <= fuel / dist && fuel / dist < fpl) st.save_lpl = fuel / dist;
      }
    }
    const mp: number = r.missing_pits;
    if (mp >= 0 && mp <= 50) st.mandatory_left = mp;
    else if (cfg.mandatory_stops !== null) st.mandatory_left = Math.max(0, cfg.mandatory_stops - this.stops.length);
    const el = this.elapsed(r);
    let o: number | null = null, c: number | null = null, wsrc = "";
    if (cfg.pit_window_open_min !== null) { o = cfg.pit_window_open_min * 60000; c = cfg.pit_window_close_min * 60000; wsrc = "config"; }
    else if (0 < r.pit_open && r.pit_open < r.pit_close) { o = r.pit_open; c = r.pit_close; wsrc = "acc"; }
    if (o !== null && ref) {
      const atLap = (ms: number) => Math.max(lapNo, lapNo + Math.ceil((ms - el) / ref));
      st.pit_window = { open_lap: atLap(o), close_lap: atLap(c as number), src: wsrc };
    }
    const pw = st.pit_window, ml: number = st.mandatory_left || 0;
    // a stop outside the pit window does not count as the mandatory one: a fuel stop forced before the window opens
    // leaves every mandatory stop still to make inside it
    const early = !!(ml && pw && fuelStops && st.box_by_lap !== null && st.box_by_lap < pw.open_lap);
    const stintStops = 0 <= r.stint_left && r.stint_left < r.time_left ? 1 : 0;
    const terms: [string, number][] = [["fuel", fuelStops], ["fuel + mandatory", early ? ml + 1 : 0], ["mandatory", ml], ["stint", stintStops]];
    st.stops_needed = Math.max(...terms.map(([, v]) => v));
    st.stops_why = st.stops_needed ? terms.find(([, v]) => v === st.stops_needed)![0] : null;
    if (st.fuel_needed_l !== null && !st.stops_needed) st.spare_l = fuel - st.fuel_needed_l;

    const loss = this.stops.filter((s) => s.loss_ms !== null).map((s) => (s.loss_ms - s.box_ms) / 1000);
    const refuel = this.stops.filter((s) => !s.tyres && s.fuel_added_l >= 5).map((s) => s.box_ms / 1000 / s.fuel_added_l);
    const tyres = this.stops.filter((s) => s.tyres && s.fuel_added_l < 5).map((s) => s.box_ms / 1000);
    Object.assign(st, {
      drive_loss_s: loss.length ? mean(loss) : cfg.pit_loss_s, drive_loss_src: loss.length ? "measured" : "config",
      refuel_s_per_l: refuel.length ? mean(refuel) : cfg.refuel_s_per_l, refuel_src: refuel.length ? "measured" : "est",
      tyre_s: tyres.length ? mean(tyres) : cfg.tyre_s, tyre_src: tyres.length ? "measured" : "est",
    });

    const stationary = (litres: number, ty: boolean): number => {
      const a = litres * st.refuel_s_per_l, b = ty ? st.tyre_s : 0;
      return Math.max(cfg.min_stationary_s, cfg.fuel_and_tyres === "parallel" ? Math.max(a, b) : a + b);
    };

    if (fpl > 0 && finish !== null) {
      // one row per distinct lap: now, the last lap the fuel allows, and the window's opening lap when it is later
      const perStop = cap - reserve * fpl;
      const rows: [string, string, number][] = [];
      const seen = new Set<number>();
      const cand: [string, string, number][] = [["now", "Box now", lapNo], ["late", `Box L${st.box_by_lap}`, st.box_by_lap]];
      if (st.pit_window && st.pit_window.open_lap > lapNo) cand.push(["win", `Box L${st.pit_window.open_lap} (window)`, st.pit_window.open_lap]);
      for (const row of cand) if (!seen.has(row[2])) { seen.add(row[2]); rows.push(row); }
      for (const [key, label, lap] of rows) {
        const add = addAt(lap);
        const left = Math.max(0, fuel - (lap - dme) * fpl);
        const short = (finish - lap + reserve) * fpl - (left + add); // fuel still missing to the flag after this stop
        let more = short <= 1e-6 ? 0 : perStop > 0 ? Math.ceil(short / perStop) : 1;
        const outside = !!(ml && pw && !(pw.open_lap <= lap && lap <= pw.close_lap));
        more = Math.max(more, ml - (outside ? 0 : 1)); // the mandatory stops still owed after this one; a later fuel stop can be one
        for (const ty of [false, true]) {
          const s = stationary(add, ty);
          st.options.push({ id: `${key}_${ty ? "ft" : "f"}`, label: `${label}, fuel${ty ? " + tyres" : ""}`, lap, add_l: add, stationary_s: s,
            loss_s: st.drive_loss_s + s, rejoin_pos: null, reach: lap <= st.box_by_lap, more_stops: more, outside_window: outside });
        }
      }
    }
    return st;
  }

  summary(r: Rec, race: Rec | null = null): Rec {
    const fpl = this.fuelPerLap(r);
    const st = (this.lastSt = this.strategy(r, race));
    const pl = this.pressLine(r), pen = this.penalty(r);
    const [best, src] = this.bestLap(r);
    const adv = this.advice(r, st, pl, pen);
    const ids = new Set<string>(adv.map((a) => a.id));
    for (const a of adv) if (!this.adviceIds.has(a.id)) this.events.push([a.severity, "ENG", a.text]);
    this.adviceIds = ids;
    return { what: "pit-wall/summary", fuel_per_lap: fpl, stint_laps: r.laps - (this.stintStart ?? 0), max_rpm: r.max_rpm,
      best_ms: best, best_src: src, lap_sectors_ms: this.splits.map((v, i) => v - (this.splits[i - 1] ?? 0)), sector_pos: this.secKept.length ? this.secKept : this.secPos, advice: adv, press_line: pl, strategy: st, stints: this.stints(r),
      stops: this.stops.map((s) => ({ ...s })), penalty: pen, debrief: this.debrief, stint: this.stint };
  }

  advice(r: Rec, st: Rec, pl: Rec | null, pen: Rec | null): { id: string; severity: number; text: string }[] {
    const th = this.th, out: [number, string, string][] = [], moving = r.speed > 60 && !r.pit_lane;
    const [lo, hi] = r.rain_tyres ? th.wet_psi : th.dry_psi;
    if (pl) { // never the instant value: the mean at the line over green laps
      for (const [aid, name, ix] of [["press_front", "Fronts", [0, 1]], ["press_rear", "Rears", [2, 3]]] as const) {
        const v = (pl.psi[ix[0]] + pl.psi[ix[1]]) / 2;
        if (!(lo <= v && v <= hi)) {
          out.push([1, aid, `${name} ${v.toFixed(1)} psi, ${Math.abs(v - (v > hi ? hi : lo)).toFixed(1)} ${v > hi ? "over" : "under"} the ` +
            `${lo.toFixed(1)}-${hi.toFixed(1)} window at the line: ${v > hi ? "lower" : "raise"} them at the next stop`]);
        }
      }
    }
    const cold = CORNERS.filter((_, i) => moving && 0 < r.core_temp[i] && r.core_temp[i] < th.tyre_c[0]);
    if (cold.length) out.push([0, "tyres_cold", `Tyres still cold: ${cold.join(", ")}`]);
    const hot = CORNERS.map((c, i) => [c, r.brake_temp[i], i] as const).filter(([, t, i]) => t > th.brake_c[i < 2 ? "front" : "rear"][1]);
    if (hot.length) out.push([2, "brakes_hot", `Brakes overheating: ${hot.map(([c]) => c).join(", ")} at ${Math.max(...hot.map(([, t]) => t)).toFixed(0)} °C`]);
    const pad = Math.min(...(r.pad as number[])), low: number = th.pad_low_mm;
    if (0 < pad && pad < low) out.push([pad < low - 4 ? 2 : 1, "pads_low", `Brake pads down to ${pad.toFixed(1)} mm: change them at the next stop`]);
    const lof = st.laps_of_fuel;
    if (lof !== null && st.box_in_laps === 0 && st.fuel_to_add_l !== 0) out.push([2, "fuel_box", `Fuel for ${lof.toFixed(1)} laps: box this lap`]);
    else if (lof !== null && lof < this.config.fuel_low_laps) out.push([1, "fuel_low", `Fuel for ${lof.toFixed(1)} laps`]);
    if (r.session === 2 && st.fuel_needed_l !== null) {
      const short = st.fuel_to_add_l;
      out.push([0, "fuel_flag", short > 0.5 ? `${short.toFixed(0)} L short of the flag (${st.laps_to_go} laps): plan the stop`
        : `Fuel to the flag, ${(r.fuel - st.fuel_needed_l).toFixed(1)} L spare`]);
    }
    if (r.damage.some((d: number) => d >= 10)) out.push([1, "damage", "Car damaged: think about repairs at the stop"]);
    if (!r.rain_tyres && r.rain.length > 1 && 3 <= r.rain[1] && r.rain[1] < RAIN.length) out.push([1, "rain_coming", `${RAIN[r.rain[1]]} in 10 min on dry tyres: think about wets`]);
    const pw = st.pit_window;
    if (st.mandatory_left && pw && pw.close_lap - (r.laps + 1) <= 2) {
      out.push([1, "window_closing", `Pit window closes on lap ${pw.close_lap}: ${st.mandatory_left} mandatory stop still owed`]);
    }
    if (st.lap_ref_ms && 0 <= r.stint_left && r.stint_left < 2 * st.lap_ref_ms) out.push([2, "stint_limit", `Driver stint ends in ${(r.stint_left / 1000).toFixed(0)} s: box within two laps`]);
    if (pen) { const [short, why] = PENALTIES[pen.kind]!; out.push([2, "penalty", `Serve ${short} (${why}): ${pen.laps_left} laps left`]); }
    return out.sort((a, b) => b[0] - a[0]).map(([s, i, t]) => ({ id: i, severity: s, text: t }));
  }
}
