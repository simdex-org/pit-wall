// One car of the simulation: where it is, how fast, and everything that decides its pace (fuel, tyres, mistakes).
import { clamp, mod } from "../util.js";
import { Circuit } from "./circuit.js";
import { Rng } from "./rng.js";
import { Spec } from "./roster.js";

export interface Lap { ms: number | null; s: (number | null)[]; valid: boolean; out: boolean; in: boolean }
export type State = "grid" | "garage" | "race" | "stopped" | "limp" | "retired" | "finished";
export type LapKind = "race" | "out" | "push" | "in";
export interface Box { t0: number; end: number; fuel0: number; add: number; fuelEnd: number; tyres: boolean; wet: boolean; park: boolean; repair: boolean }

export const TANK = 120;
export const CAR_LEN = 4.8;
const AMBIENT_C = 22;

/** How much pace a lap has for what the driver is doing. */
const KIND_Q: Record<LapKind, number> = { race: 1, out: 0.88, push: 1.012, in: 0.86 };

const GEAR_MAX_KMH = [75, 105, 140, 175, 215, 300];

/** The gear a GT3 is in at this speed, 0 for first. */
export const gearAt = (kmh: number): number => { const g = GEAR_MAX_KMH.findIndex((m) => kmh <= m); return g < 0 ? 5 : g; };
/** Engine speed in that gear. */
export const rpmAt = (kmh: number): number => Math.trunc(clamp((7900 * kmh) / GEAR_MAX_KMH[gearAt(kmh)]!, 1100, 7900));

export class SimCar {
  // motion: d is metres from the line, continuous over laps, negative on the grid and in front of the line in the lane
  d = 0; v = 0; a = 0; lat = 0; gas = 0; brake = 0; ay = 0;
  st: State = "grid";
  inLane = false; stopHere = false; wantPit = false; wantStop = false; servingPen = false; boxLp = 0; box: Box | null = null;
  // laps
  laps = 0; lapStart: number | null = null; splits: number[] = []; secIdx = 0; valid = true; out = false; kind: LapKind = "race";
  last: Lap | null = null; best: Lap | null = null; lastSector = 0;
  finishT: number | null = null; finishRank = 0;
  // pits and plan
  pits = 0; stopTimes: number[] = []; releaseAt = 0; mandatoryDone = false;
  runLap = 0; pushes = 1; runsLeft = 0;
  // pace
  wrecked = false; slot = 0; giveWay = false;
  wetTyres = false; cuts = 0; timePen = 0; penalty: { id: number; due: number } | null = null;
  fuel = 0; used = 0; tyreDist = 0; tyreSet = 3; tyreLife: number; qSec: number[] = [1, 1, 1];
  slipAt: number | null = null; slipUntil = 0; troubleAt: number | null = null; troubleKind = ""; until = 0;
  launch = 0; heldFor = 0; passCool = 0; pass: { id: number; side: number; until: number } | null = null;
  damage = [0, 0, 0, 0, 0]; suspDamage = [0, 0, 0, 0];
  // the instruments only the driver's car needs
  tyreT = [58, 58, 58, 58]; brakeT = [180, 180, 150, 150]; pad = [24.1, 24.0, 25.2, 25.3]; disc = 31.8; water = 90; exhaust = 450;

  constructor(readonly spec: Spec, readonly circuit: Circuit, readonly rnd: Rng, readonly lpl: number) {
    this.tyreLife = rnd.uniform(190000, 260000) / circuit.len;
    this.lpl = lpl * (1 + spec.delta * 0.6) * rnd.uniform(0.97, 1.03);
  }

  get id(): number { return this.spec.id; }
  get lapSec(): number { return (this.circuit.lapMs * (1 + this.spec.delta)) / 1000; }
  /** Metres from the line, 0 to a lap. */
  get p(): number { return mod(this.d, this.circuit.len); }
  /** Metres from the line, negative before it: where the pit lane runs. */
  get lane(): number { const p = this.p; return p > this.circuit.len / 2 ? p - this.circuit.len : p; }
  /** Lap fraction as ACC reports it: a finished car's stays on the line. */
  get spl(): number { return this.finishT !== null ? 0 : this.p / this.circuit.len; }
  get sector(): number { return Math.min(2, Math.floor(this.p / (this.circuit.len / 3))); }
  /** How much of the set's life is gone, 0 to 1 and beyond. */
  get wear(): number { return this.tyreDist / this.circuit.len / this.tyreLife; }
  get damageSum(): number { return this.damage.reduce((a, b) => a + b, 0); }
  /** Distance for ordering: laps run, a finished car's count frozen where the flag found it. */
  get dist(): number { return this.finishT !== null ? this.laps : this.d / this.circuit.len; }
  get running(): boolean { return this.st === "race" || this.st === "limp" || this.st === "stopped" || this.st === "finished"; }

