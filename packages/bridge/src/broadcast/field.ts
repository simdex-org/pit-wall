// Broadcasting messages in, standings out. Times are ACC's session time in ms from the latest REALTIME_UPDATE,
// which every car update in that batch shares.
import { fmtLap } from "../telemetry/constants.js";
import { mod, roundHalfEven, Rec } from "../util.js";
import { CUPS, LOCS, MODELS, PHASES, PIT_LOCS, RACE } from "./models.js";

type Mark = [dist: number, t: number];
export type FieldEvent = [sev: number, cat: string, text: string];

/** When a car was at distance d (laps + spline), interpolated between its marks; null outside them. */
function tAt(pts: Mark[], dists: number[], d: number): number | null {
  if (pts.length < 2 || !(dists[0]! <= d && d <= dists[dists.length - 1]!)) return null;
  let lo = 0, hi = dists.length; // bisect_left
  while (lo < hi) { const m = (lo + hi) >> 1; if (dists[m]! < d) lo = m + 1; else hi = m; }
  const k = lo;
  if (k === 0) return pts[0]![1];
  const [d0, t0] = pts[k - 1]!, [d1, t1] = pts[k]!;
  return d1 > d0 ? t0 + ((t1 - t0) * (d - d0)) / (d1 - d0) : t1;
}

/** Relative only lists cars within this fraction of a lap of me. */
const REL_WINDOW = 0.25;
export const wrap = (x: number): number => mod(x + 1.5, 1) - 0.5;

type Axis = (x: number, y: number) => [number, number];
const AXES: Axis[] = [(x, y) => [x, y], (x, y) => [x, -y], (x, y) => [-x, y], (x, y) => [y, x]];

export class Field {
  cars = new Map<number, Rec>();
  ent = new Map<number, Rec>();
  track: Rec | null = null;
  rt: Rec | null = null;
  t = 0.0;
  sidx: number | null = null;
  phase: number | null = null;
  me: number | null = null;
  slowSeq = 0;
  events: FieldEvent[] = [];
  private xzS: number[][] = [];
  private xzMap: Axis | null = null;
  private xzDone = false;

  // --- input ---
  on(kind: number, d: Rec): void {
    if (kind === 2) {
      if (this.sidx !== null && d.session_idx !== this.sidx) this.cars = new Map(); // new session: pits, marks and laps start over
      if (this.phase !== null && d.phase !== this.phase && d.phase >= 0 && d.phase < PHASES.length) this.events.push([0, "RC", `Session phase: ${PHASES[d.phase]}`]);
      this.sidx = d.session_idx; this.phase = d.phase; this.rt = d; this.t = d.time_ms;
    } else if (kind === 3) {
      this.car(d);
    } else if (kind === 4) {
      const keep = new Set<number>(d.cars);
      this.ent = new Map([...this.ent].filter(([i]) => keep.has(i)));
      this.cars = new Map([...this.cars].filter(([i]) => keep.has(i)));
    } else if (kind === 5) {
      this.track = { name: d.name, id: d.id, length_m: d.meters > 0 ? d.meters : null };
    } else if (kind === 6) {
      const [name, cls] = MODELS[d.model as number] ?? ["Unknown", "?"];
      this.ent.set(d.i, {
        num: d.num, team: d.team, model: d.model, model_name: name, class: cls, cup: d.cup, cup_name: d.cup < CUPS.length ? CUPS[d.cup] : "?", nat: d.nat,
        drivers: d.drivers.map((v: Rec) => ({ first: v.first, last: v.last, short: v.short, dcat: v.dcat })),
      });
    } else if (kind === 7) {
      const num = this.num(d.car);
      if (d.type === 3) this.events.push([1, "RC", `Race control: ${d.msg}`]);
      else if (d.type === 4) this.events.push([1, "RC", `Accident: #${num}`]);
      else if (d.type === 6) {
        const ms = this.cars.get(d.car)?.best;
        this.events.push([0, "RC", ms ? `Session best ${fmtLap(ms)} #${num}` : `Session best #${num}`]);
      }
    }
  }

  private num(i: number): number {
    return this.ent.get(i)?.num ?? i;
  }

  private bump(c: Rec): void {
    c.seq = ++this.slowSeq;
  }

