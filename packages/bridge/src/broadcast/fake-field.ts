// Twenty made-up cars on FakePages' circuit and clock. Car 7 is the player; the others lap at 58.8 to 62.6 s and stop every
// 18 to 26 laps for 52 s in the pit lane. Laps and stints scale with the track, so the Nordschleife has 8:17 laps and 4-lap stints.
import { FakePages } from "../telemetry/fake-pages.js";
import { Rec } from "../util.js";
import { BroadcastState, FieldSource, Sink } from "./client.js";
import { Field } from "./field.js";
import { PIT_LOCS, RACE } from "./models.js";

const NAMES: [string, string][] = [["Lena", "Varga"], ["Tomas", "Reyes"], ["Aiko", "Mori"], ["Jonas", "Lindqvist"], ["Mara", "Okafor"], ["Pietro", "Sala"],
  ["Ines", "Duarte"], ["Kalle", "Rautio"], ["Noor", "Haddad"], ["Felix", "Brandt"], ["Sofia", "Marek"], ["Ruben", "Castell"],
  ["Yuki", "Tanabe"], ["Oskar", "Wiles"], ["Leila", "Farrow"], ["Matteo", "Ricci"], ["Hana", "Novak"], ["Dario", "Pell"], ["Elin", "Strand"]];
const TEAMS = ["Northline Racing", "Vela Motorsport", "Kestrel GT", "Blue Fen Racing", "Atlas Endurance", "Corsa Nove", "Redwater GT",
  "Ostra Racing", "Halden Motorsport", "Sable Works"];
const FAKE_MODELS = [32, 30, 34, 31, 25, 33, 35, 22, 24, 20, 36, 23, 16, 19, 21, 50, 61, 53, 60]; // 15 GT3, then 4 GT4
const NUMS = [3, 11, 14, 22, 27, 33, 41, 46, 52, 58, 61, 66, 72, 77, 81, 88, 91, 95, 99];

