// The simulated ACC session behind --simulate-acc, as the shared-memory pages show it to the driver's car.
import type { FakeMfd } from "../pit/fake-mfd.js";
import { clamp, mod, Rec } from "../util.js";
import { gearAt, rpmAt, TANK } from "../sim/car.js";
import type { Field } from "../sim/roster.js";
import { rainLevel, World } from "../sim/world.js";

const MAX_RPM = 8000;

export class FakePages {
  readonly world: World;
  readonly clock: () => number;

  /** session: ACC's kind, 2 race, 1 qualifying, 0 practice. clock is in seconds. */
  constructor({ clock = () => performance.now() / 1000, session = 2, track, mfd, minutes, weekend, seed, field }: { clock?: () => number; session?: number; track?: string; mfd?: FakeMfd; minutes?: number; weekend?: boolean; seed?: number; field?: Field } = {}) {
    this.clock = clock;
    this.world = new World(weekend || session === 0 ? "practice" : session === 1 ? "quali" : "race", { track, minutes, seed, field, sequence: weekend ? ["practice", "quali", "race"] : undefined });
    this.world.sync(clock());
    if (mfd) this.mfd = mfd;
  }

  private mfd: FakeMfd | null = null;
  private mfdBase: { fuel: number; set: number; wet: boolean } | null = null;

  /** The stop the driver makes takes the fuel and tyre set typed into the pit page, once they differ from what it showed. */
  private wire(mfd: FakeMfd): void {
    this.mfdBase = { fuel: mfd.fuel, set: mfd.set, wet: mfd.s.wet };
    this.world.customize = (box, c) => {
      const s = mfd.read(), base = this.mfdBase!;
      if (s.fuel !== base.fuel) box.add = clamp(s.fuel, 0, TANK - c.fuel);
      if (s.tyre_set !== base.set) box.tyres = true;
      if (mfd.s.wet !== base.wet) { box.wet = mfd.s.wet; box.tyres = true; }
      this.mfdBase = { fuel: s.fuel, set: s.tyre_set, wet: mfd.s.wet };
    };
  }

  get name(): string { return this.world.name; }
  get track(): string { return this.world.trackId; }
  get trackLen(): number { return this.world.circuit.len; }