  private car(d: Rec): void {
    const i: number = d.i, t = this.t;
    let c = this.cars.get(i);
    if (!c) {
      c = { marks: [] as Mark[], hist: [] as Rec[], pits: 0, last_pit_lap: null, pit_t: null, lane_ms: null, exit_laps: null, int_hist: [], gap_hist: [],
        gap: null, gap_laps: 0, int: null, int_laps: 0, loc: null, laps: null, drv: null, seq: 0, last: null, dist: null };
      this.cars.set(i, c);
    }
    let dist: number = d.laps + d.spl;
    if (c.dist !== null && Math.abs(dist - c.dist) > 0.5) { // laps and spline wrap in different packets: take the nearer reading
      dist = Math.abs(dist - 1 - c.dist) <= Math.abs(dist + 1 - c.dist) ? dist - 1 : dist + 1;
      if (Math.abs(dist - c.dist) > 0.5) { // back to the pits / teleported: the old marks mean nothing now
        c.marks.length = 0;
        dist = d.laps + d.spl;
      }
    }
    const m: Mark[] = c.marks;
    if (!m.length || (dist > m[m.length - 1]![0] && Math.floor(dist * 100) > Math.floor(m[m.length - 1]![0] * 100))) {
      m.push([dist, t]);
      if (m.length > 300) m.shift();
    }
    let slow = c.drv !== null && d.drv !== c.drv;
    const loc: number = d.loc, prev: number | null = c.loc;
    if (prev !== null && !PIT_LOCS.includes(prev) && PIT_LOCS.includes(loc)) {
      c.pits++; c.last_pit_lap = d.laps; c.pit_t = t; slow = true;
      if (i !== this.me) this.events.push([0, "FIELD", `#${this.num(i)} in the pits, L${d.laps + 1}`]);
    } else if (prev !== null && PIT_LOCS.includes(prev) && loc === 1) {
      c.exit_laps = d.laps; slow = true;
      if (c.pit_t !== null) {
        c.lane_ms = Math.trunc(t - c.pit_t);
        if (i !== this.me) this.events.push([0, "FIELD", `#${this.num(i)} out, lane ${(c.lane_ms / 1000).toFixed(1)} s`]);
      }
    } else if (prev !== null && loc !== prev) slow = true;
    const last: Rec = d.last;
    if (c.laps !== null && d.laps > c.laps) {
      c.hist.push({ n: d.laps, ms: last.ms, s: last.s.slice(0, 3), valid: last.valid, out: last.out, in: last.in, gap: c.gap, pos: d.pos });
      if (c.hist.length > 100) c.hist.shift();
      c.int_hist = [...c.int_hist, c.int].slice(-5); c.gap_hist = [...c.gap_hist, c.gap].slice(-5);
      slow = true;
    } else if (c.hist.length && c.last !== null && last.ms !== c.last.ms && c.hist[c.hist.length - 1].n === d.laps) {
      Object.assign(c.hist[c.hist.length - 1], { ms: last.ms, s: last.s.slice(0, 3), valid: last.valid }); // the last lap arrived a packet after the line
      slow = true;
    }
    Object.assign(c, { pos: d.pos, cpos: d.cpos, laps: d.laps, spl: d.spl, kmh: d.kmh, gear: d.gear, loc, cur: d.cur.ms, delta: d.delta, drv: d.drv,
      x: d.x, y: d.y, dist, last, best_lap: d.best, best: d.best.ms, out: d.cur.out, inl: d.cur.in });
    if (slow || !c.seq) this.bump(c);
  }

  // --- derived ---
  mode(): "race" | "best" {
    return this.rt && this.rt.type === RACE ? "race" : "best";
  }

  private resolveMe(hint: Rec | null): void {
    if (!hint) return;
    const c = this.cars.get(hint.id);
    if (c && Math.abs(c.laps - hint.laps) <= 1 && Math.abs(wrap(c.spl - hint.spl)) < 0.02) { this.me = hint.id; return; }
    const name = String(hint.name || "").trim().toLowerCase();
    for (const [i, e] of this.ent) {
      if (name && e.drivers.some((d: Rec) => `${d.first} ${d.last}`.trim().toLowerCase() === name)) { this.me = i; return; }
    }
    this.me = null;
  }

  /** Broadcast WorldPosX/Y only count once they match shared memory's x, z under one of four axis mappings. */
  private xzCheck(hint: Rec | null): void {
    const c = this.me === null ? undefined : this.cars.get(this.me);
    if (this.xzDone || !hint || !c || (hint.kmh || 0) < 5) return;
    this.xzS.push([c.x, c.y, hint.xyz[0], hint.xyz[2]]);
    if (this.xzS.length < 30) return;
    this.xzDone = true;
    if (this.xzS.every(([x, y]) => Math.abs(x!) < 1e-6 && Math.abs(y!) < 1e-6)) return; // zeros, as the Go SDK saw: no positions
    // The two sources are up to 250 ms apart, so the error grows at speed. This is a fallback; the spline path comes first.
    const err = AXES.map((f) => this.xzS.reduce((s, [x, y, sx, sz]) => { const [a, b] = f(x!, y!); return s + Math.hypot(a - sx!, b - sz!); }, 0) / this.xzS.length);
    const k = err.indexOf(Math.min(...err));
    if (err[k]! < 5) this.xzMap = AXES[k]!;
  }