/** mulberry32: a small seeded generator, so the pretend field is the same every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { random, uniform: (lo: number, hi: number) => lo + (hi - lo) * random(), randint: (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1)) };
}

export class FakeField extends Field implements FieldSource {
  static LANE_MS = 52000;
  static PIT_IN = 0.97;
  state: BroadcastState = { state: "live", msg: "simulated field", port: 0 };
  private quali: boolean;
  private rnd: ReturnType<typeof rng>;
  private sim = new Map<number, Rec>();
  private started = false;
  private tSim: number | null = null;
  private meBest: Rec | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private pages: FakePages, session: "race" | "quali" = "race", seed = 7) {
    super();
    this.quali = session === "quali";
    this.rnd = rng(seed);
    const rnd = this.rnd;
    let n = 0;
    for (let i = 1; i <= 20; i++) {
      if (i === 7) continue;
      const every = Math.max(2, Math.floor((rnd.randint(18, 26) * pages.every) / 18));
      const age = i === 2 ? every - 1 : rnd.randint(0, 25) % every; // car 2 is on its in-lap: someone pits in the first minutes
      const d0 = 3.5 + rnd.uniform(-0.45, 0.45);
      const [first, last] = NAMES[n]!;
      this.sim.set(i, { base: rnd.uniform(58800, 62600) * pages.k, every, stint: age, laps: Math.trunc(d0), spl: d0 % 1,
        start: null, dur: null, pit: null, out: false, valid: true, last: null, best: null,
        model: FAKE_MODELS[n]!, num: NUMS[i - 1 - (i > 7 ? 1 : 0)]!, team: TEAMS[i % TEAMS.length]!, cup: i % 3, first, last_name: last });
      n++;
    }
  }

  private pageT(): number {
    const p = this.pages;
    return (p.clock() - p.t0) * 1000 + 3.5 * p.lap;
  }

  private lapd(ms: number | null, s: (number | null)[] = [null, null, null], valid = true, out = false, inl = false, car = 0): Rec {
    return { ms, car, drv: 0, s: [...s], valid, out, in: inl };
  }

  private newLap(c: Rec, t: number): void {
    c.start = t; c.dur = c.base + this.rnd.uniform(-250, 250);
    c.valid = !((c.laps + 1) % 5 === 0 && this.rnd.random() < 0.1);
  }

  private advance(i: number, c: Rec, t: number, dt: number): void {
    if (c.start === null) this.newLap(c, t - c.spl * c.base);
    let spl: number, loc: number;
    if (c.pit !== null) {
      const e = t - c.pit;
      spl = c.spl + (0.06 * dt) / FakeField.LANE_MS; // 0.97 -> 1.03 of a lap in 52 s: the lane crosses the line
      if (e >= FakeField.LANE_MS) { c.pit = null; c.stint = 0; }
      loc = e < 3000 ? 3 : e > FakeField.LANE_MS - 3000 ? 4 : 2;
    } else {
      spl = c.spl + dt / c.dur; loc = 1;
      if (!this.quali && c.stint >= c.every && c.spl < FakeField.PIT_IN && FakeField.PIT_IN <= spl) { c.pit = t; spl = FakeField.PIT_IN; loc = 3; }
    }
    if (spl >= 1) { // the line
      spl -= 1;
      c.laps++;
      const ms = Math.trunc(t - c.start);
      const s1 = Math.trunc(ms * this.rnd.uniform(0.32, 0.34)), s2 = Math.trunc(ms * this.rnd.uniform(0.33, 0.35));
      c.last = this.lapd(ms, [s1, s2, ms - s1 - s2], c.valid, c.out, c.pit !== null, i);
      if (c.valid && !c.out && (c.best === null || ms < c.best.ms)) c.best = c.last;
      c.out = c.pit !== null;
      c.stint += c.pit === null ? 1 : 0;
      this.newLap(c, t);
    }
    c.spl = spl; c.loc = loc;
  }

  /** One batch as ACC would send it: (entry list and track data once,) a realtime update, then every car. */
  messages(): [number, Rec][] {
    const t = this.pageT();
    const dt = this.tSim === null ? 0 : t - this.tSim;
    this.tSim = t;
    const out: [number, Rec][] = [];
    const raw = this.pages.read();
    const me: Rec = { laps: raw.laps, spl: raw.track_pos, loc: raw.pit_lane ? 2 : 1, kmh: Math.trunc(raw.speed), gear: raw.gear - 1,
      cur: raw.cur_ms, valid: !!raw.valid, out: false };
    const third = Math.floor(this.pages.lap / 3); // FakePages' sectors start at a third and two thirds of its lap, as the telemetry records them
    const split = (ms: number) => [third, third, ms - 2 * third];
    if (raw.laps > 0) {
      const ms = raw.last_ms;
      me.last = this.lapd(ms, split(ms), (raw.laps - 1) % 5 !== 2, false, false, 7);
    }
    if (me.last && me.last.valid && (this.meBest === null || me.last.ms < this.meBest.ms)) this.meBest = me.last;
    let best: Rec | null = this.meBest; // as Telemetry.bestLap has it (the KPI strip): the best valid lap seen, else the game's best
    if (best === null && raw.best_ms > 0 && raw.best_ms < 3.6e6) best = this.lapd(raw.best_ms, split(raw.best_ms), true, false, false, 7);
    if (!this.started) {
      this.started = true;
      out.push([5, { conn: 1, name: this.pages.name, id: 0, meters: Math.trunc(this.pages.trackLen) }]);
      out.push([4, { conn: 1, cars: Array.from({ length: 20 }, (_, k) => k + 1) }]);
      for (const [i, c] of [...this.sim].sort((a, b) => a[0] - b[0])) {
        out.push([6, { i, model: c.model, team: c.team, num: c.num, cup: c.cup, cur_drv: 0, nat: 0,
          drivers: [{ first: c.first, last: c.last_name, short: c.last_name.slice(0, 3).toUpperCase(), dcat: 1, nat: 0 }] }]);
      }
      out.push([6, { i: 7, model: 32, team: "Pit Wall Demo", num: 7, cup: 0, cur_drv: 0, nat: 0,
        drivers: [{ first: raw.name, last: "", short: raw.name.slice(0, 3).toUpperCase(), dcat: 1, nat: 0 }] }]);
    }
    for (const [i, c] of this.sim) this.advance(i, c, t, dt);
    const rows: [number, Rec][] = [...this.sim, [7, { ...me, best, last: me.last ?? null }]];
    const dist = (c: Rec) => c.laps + c.spl;
    if (this.quali) { // qualifying: best lap first, cars without one after, by distance
      const key = (c: Rec): [number, number] => [c.best === null ? 1 : 0, c.best ? c.best.ms : -dist(c)];
      rows.sort((a, b) => { const x = key(a[1]), y = key(b[1]); return x[0] - y[0] || x[1] - y[1]; });
    } else rows.sort((a, b) => dist(b[1]) - dist(a[1]));
    const cupN = new Map<number, number>();
    const bests = rows.map(([, c]) => c.best as Rec | null).filter((b): b is Rec => !!b);
    const sessBest = bests.length ? bests.reduce((m, b) => (b.ms < m.ms ? b : m)) : null;
    out.push([2, { event_idx: 0, session_idx: 0, type: this.quali ? 4 : RACE, phase: 5, time_ms: t, end_ms: t + raw.time_left,
      focus: 7, replay: false, tod_ms: 14 * 3600 * 1000 + t, air: 22, track: 29, clouds: 0.2, rain: 0.0, wet: 0.0, best: sessBest ?? this.lapd(null) }]);
    rows.forEach(([i, c], k) => {
      const cup = i === 7 ? 0 : c.cup;
      cupN.set(cup, (cupN.get(cup) ?? 0) + 1);
      const empty = this.lapd(null, undefined, true, false, false, i);
      out.push([3, { i, drv: 0, drivers: 1, gear: c.gear ?? 4, x: 0.0, y: 0.0, yaw: 0.0, loc: c.loc, kmh: c.kmh ?? (c.loc === 2 ? 0 : 200), pos: k + 1,
        cpos: cupN.get(cup), tpos: k + 1, spl: c.spl, laps: c.laps, delta: 0, best: c.best || empty, last: c.last || empty,
        cur: this.lapd(c.start != null ? Math.trunc(t - c.start) : c.cur, undefined, c.valid, c.out, false, i) }]);
    });
    return out;
  }

  override on(kind: number, d: Rec): void {
    const isNew = kind === 3 && !this.cars.has(d.i);
    super.on(kind, d);
    if (isNew) { // the pretend race was running before the bridge: give each car its last three laps of marks at its pace
      const c = this.cars.get(d.i)!, pace = d.i === 7 ? this.pages.lap : this.sim.get(d.i)!.base;
      const old = Array.from({ length: 299 }, (_, k) => [c.dist - (299 - k) / 100, this.t - ((299 - k) / 100) * pace] as [number, number]);
      c.marks.unshift(...old);
      if (c.marks.length > 300) c.marks.length = 300;
    }
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
