import { Rec } from "../util.js";

// Le Mans Ultimate's own shared memory, "LMU_Data", laid out by SharedMemoryInterface.hpp and InternalsPlugin.hpp in the
// game's Support\SharedMemoryInterface folder (structs inside InternalsPlugin are packed to 4 bytes, the wrappers are not).
// Offsets below are bytes into SharedMemoryObjectOut. Nothing here opens the mapping, so it runs on any OS.
export const LMU_SIZE = 324824;
const SCORING = 1632, VEHICLES = 2192, VEH = 584, MAX_CARS = 104;
const TELEMETRY = 128464, TEL0 = 128468, TEL = 1888, WHEEL0 = 848, WHEEL = 260;

const d = (b: Buffer, o: number): number => b.readDoubleLE(o);
const ds = (b: Buffer, o: number, n: number): number[] => Array.from({ length: n }, (_, k) => b.readDoubleLE(o + 8 * k));
const str = (b: Buffer, o: number, n: number): string => b.subarray(o, o + n).toString("utf8").split("\0", 1)[0]!.trim();
const ms = (s: number): number => (s > 0 ? Math.round(s * 1000) : 0);
const kelvin = (k: number): number => (k > 0 ? k - 273.15 : 0);

const SESSION = (s: number): number => (s >= 10 ? 2 : s >= 5 && s <= 8 ? 1 : 0);
// the game counts sectors 0 = third, 1 = first, 2 = second
const SECTOR = [2, 0, 1];

export interface LmuCar { i: number; name: string; car: string; cls: string; label: string; pos: number; laps: number; spl: number; best: number; last: number; cur: number; inv: boolean; gear: number; x: number; z: number; pit: boolean; kmh: number }

function vehicle(b: Buffer, k: number, len: number): LmuCar {
  const o = VEHICLES + VEH * k;
  const vel = ds(b, o + 288, 3);
  return {
    i: b.readInt32LE(o), name: str(b, o + 4, 32), car: str(b, o + 36, 64), cls: str(b, o + 200, 32), label: str(b, o + 36, 64),
    pos: b[o + 199]!, laps: b.readInt16LE(o + 100), spl: len > 0 ? Math.min(1, Math.max(0, d(b, o + 104) / len)) : 0,
    best: ms(d(b, o + 144)), last: ms(d(b, o + 168)), cur: ms(d(b, o + 464)), inv: b[o + 506] !== 2,
    gear: 1, x: d(b, o + 264), z: d(b, o + 280), pit: b[o + 198] !== 0, kmh: Math.hypot(...vel) * 3.6,
  };
}

// 8 dents around the car (0 front, then clockwise from front-left: 1 FL, 2 L, 3 RL, 4 rear, 5 RR, 6 R, 7 FR) into ACC's
// five zones (front, rear, left, right, centre); 2, the worst dent, is ACC's 100
function zones(dent: number[]): number[] {
  const z = (...k: number[]) => Math.max(...k.map((i) => dent[i]!)) * 50;
  return [z(0, 1, 7), z(3, 4, 5), z(1, 2, 3), z(5, 6, 7), 0];
}