  private pts(c: Rec): [Mark[], number[]] {
    const pts: Mark[] = [...c.marks];
    if (c.dist !== null && (!pts.length || c.dist > pts[pts.length - 1]![0])) pts.push([c.dist, this.t]);
    return [pts, pts.map((p) => p[0])];
  }

  /** Race gap of b behind a, ms, plus whole laps when a is a lap or more ahead. */
  private gap(a: Rec, b: Rec): [number | null, number] {
    const diff = a.dist - b.dist;
    if (diff < 0) return [null, 0];
    const n = diff >= 1 ? Math.floor(diff) : 0;
    const ta = tAt(a._pts[0], a._pts[1], b.dist + n);
    return [ta === null ? null : Math.max(0, roundHalfEven(this.t - ta)), n];
  }

  private pace(c: Rec): number | null {
    const ok = c.hist.filter((h: Rec) => h.ms && h.valid && !h.out && !h.in).map((h: Rec) => h.ms as number).slice(-3);
    return ok.length ? ok.reduce((a: number, b: number) => a + b, 0) / ok.length : null;
  }

  private order(): [number, Rec][] {
    // ACC's positions come in per-car packets, so a snapshot can hold two P11s and no P26: a tie goes to whoever is further round
    const race = this.mode() === "race";
    return [...this.cars].sort(([ia, a], [ib, b]) => (a.pos || 999) - (b.pos || 999) || (race ? (b.dist || 0) - (a.dist || 0) : 0) || ia - ib);
  }

  private compute(): [number, Rec][] {
    for (const c of this.cars.values()) c._pts = this.pts(c);
    const order = this.order();
    const race = this.mode() === "race";
    const p1 = order.length ? order[0]![1] : null;
    const cupN = new Map<unknown, number>();
    order.forEach(([i, c], k) => {
      c.pos = k + 1; // the order is the truth: ranks always run 1..n without repeats
      const cup = this.ent.get(i)?.cup;
      if (c.cpos) { c.cpos = (cupN.get(cup) ?? 0) + 1; cupN.set(cup, c.cpos); }
      if (k === 0) {
        c.gap = race || c.best ? 0 : null; c.gap_laps = 0; c.int = null; c.int_laps = 0;
      } else if (race) {
        const prev = order[k - 1]![1];
        [c.gap, c.gap_laps] = this.gap(p1!, c);
        // the interval from the two gaps to P1 when both are in the same lap, so Gap and Int always agree (the
        // car-to-car time is off while the car ahead crawls down the pit lane); car to car otherwise
        if (c.gap !== null && prev.gap !== null && c.gap_laps === prev.gap_laps) { c.int = Math.max(0, c.gap - prev.gap); c.int_laps = 0; }
        else [c.int, c.int_laps] = this.gap(prev, c);
      } else {
        const ahead = order[k - 1]![1];
        c.gap = c.best && p1!.best ? c.best - p1!.best : null;
        c.int = c.best && ahead.best ? c.best - ahead.best : null;
        c.gap_laps = c.int_laps = 0;
      }
    });
    const me = this.me === null ? undefined : this.cars.get(this.me);
    for (const c of this.cars.values()) {
      c.rel = null;
      if (!me || c === me) { c.rel = c === me ? 0 : null; continue; }
      const f = wrap(c.spl - me.spl);
      if (Math.abs(f) > REL_WINDOW) continue; // not a neighbour: "ahead" or "behind" there is only where the half-lap wrap cuts
      if (f >= 0) { // ahead on track: how long ago it passed where I am
        const tc = tAt(c._pts[0], c._pts[1], c.dist - f);
        c.rel = tc === null ? null : roundHalfEven(this.t - tc);
      } else { // behind: how long ago I passed where it is
        const tm = tAt(me._pts[0], me._pts[1], me.dist + f);
        c.rel = tm === null ? null : -roundHalfEven(this.t - tm);
      }
    }
    return order;
  }

