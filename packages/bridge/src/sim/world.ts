// The pretend session: twenty cars on one circuit, a race or a qualifying, run in fixed steps of simulated time.
// FakePages and FakeField are two views of it; nothing here knows about ACC's pages or messages.
import { SIM_TRACKS, trackLoop } from "../telemetry/sim-tracks.js";
import { Box, Lap, SimCar } from "./car.js";
import { Circuit, DEMO_LOOP, scaleLoop } from "./circuit.js";
import { stepCar } from "./drive.js";
import { setupQuali, setupRace } from "./plan.js";
import { Rng, rng } from "./rng.js";
import { PLAYER, roster, Spec } from "./roster.js";

export const STEP_S = 1 / 60;
const STEP_MS = STEP_S * 1000;
const GRID_GAP = 8; // metres between rows
const HOLD_RESULTS_MS = 40000;

export type SessionKind = "race" | "quali" | "practice";
export interface WorldEvent { type: number; msg: string; car: number; t: number }
export interface Best { ms: number; car: number; s: (number | null)[] }

/** ACC's rain levels (0 dry, 1 drizzle ... 5 storm) for an intensity 0 to 1. */
export const rainLevel = (r: number): number => (r < 0.05 ? 0 : r < 0.2 ? 1 : r < 0.4 ? 2 : r < 0.65 ? 3 : r < 0.85 ? 4 : 5);

interface Shower { start: number; up: number; hold: number; down: number; peak: number }

export const DEMO = { id: "demo_circuit", name: "Demo circuit", metres: 4600, lapMs: 98000, lpl: 2.9 };

export class World {
  readonly trackId: string;
  readonly name: string;
  readonly circuit: Circuit;
  private readonly specs: Spec[];
  private readonly lpl: number;
  private readonly seed: number;
  private readonly minutes: number | undefined;
  cars: SimCar[] = [];
  rnd!: Rng;
  idx = 0;
  t = 0;
  durMs = 0;
  pitOpen = 0;
  pitClose = 0;
  /** The race has a mandatory stop in the pit window. */
  get mandatory(): boolean { return this.kind === "race"; }
  kind: SessionKind;
  /** The sessions run one after the other, round again at the end. */
  private readonly sequence: SessionKind[];
  /** Qualifying's classification, which sets the race grid. */
  private carry: number[] | null = null;
  evo = 0;
  laps = 0;
  best: Best | null = null;
  yellow = [-1e12, -1e12, -1e12];
  /** Rain intensity and how wet the track is, 0 to 1. */
  rain = 0;
  wet = 0;
  private shower: Shower | null = null;
  /** Full course yellow: every car on the track holds 80 km/h until the wreck is cleared. */
  fcyOn = false;
  private fcyUntil = 0;
  lastRelease = 0;
  finished = 0;
  leaderDone = false;
  overAt: number | null = null;
  doneAt: number | null = null;
  events: WorldEvent[] = [];
  /** Lets the page's pit plan change the driver's stop. */
  customize: ((box: Box, c: SimCar) => void) | null = null;
  private origin: number | null = null;
  private done = 0;
  private ranked: SimCar[] = [];
  private rankedAt = -1;
  stepN = 0;

  constructor(kind: SessionKind, { track, seed = 7, player = "Daniel", minutes, sequence }: { track?: string; seed?: number; player?: string; minutes?: number; sequence?: SessionKind[] } = {}) {
    this.kind = kind; this.sequence = sequence ?? [kind];
    this.seed = seed; this.minutes = minutes;
    const st = track ? SIM_TRACKS[track] : undefined;
    const [id, name, metres, lapMs, lpl] = st ?? [DEMO.id, DEMO.name, DEMO.metres, DEMO.lapMs, DEMO.lpl];
    this.trackId = id; this.name = name; this.lpl = lpl;
    this.circuit = new Circuit(st ? trackLoop(id, metres) : scaleLoop(DEMO_LOOP, metres), metres, lapMs);
    this.specs = roster(rng(seed), player);
    this.start();
  }