  /** What a lap loses (+) or gains (-) against the reference tyres and fuel, as a fraction of the lap. */
  private loss(): number {
    const a = this.tyreDist / this.circuit.len, k = a / this.tyreLife;
    const tyre = 0.012 * Math.exp(-a / 0.9) + 0.009 * k + 0.04 * Math.max(0, k - 0.85) ** 2; // cold at first, then wearing, then the cliff
    return tyre + (0.026 * (this.fuel - 40)) / this.lapSec + this.damageSum * 0.0003;
  }

  /** The speed multiplier on the ideal profile right now. evo is the track's gain over the session. */
  pace(t: number, evo: number, wet = 0): number {
    const slip = t < this.slipUntil ? 0.82 : 1;
    const q = this.st === "limp" ? 0.55 : this.st === "finished" ? 0.6 : KIND_Q[this.kind];
    // slicks on a wet track lose a lot; wets on a dry one lose some, and wear fast
    const water = this.wetTyres ? 0.09 * (1 - wet) ** 1.5 : 0.16 * wet + 0.25 * Math.max(0, wet - 0.5);
    return (slip * q * this.qSec[this.sector]! * (1 + evo)) / ((1 + this.spec.delta) * (1 + this.loss() + water));
  }

  /** Fresh sector form and this lap's mistakes. */
  newLap(wet = 0): void {
    const sd = this.spec.sd / Math.SQRT2;
    this.qSec = [1, 1, 1].map(() => 1 + this.rnd.normal(0, sd));
    const len = this.circuit.len;
    const risk = 1 + 4 * wet * (this.wetTyres ? 0.3 : 1);
    this.slipAt = this.rnd.random() < this.spec.slip * risk * (this.kind === "push" ? 2.5 : 1) ? this.rnd.uniform(0, len) : null;
    this.troubleAt = this.rnd.random() < this.spec.trouble * risk ? this.rnd.uniform(0, len) : null;
    this.troubleKind = this.rnd.random() < 0.7 ? "spin" : "break";
  }

  /** Brakes, tyres, water and exhaust for the car the engineer watches. */
  thermal(dt: number, road: number): void {
    const speed = this.v, ay = this.ay;
    const side = Math.sign(ay) * Math.min(1, Math.abs(ay) / 12);
    const share = [1.1 * (1 + 0.3 * side), 1.1 * (1 - 0.3 * side), 0.9 * (1 + 0.3 * side), 0.9 * (1 - 0.3 * side)];
    for (let i = 0; i < 4; i++) {
      const target = road + 30 + 30 * (Math.abs(ay) / 16.7) * share[i]! + (i < 2 ? 14 * this.brake : 0) + (i > 1 ? 6 * this.gas : 0);
      this.tyreT[i]! += ((target - this.tyreT[i]!) * dt) / 22;
      const heat = 2.2 * this.brake * speed * (i < 2 ? 0.62 : 0.38) * 2;
      this.brakeT[i]! += (heat - (this.brakeT[i]! - AMBIENT_C) * (0.012 + 0.0009 * speed)) * dt;
      this.pad[i]! -= this.brake * speed * dt * (i < 2 ? 1.7e-4 : 1.0e-4);
    }
    this.disc -= this.brake * speed * dt * 4e-6;
    this.water += ((92 + 7 * this.gas - 5 * Math.min(1, speed / 60) - this.water) * dt) / 25;
    this.exhaust += ((380 + 420 * this.gas - this.exhaust) * dt) / 3;
  }

  /** Hot pressures follow the core temperature from the pressures the set was fitted at. */
  pressures(): number[] {
    const cold = this.wetTyres ? [29.0, 29.1, 28.8, 28.8] : [24.6, 24.7, 24.3, 24.3];
    return cold.map((cold, i) => cold * ((this.tyreT[i]! + 273.15) / 331.15));
  }

  freshTyres(wet = false): void {
    this.wetTyres = wet; this.tyreDist = 0; this.tyreSet++; this.tyreT = [55, 55, 55, 55];
    this.tyreLife = this.rnd.uniform(190000, 260000) / this.circuit.len;
  }

  burn(ds: number, wet = 0): void {
    const per = (this.lpl / this.circuit.len) * ds * (0.9 + 0.2 * this.gas);
    this.fuel = Math.max(0, this.fuel - per); this.used += per;
    if (this.fuel === 0 && this.st === "race") { this.st = "limp"; this.wantPit = this.wantStop = true; } // dry: crawls to the box
    this.tyreDist += ds * (this.wetTyres ? 1 + 2.5 * (1 - wet) ** 2 : 1);
  }
}