  read(): Rec {
    const w = this.world;
    if (this.mfd && !this.mfdBase) this.wire(this.mfd);
    w.sync(this.clock());
    const c = w.player, circ = w.circuit, t = w.t;
    if (this.mfd) this.mfd.current = c.tyreSet;
    const rank = w.rank();
    const kmh = c.v * 3.6;
    const parked = c.inLane && (c.st === "garage" || c.box !== null);
    const [ahead, behind] = neighbours(w, c);
    const curv = circ.curvature(c.d);
    const [x, z] = circ.pos(c.d, c.lat);
    const coords: Record<number, number[]> = {};
    for (const o of w.cars) coords[o.id] = circ.pos(o.d, o.lat);
    const cur = c.lapStart === null ? 0 : Math.max(0, Math.trunc(t - c.lapStart));
    const bestMs = c.best?.ms ?? null;
    const yellow = w.yellow.map((u) => +(u > t || w.fcyOn));
    const chequered = c.finishT !== null;
    const blue = w.kind === "race" && w.cars.some((o) => o !== c && o.running && o.laps > c.laps && !o.inLane && mod(c.d - o.d, circ.len) < 80);
    const green = t >= 0 && t < 6000 && w.kind === "race";
    const flag = chequered ? 5 : yellow[c.sector] ? 2 : blue ? 1 : green ? 7 : 0;
    const fuelLaps = c.fuel / c.lpl;
    return {
      coords, status: 2, session: w.kind === "race" ? 2 : w.kind === "quali" ? 1 : 0, gas: c.gas, brake: c.brake, fuel: c.fuel,
      gear: parked && c.v < 0.5 ? 1 : 2 + gearAt(kmh), rpm: rpmAt(kmh), steer: c.st === "stopped" ? 0 : clamp(curv * 25, -1, 1), speed: kmh,
      acc_g: [c.ay / 9.81 + shake(t, 0, c.v) * 0.8, 1 + shake(t, 2, c.v) * 0.6, c.a / 9.81 + shake(t, 1, c.v) * 0.5 * (1 + 2 * c.brake)],
      pressure: c.pressures(), core_temp: [...c.tyreT], damage: [...c.damage], tyres_out: c.st === "stopped" ? 2 : 0, limiter: +c.inLane,
      air: 22 + 0.6 * Math.sin(t / 900000) - 3 * w.rain, road: w.road, brake_temp: [...c.brakeT], clutch: c.v < 6 && c.gas > 0.5 ? 0.6 : 0, bias: 0.565,
      tc_on: +(c.a > 5 && c.v < 40), abs_on: +(c.brake > 0.9 && c.v > 30),
      susp_damage: [...c.suspDamage], water: c.water, brake_press: [c.brake * 80, c.brake * 80, c.brake * 55, c.brake * 55],
      front_pad_compound: 0, rear_pad_compound: 0, pad: [...c.pad], disc: [c.disc, c.disc, c.disc, c.disc],
      laps: c.laps, position: rank.indexOf(c) + 1, cur_ms: cur, last_ms: c.last?.ms ?? 0, best_ms: bestMs ?? 2147483647,
      time_left: Math.max(0, w.durMs - Math.max(0, t)), in_box: +parked, sector: c.sector, last_sector_ms: Math.round(c.lastSector),
      compound: c.wetTyres ? "wet_compound" : "dry_compound", track_pos: c.spl, xyz: [x, 0, z], me: w.playerId, penalty_time: c.timePen / 1000, flag, penalty: c.penalty ? c.penalty.id : c.timePen ? 14 : 0,
      pit_lane: +c.inLane, mandatory_done: +(w.kind === "race" && c.mandatoryDone), wind: 2.3, wind_dir: 3.73,
      tc: 3, tc_cut: 2, map: 0, abs: 2, fuel_per_lap: c.lpl, rain_lights: +(w.rain > 0.1), lights_stage: t < 0 && t >= -5000 ? 5 - Math.floor(-t / 1000) : 0,
      exhaust: c.exhaust, wiper: w.rain > 0.5 ? 2 : w.rain > 0.15 ? 1 : 0, stint_total_left: Math.trunc(Math.max(0, w.durMs - Math.max(0, t))),
      stint_left: Math.trunc(Math.max(0, w.durMs - Math.max(0, t))), rain_tyres: +c.wetTyres, session_index: w.idx,
      used_fuel: c.used, delta_ms: bestMs && c.lapStart !== null ? Math.trunc(cur - (bestMs * circ.timeAt(c.p)) / circ.lapMs) : 0,
      est_lap_ms: bestMs ?? Math.round(c.lapSec * 1000), valid: +c.valid, fuel_laps: fuelLaps, track_status: "",
      missing_pits: w.kind === "race" ? +!c.mandatoryDone : 255, clock: 14 * 3600 + t / 1000,
      g_flags: [+yellow.some(Boolean), yellow[0], yellow[1], yellow[2], 0, +green, +chequered, 0], grip: w.wet < 0.05 ? 2 : w.wet < 0.2 ? 4 : w.wet < 0.55 ? 5 : 6, rain: [rainLevel(w.rain), rainLevel(w.rainAt(t + 600000)), rainLevel(w.rainAt(t + 1800000))], tyre_set: c.tyreSet,
      gap_ahead: ahead, gap_behind: behind,
      car: "ferrari_296_gt3", track: w.trackId, name: c.spec.first, sectors: 3, max_rpm: MAX_RPM, max_fuel: TANK,
      fuel_rate: 1.0, tyre_rate: 1.0, track_len: circ.len, timed: 1, extra_lap: 0,
      pit_open: Math.trunc(w.pitOpen), pit_close: Math.trunc(w.pitClose), online: 0,
    };
  }
}

/** Kerbs, bumps and engine vibration: a little noise that grows with speed. */
function shake(t: number, seed: number, v: number): number {
  const s = t / 1000;
  return (0.035 * Math.sin(s * 53 + seed) + 0.025 * Math.sin(s * 131 + seed * 2.1) + 0.015 * Math.sin(s * 307 + seed * 3.7)) * Math.min(1, v / 40);
}

/** Milliseconds to the nearest car ahead and behind on the track (the lane is another road). */
function neighbours(w: World, c: { d: number; v: number; inLane: boolean; id: number }): [number, number] {
  const len = w.circuit.len;
  let ahead = len, behind = len;
  for (const o of w.cars) {
    if (o.id === c.id || o.inLane !== c.inLane || o.st === "garage" || o.st === "retired") continue;
    const r = mod(o.d - c.d, len);
    ahead = Math.min(ahead, r);
    behind = Math.min(behind, len - r);
  }
  const ms = (m: number) => Math.trunc((m / Math.max(c.v, 25)) * 1000);
  return [ms(ahead), ms(behind)];
}