  get player(): SimCar { return this.cars[PLAYER - 1]!; }
  get playerId(): number { return PLAYER; }
  get road(): number { return 29 + 2 * Math.sin(this.t / 600000) - 9 * this.wet; }
  get timeLeft(): number { return Math.max(0, this.durMs - this.t); }
  /** ACC's RaceSessionPhase: 4 pre-session, 5 green, 6 over, 7 post, 8 results. */
  get phase(): number {
    if (this.t < 0) return 4;
    if (this.overAt === null) return 5;
    if (this.doneAt === null) return 6;
    return this.t < this.doneAt + HOLD_RESULTS_MS / 4 ? 7 : 8;
  }

  /** A fresh session: the grid (or the garages), the fuel and the plan of every car. */
  private start(): void {
    const lm = this.circuit.lapMs;
    const rnd = (this.rnd = rng(this.seed + this.idx * 7919));
    this.durMs = this.minutes ? this.minutes * 60000 : this.kind === "race" ? 3600000 : this.kind === "practice" ? 30 * 60000 : Math.min(25 * 60000, Math.max(12 * 60000, Math.round((lm * 4.2) / 60000) * 60000));
    this.pitOpen = this.kind === "race" ? Math.round(this.durMs / 3) : 0;
    this.pitClose = this.kind === "race" ? Math.round((2 * this.durMs) / 3) : 0;
    this.t = this.kind === "race" ? -20000 : -6000;
    this.evo = 0; this.laps = 0; this.best = null; this.yellow = [-1e12, -1e12, -1e12]; this.lastRelease = -1e9; this.finished = 0;
    this.leaderDone = false; this.overAt = this.doneAt = null; this.fcyOn = false; this.rain = this.wet = 0;
    this.shower = rnd.random() < 0.45 ? { start: this.durMs * rnd.uniform(0.12, 0.6), up: rnd.uniform(120000, 240000), hold: rnd.uniform(300000, 840000), down: rnd.uniform(240000, 420000), peak: rnd.uniform(0.3, 0.9) } : null; this.events = []; this.rankedAt = -1;
    this.cars = this.specs.map((s) => new SimCar(s, this.circuit, rnd, this.lpl));
    const grid = this.cars.map((c) => [c, c.spec.delta + rnd.normal(0, 0.004)] as const).sort((a, b) => a[1] - b[1]).map(([c]) => c);
    const carry = this.kind === "race" ? this.carry : null;
    if (carry) grid.sort((a, b) => carry.indexOf(a.id) - carry.indexOf(b.id)); // the race starts in qualifying's order
    this.carry = null;
    this.cars.forEach((c) => { c.boxLp = -130 + 12.5 * (c.id - 1); });
    if (this.kind === "race") {
      grid.forEach((c, k) => {
        c.d = -(10 + GRID_GAP * k); c.lat = k % 2 ? 2.4 : -2.4;
        c.launch = rnd.uniform(150, 650); c.tyreSet = 3;
        setupRace(this, c);
      });
    } else {
      grid.forEach((c, k) => {
        c.st = "garage"; c.inLane = true; c.d = c.boxLp; c.lat = -21; c.tyreSet = 3;
        setupQuali(this, c, k);
      });
    }
  }

  /** Brings the session to the wall clock's now (seconds); the steps are fixed, so what happens does not depend on how often this is called. */
  sync(nowSec: number): void {
    this.origin ??= nowSec;
    const want = Math.floor((nowSec - this.origin) / STEP_S + 1e-6);
    if (want - this.done > 7200) this.done = want - 7200;
    while (this.done < want) { this.done++; this.step(); }
  }

  /** Rain intensity at session time t: a shower that builds, holds and fades. */
  rainAt(t: number): number {
    const s = this.shower;
    if (!s || t < s.start) return 0;
    const x = t - s.start, wobble = 0.93 + 0.07 * Math.sin(t / 70000);
    if (x < s.up) return s.peak * (x / s.up) * wobble;
    if (x < s.up + s.hold) return s.peak * wobble;
    if (x < s.up + s.hold + s.down) return s.peak * (1 - (x - s.up - s.hold) / s.down) * wobble;
    return 0;
  }