export function decodeLmu(b: Buffer): Rec {
  const s = SCORING, len = d(b, s + 88);
  const n = Math.min(Math.max(0, b.readInt32LE(s + 104)), MAX_CARS);
  const cars = Array.from({ length: n }, (_, k) => vehicle(b, k, len));
  const mine = Math.max(0, Array.from({ length: n }, (_, k) => b[VEHICLES + VEH * k + 196]).indexOf(1));
  const v = VEHICLES + VEH * mine;
  const t = TEL0 + TEL * Math.min(b[TELEMETRY + 1]!, MAX_CARS - 1);
  const wheel = (k: number) => t + WHEEL0 + WHEEL * k;
  const w4 = (f: (o: number) => number) => [0, 1, 2, 3].map((k) => f(wheel(k)));
  const live = b[TELEMETRY + 2] && b[s + 115];
  const phase = b[s + 108]!, yellows = [0, 1, 2].map((k) => (b.readInt8(s + 110 + k) > 0 ? 1 : 0));
  const vel = ds(b, t + 184, 3), acc = ds(b, t + 208, 3), wind = ds(b, s + 244, 3);
  const sector = SECTOR[b.readInt8(v + 102)] ?? 0;
  const [cur1, cur2, last2, lastLap] = [d(b, v + 176), d(b, v + 184), d(b, v + 160), d(b, v + 168)];
  const lastSector = sector === 1 ? cur1 : sector === 2 ? cur2 - cur1 : lastLap > 0 && last2 > 0 ? lastLap - last2 : 0;
  const types = w4((o) => b[o + 241]!);
  const wet = d(b, s + 332), grip = b[s + 349]!;
  const chequered = phase === 8, penalties = b.readInt16LE(v + 194);
  const flag = chequered ? 5 : b[v + 504] === 6 ? 1 : penalties > 0 ? 6 : phase === 6 || yellows.some(Boolean) ? 2 : 0;
  const end = d(b, s + 76), now = d(b, s + 68);
  const rain = Math.round(Math.min(1, Math.max(0, d(b, s + 220))) * 5);
  return {
    game: "lmu", cars,
    coords: Object.fromEntries(cars.map((c) => [c.i, [c.x, c.z]])),
    status: live ? (phase === 9 ? 3 : 2) : 0, session: SESSION(b.readInt32LE(s + 64)), session_index: 0,
    gas: d(b, t + 420), brake: d(b, t + 428), clutch: d(b, t + 444), steer: d(b, t + 436),
    fuel: d(b, t + 524), gear: b.readInt32LE(t + 352) + 1, rpm: Math.round(d(b, t + 356)),
    speed: Math.hypot(...vel) * 3.6, acc_g: [acc[0]! / 9.81, acc[1]! / 9.81, -acc[2]! / 9.81],
    pressure: w4((o) => d(b, o + 120) / 6.894757), core_temp: w4((o) => kelvin(d(b, o + 204))),
    damage: zones([...b.subarray(t + 544, t + 552)]), tyres_out: w4((o) => b[o + 176]!).filter((x) => x >= 2 && x <= 4).length,
    limiter: b[t + 748], air: d(b, s + 228), road: d(b, s + 236),
    brake_temp: w4((o) => kelvin(d(b, o + 24))), bias: 1 - d(b, t + 664),
    tc_on: b[t + 747], abs_on: b[t + 746],
    laps: cars[mine]?.laps ?? 0, position: b[v + 199], cur_ms: ms(d(b, t + 12) - d(b, t + 24)),
    last_ms: ms(lastLap), best_ms: ms(d(b, v + 144)),
    time_left: end > 0 ? Math.max(0, end - now) * 1000 : 0, in_box: b[v + 457] === 3 ? 1 : 0,
    sector, last_sector_ms: ms(lastSector), compound: str(b, t + 620, 18), track_pos: cars[mine]?.spl ?? 0,
    xyz: ds(b, t + 160, 3), me: b.readInt32LE(v), penalty_time: 0, flag,
    pit_lane: b[v + 198] ? 1 : 0, grip: wet > 0.5 ? 5 : wet > 0.15 ? 4 : Math.min(grip, 2), mandatory_done: 0,
    wind: Math.hypot(wind[0]!, wind[2]!), wind_dir: Math.atan2(wind[0]!, wind[2]!),
    car: str(b, t + 796, 30) || str(b, v + 36, 64), track: str(b, s, 64), name: str(b, v + 4, 32),
    sectors: 3, max_rpm: Math.round(d(b, t + 532)), max_fuel: d(b, t + 608), fuel_rate: 1, tyre_rate: 1,
    track_len: len,
    susp_damage: [0, 0, 0, 0], water: d(b, t + 364), brake_press: w4((o) => d(b, o + 32)), front_pad_compound: 0, rear_pad_compound: 0,
    pad: [0, 0, 0, 0], disc: [0, 0, 0, 0], penalty: 0, tc: b[t + 750], tc_cut: b[t + 754], map: Math.max(0, b[t + 758]! - 1), abs: b[t + 756],
    fuel_per_lap: 0, rain_lights: 0, lights_stage: 0, exhaust: 0, wiper: b[t + 749], stint_total_left: -1, stint_left: -1,
    rain_tyres: types.some((x) => x === 3) ? 1 : 0,
    used_fuel: 0, delta_ms: Math.round(d(b, t + 696) * 1000), est_lap_ms: ms(d(b, v + 472)), valid: b[t + 745] || b[v + 506] !== 2 ? 0 : 1,
    fuel_laps: 0, track_status: "", missing_pits: -1, clock: d(b, s + 344),
    g_flags: [flag === 2 ? 1 : 0, ...yellows, 0, phase === 5 ? 1 : 0, chequered ? 1 : 0, phase === 7 ? 1 : 0], rain: [rain, rain, rain], tyre_set: 0,
    gap_ahead: ms(b.readFloatLE(t + 780)), gap_behind: ms(b.readFloatLE(t + 784)),
    timed: b.readInt32LE(s + 84) > 999999 ? 1 : 0, extra_lap: 0, pit_open: 0, pit_close: 0, online: b[s + 284]! >= 2 ? 1 : 0,
    lmu: {
      et: now, class: cars[mine]?.cls ?? "", energy: b.readFloatLE(t + 776), battery: d(b, t + 704), regen_kw: b.readFloatLE(t + 768),
      motor: b[t + 744], tc_max: b[t + 751], abs_max: b[t + 757], map_max: b[t + 759], migration: b[t + 760], migration_max: b[t + 761],
      compounds: types, front_compound: str(b, t + 620, 18), rear_compound: str(b, t + 638, 18),
      tread: w4((o) => b.readDoubleLE(o + 152)), flat: w4((o) => b[o + 177]!), wheel_off: w4((o) => b[o + 178]!),
      tyre_temp: w4((o) => kelvin(ds(b, o + 128, 3).reduce((a, x) => a + x, 0) / 3)),
      dents: [...b.subarray(t + 544, t + 552)], part_off: b[t + 542], stops: b.readInt16LE(v + 192), penalties,
      wet: [d(b, s + 268), wet, d(b, s + 276)], rain: d(b, s + 220), clouds: b[s + 350], rubber: grip,
    },
  };
}

// Laps' use of virtual energy, from what is left at each line crossing
export class EnergyLaps {
  private lap = -1; private at = -1; private used: number[] = [];

  apply(r: Rec): void {
    const e = r.lmu?.energy;
    if (!(e >= 0) || r.status !== 2) return;
    if (r.laps !== this.lap) {
      if (this.at >= 0 && r.laps === this.lap + 1 && this.at > e)this.used = [...this.used, this.at - e].slice(-5);
      if (r.laps < this.lap) this.used = [];
      this.lap = r.laps; this.at = e;
    }
    const last = this.used.slice(-3);
    r.lmu.per_lap = last.length ? last.reduce((a, x) => a + x, 0) / last.length : null;
    r.lmu.last_lap = this.used.at(-1) ?? null;
  }
}
