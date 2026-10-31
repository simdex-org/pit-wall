// The simulated session's twenty cars as ACC's broadcasting would send them: an entry list once, then a realtime update
// and every car's update each time, and the race control events as they happen.
import { gearAt, SimCar } from "../sim/car.js";
import { LANE_IN, LANE_OUT } from "../sim/circuit.js";
import { World } from "../sim/world.js";
import { FakePages } from "../telemetry/fake-pages.js";
import { Rec } from "../util.js";
import { BroadcastState, FieldSource, Sink } from "./client.js";
import { Field } from "./field.js";
import { PIT_LOCS, RACE } from "./models.js";

/** ACC's session type for qualifying. */
const QUALI = 4;

export class FakeField extends Field implements FieldSource {
  state: BroadcastState = { state: "live", msg: "simulated field", port: 0 };
  private started = false;
  private timer: NodeJS.Timeout | null = null;
  private world: World;

  constructor(private pages: FakePages) {
    super();
    this.world = pages.world;
  }

  private lapd(ms: number | null, s: (number | null)[] = [null, null, null], valid = true, out = false, inl = false, car = 0): Rec {
    return { ms, car, drv: 0, s: [...s], valid, out, in: inl };
  }

  private loc(c: SimCar): number {
    if (c.st === "garage" || c.st === "retired") return 2;
    if (!c.inLane) return 1;
    const l = c.lane;
    return l < LANE_IN + 25 ? 3 : l > LANE_OUT - 25 ? 4 : 2;
  }

  /** One batch as ACC would send it: (entry list and track data once,) a realtime update, the events, then every car. */
  messages(): [number, Rec][] {
    const w = this.world, t = w.t, out: [number, Rec][] = [];
    w.sync(this.pages.clock());
    if (!this.started) {
      this.started = true;
      out.push([5, { conn: 1, name: w.name, id: 0, meters: Math.trunc(w.circuit.len) }]);
      out.push([4, { conn: 1, cars: w.cars.map((c) => c.id) }]);
      for (const c of w.cars) {
        const s = c.spec;
        out.push([6, { i: c.id, model: s.model, team: s.team, num: s.num, cup: s.cup, cur_drv: 0, nat: 0,
          drivers: [{ first: s.first, last: s.last, short: (s.last || s.first).slice(0, 3).toUpperCase(), dcat: 1, nat: 0 }] }]);
      }
    }
    const rank = w.rank();
    const best = w.best ? this.lapd(w.best.ms, w.best.s, true, false, false, w.best.car) : this.lapd(null);
    const tod = 14 * 3600 * 1000 + t;
    out.push([2, { event_idx: 0, session_idx: w.idx, type: w.kind === "race" ? RACE : w.kind === "quali" ? QUALI : 0, phase: w.phase, time_ms: t, end_ms: w.durMs,
      focus: w.playerId, replay: false, tod_ms: tod, air: 22 - 3 * w.rain, track: Math.round(w.road), clouds: Math.min(1, 0.2 + w.rain + w.wet / 2), rain: w.rain, wet: w.wet, best }]);
    for (const e of w.events.splice(0)) out.push([7, { type: e.type, msg: e.msg, time_ms: Math.trunc(e.t), car: e.car }]);
    const cupN = new Map<number, number>();
    rank.forEach((c, k) => {
      const cup = c.spec.cup;
      cupN.set(cup, (cupN.get(cup) ?? 0) + 1);
      const empty = this.lapd(null, undefined, true, false, false, c.id);
      const [x, z] = w.circuit.pos(c.d, c.lat);
      const kmh = c.v * 3.6;
      const lap = (l: { ms: number | null; s: (number | null)[]; valid: boolean; out: boolean; in: boolean } | null) =>
        l ? this.lapd(l.ms, l.s, l.valid, l.out, l.in, c.id) : empty;
      out.push([3, { i: c.id, drv: 0, drivers: 1, gear: c.v < 0.5 ? 0 : gearAt(kmh) + 1, x, y: z, yaw: 0, loc: this.loc(c), kmh: Math.trunc(kmh),
        pos: k + 1, cpos: cupN.get(cup), tpos: k + 1, spl: c.spl, laps: c.laps, delta: 0, best: lap(c.best), last: lap(c.last),
        cur: this.lapd(c.lapStart === null ? null : Math.trunc(Math.max(0, t - c.lapStart)), undefined, c.valid, c.out, false, c.id) }]);
    });
    return out;
  }

  step(): void {
    for (const [kind, d] of this.messages()) this.on(kind, d);
  }

  start(sink: Sink): void {
    const tick = () => { for (const [kind, d] of this.messages()) sink(kind, d); };
    tick();
    this.timer = setInterval(tick, 250);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

export { PIT_LOCS };