  /** A wreck on the track: the field slows down behind it, and the teams use the time to make their stops. */
  startFcy(clearedInMs: number): void {
    if (this.fcyOn || this.kind !== "race" || this.overAt !== null) return;
    this.fcyOn = true; this.fcyUntil = this.t + clearedInMs + this.rnd.uniform(40000, 80000);
    this.say(3, null, "Full course yellow");
    for (const c of this.cars) {
      const slot = this.durMs / (c.stopTimes.length + 1);
      if (c.st === "race" && !c.inLane && this.t >= this.pitOpen && c.stopTimes.length && c.stopTimes[0]! - this.t < 0.4 * slot) c.wantStop = c.wantPit = true;
    }
  }

  step(): void {
    this.t += STEP_MS; this.stepN++;
    this.rain = this.rainAt(this.t);
    this.wet = Math.max(0, this.wet + (this.rain > this.wet ? (this.rain - this.wet) / 150000 : -(this.wet - this.rain) / 540000) * STEP_MS);
    if (this.fcyOn && this.t >= this.fcyUntil) {
      this.fcyOn = false;
      this.say(3, null, "Green flag, full course yellow over");
      for (const c of this.cars) c.passCool = 3;
    }
    for (const c of this.cars) stepCar(this, c, STEP_S);
    if (this.t < 0) return;
    if (this.overAt === null && (this.kind !== "race" ? this.t >= this.durMs : this.leaderDone)) {
      this.overAt = this.t;
      this.say(3, null, this.kind === "race" ? "Chequered flag" : "Session over");
    }
    if (this.overAt !== null && this.doneAt === null) {
      const parked = this.cars.every((c) => c.st === "retired" || (c.finishT !== null && c.st === "garage"));
      if (parked || this.t - this.overAt > Math.max(240000, this.circuit.lapMs * 1.3)) this.doneAt = this.t;
    }
    if (this.doneAt !== null && this.t > this.doneAt + HOLD_RESULTS_MS) {
      if (this.kind === "quali") this.carry = this.rank().map((c) => c.id);
      this.idx++; this.kind = this.sequence[this.idx % this.sequence.length]!; this.start();
    }
  }

  say(type: number, c: SimCar | null, msg: string): void {
    this.events.push({ type, msg: msg || (type === 4 && c ? "Accident" : ""), car: c ? c.id : -1, t: this.t });
    if (this.events.length > 60) this.events.shift();
  }

  lapDone(c: SimCar, lap: Lap): void {
    this.laps++;
    this.evo = 0.005 * (1 - Math.exp(-this.laps / 200));
    if (lap.valid && !lap.out && !lap.in && lap.ms !== null && (!this.best || lap.ms < this.best.ms)) {
      this.best = { ms: lap.ms, car: c.id, s: lap.s };
      this.say(6, c, "");
    }
  }

  /** Whether the car's lap that is just ending is its last: the clock has run out (qualifying), or the leader has taken the flag (race). */
  ending(c: SimCar): boolean {
    if (this.kind !== "race") return this.t >= this.durMs;
    if (this.leaderDone) return true;
    if (this.t >= this.durMs && this.rank().find((x) => x.st === "race" || x.st === "stopped") === c) { this.leaderDone = true; return true; }
    return false;
  }

  /** Classification: by distance in a race, by best lap in qualifying. */
  rank(): SimCar[] {
    if (this.rankedAt === this.stepN) return this.ranked;
    this.rankedAt = this.stepN;
    const cmp = this.kind === "race"
      ? (a: SimCar, b: SimCar) => b.dist - a.dist || (a.finishT ?? 1e12) + a.timePen - ((b.finishT ?? 1e12) + b.timePen) || a.id - b.id
      : (a: SimCar, b: SimCar) => (a.best?.ms ?? 1e12) - (b.best?.ms ?? 1e12) || b.dist - a.dist || a.id - b.id;
    return (this.ranked = [...this.cars].sort(cmp));
  }

  /** Milliseconds a car is behind the one ahead on the road (its own pace), or null for the leader. */
  gapTo(c: SimCar, other: SimCar | undefined): number | null {
    if (!other) return null;
    return Math.round((Math.abs(other.d - c.d) / Math.max(c.v, 25)) * 1000);
  }
}