  /** The `field` payload (fast part). meHint: {id, laps, spl, name, xyz, kmh, coords} from shared memory, or null.
   * mandatory: stops every car owes in this race, or null; lossMs: what a stop costs, for the net position. */
  snapshot(meHint: Rec | null, mandatory: number | null, lossMs: number | null): Rec {
    this.resolveMe(meHint);
    this.xzCheck(meHint);
    const order = this.compute();
    const race = this.mode() === "race";
    const ref = this.raceInfo()?.leader_pace_ms;
    let net = new Map<number, number>();
    if (race && mandatory !== null && lossMs !== null && ref) {
      const tot = new Map<number, number>();
      for (const [i, c] of order) if (c.gap !== null) tot.set(i, c.gap + c.gap_laps * ref + Math.max(0, mandatory - c.pits) * lossMs);
      if (tot.size === order.length) net = new Map([...tot.keys()].sort((a, b) => tot.get(a)! - tot.get(b)! || a - b).map((i, k) => [i, k + 1]));
    }
    const rt = this.rt ?? {};
    const best = rt.best ?? {};
    const coords: Rec = meHint?.coords ?? {};
    return {
      t: this.t, type: rt.type ?? null, phase: rt.phase ?? null, idx: this.sidx, mode: this.mode(), me: this.me,
      best: best.ms ? { ms: best.ms, car: best.car } : null,
      weather: this.rt ? { air: rt.air, track: rt.track, clouds: rt.clouds, rain: rt.rain, wet: rt.wet } : null,
      track_m: this.track?.length_m ?? null, xz_ok: Object.keys(coords).length > 0 || this.xzMap !== null,
      cars: order.map(([i, c]) => ({
        i, pos: c.pos, cpos: c.cpos, laps: c.laps, spl: c.spl, kmh: c.kmh, gear: c.gear,
        loc: c.loc >= 0 && c.loc < LOCS.length ? LOCS[c.loc] : "none", cur: c.cur, delta: c.delta,
        gap: c.gap, gap_laps: c.gap_laps, int: c.int, int_laps: c.int_laps, rel: c.rel,
        net: net.get(i) ?? null, drv: c.drv, xz: coords[i] || (this.xzMap ? [...this.xzMap(c.x, c.y)] : null),
      })),
    };
  }

  private slowOf(c: Rec): Rec {
    const last = c.last ?? {}, best = c.best_lap ?? {};
    return { seq: c.seq, last: last.ms ?? null, last_s: (last.s ?? [null, null, null]).slice(0, 3), last_valid: last.valid ?? null,
      best: best.ms ?? null, best_s: (best.s ?? [null, null, null]).slice(0, 3), pits: c.pits, last_pit_lap: c.last_pit_lap,
      lane_ms: c.lane_ms, stint_laps: c.laps - (c.exit_laps ?? 0), out: c.out, in: c.inl, int_hist: c.int_hist, gap_hist: c.gap_hist };
  }

  /** Slow per-car fields (lap times, pits, histories) of cars that changed after seq, and the newest seq. */
  slowSince(seq: number): [Rec, number] {
    return [Object.fromEntries([...this.cars].filter(([, c]) => c.seq > seq).map(([i, c]) => [String(i), this.slowOf(c)])), this.slowSeq];
  }

  entries(): Rec {
    return { track: this.track ? { ...this.track } : null,
      cars: Object.fromEntries([...this.ent].map(([i, e]) => [String(i), { ...e, drivers: e.drivers.map((d: Rec) => ({ ...d })) }])) };
  }

  carLaps(idx: number): Rec[] {
    const c = this.cars.get(idx);
    return c ? c.hist.map((h: Rec) => ({ ...h, s: [...h.s] })) : [];
  }

  /** What the telemetry's strategy needs from the field: the leader's distance and pace, and the session mode. */
  raceInfo(): Rec | null {
    const order = this.order();
    if (!order.length) return null;
    const p1 = order[0]![1];
    return { leader_dist: p1.dist, leader_pace_ms: this.pace(p1), mode: this.mode(), elapsed_ms: this.t };
  }

  /** Where I come out if I stop now and it costs lossMs: my gap to the leader plus the loss, ranked against the cars
   * not in the pits. {pos, ahead, behind, around}; gap_ms in around is signed (negative: ahead of me). null outside races. */
  rejoin(myIdx: number | null, lossMs: number | null): Rec | null {
    const me = myIdx === null ? undefined : this.cars.get(myIdx);
    if (this.mode() !== "race" || !me || lossMs === null || me.gap == null) return null;
    const ref = this.raceInfo()?.leader_pace_ms || 0;
    const rows: [number, number][] = [];
    for (const [i, c] of this.cars) if (i !== myIdx && c.gap != null && !PIT_LOCS.includes(c.loc)) rows.push([c.gap + c.gap_laps * ref, i]);
    const mine = me.gap + me.gap_laps * ref + lossMs;
    rows.push([mine, myIdx!]);
    rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const k = rows.findIndex(([v, i]) => v === mine && i === myIdx);
    const row = (j: number) => (j >= 0 && j < rows.length && j !== k ? { i: rows[j]![1], gap_ms: roundHalfEven(Math.abs(rows[j]![0] - mine)) } : null);
    const lo = Math.max(0, Math.min(k - 2, rows.length - 5));
    return { pos: k + 1, ahead: row(k - 1), behind: row(k + 1), around: rows.slice(lo, lo + 5).map(([v, i]) => ({ i, gap_ms: roundHalfEven(v - mine) })) };
  }
}
