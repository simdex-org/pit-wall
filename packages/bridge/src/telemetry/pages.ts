// ACC's three shared-memory pages (physics, graphics, static) as one raw reading.
// Offsets follow Kunos' ACC Shared Memory Documentation 1.8.12.
import { openShared } from "../win/shm.js";
import { Rec } from "../util.js";

const SIZES = { physics: 800, graphics: 1588, static: 688 } as const;

const f = (b: Buffer, o: number): number => b.readFloatLE(o);
const fs = (b: Buffer, o: number, n: number): number[] => Array.from({ length: n }, (_, k) => b.readFloatLE(o + 4 * k));
const i = (b: Buffer, o: number): number => b.readInt32LE(o);
const is = (b: Buffer, o: number, n: number): number[] => Array.from({ length: n }, (_, k) => b.readInt32LE(o + 4 * k));
const w = (b: Buffer, o: number, n = 33): string => b.subarray(o, o + 2 * n).toString("utf16le").split("\0", 1)[0]!;

export interface Pages { read(): Rec }

export class AccPages implements Pages {
  private m: Record<keyof typeof SIZES, () => Buffer>;

  constructor() {
    this.m = Object.fromEntries(Object.entries(SIZES).map(([k, n]) => [k, openShared("Local\\acpmf_" + k, n)])) as typeof this.m;
  }

  read(): Rec {
    const p = this.m.physics(), g = this.m.graphics(), s = this.m.static();
    const ids = is(g, 976, 60), me = i(g, 1216);
    const car = Math.max(0, ids.indexOf(me));
    const xyz = fs(g, 256, 3 * 60); // every active car's world position, the same frame as your own: where the cars really are, off track or not
    const coords: Record<number, number[]> = {};
    for (let k = 0; k < Math.min(i(g, 252), 60); k++) {
      if (xyz[3 * k] || xyz[3 * k + 2]) coords[ids[k]!] = [xyz[3 * k]!, xyz[3 * k + 2]!];
    }
    return {
      coords,
      status: i(g, 4), session: i(g, 8),
      gas: f(p, 4), brake: f(p, 8), fuel: f(p, 12), gear: i(p, 16), rpm: i(p, 20), steer: f(p, 24),
      speed: f(p, 28), acc_g: fs(p, 44, 3), pressure: fs(p, 88, 4), core_temp: fs(p, 152, 4),
      damage: fs(p, 224, 5), tyres_out: i(p, 244), limiter: i(p, 248), air: f(p, 288), road: f(p, 292),
      brake_temp: fs(p, 348, 4), clutch: f(p, 364), bias: f(p, 564), tc_on: i(p, 672), abs_on: i(p, 676),
      susp_damage: fs(p, 680, 4), water: f(p, 712), brake_press: fs(p, 716, 4),
      front_pad_compound: i(p, 732), rear_pad_compound: i(p, 736), pad: fs(p, 740, 4), disc: fs(p, 756, 4),
      laps: i(g, 132), position: i(g, 136), cur_ms: i(g, 140), last_ms: i(g, 144), best_ms: i(g, 148),
      time_left: f(g, 152), in_box: i(g, 160), sector: i(g, 164), last_sector_ms: i(g, 168), compound: w(g, 176), track_pos: f(g, 248),
      xyz: fs(g, 256 + 12 * car, 3), me, penalty_time: f(g, 1220), flag: i(g, 1224), penalty: i(g, 1228),
      pit_lane: i(g, 1236), mandatory_done: i(g, 1244), wind: f(g, 1248), wind_dir: f(g, 1252),
      tc: i(g, 1268), tc_cut: i(g, 1272), map: i(g, 1276), abs: i(g, 1280), fuel_per_lap: f(g, 1284),
      rain_lights: i(g, 1288), lights_stage: i(g, 1296), exhaust: f(g, 1300), wiper: i(g, 1304),
      stint_total_left: i(g, 1308), stint_left: i(g, 1312), rain_tyres: i(g, 1316), session_index: i(g, 1320),
      used_fuel: f(g, 1324), delta_ms: i(g, 1360), est_lap_ms: i(g, 1396), valid: i(g, 1408), fuel_laps: f(g, 1412),
      track_status: w(g, 1416), missing_pits: i(g, 1484), clock: f(g, 1488), g_flags: is(g, 1500, 8),
      grip: i(g, 1556), rain: is(g, 1560, 3), tyre_set: i(g, 1572), gap_ahead: i(g, 1580), gap_behind: i(g, 1584),
      car: w(s, 68), track: w(s, 134), name: `${w(s, 200)} ${w(s, 266)}`.trim(),
      sectors: i(s, 400), max_rpm: i(s, 412), max_fuel: f(s, 416), fuel_rate: f(s, 468), tyre_rate: f(s, 472),
      track_len: f(s, 520), timed: i(s, 596), extra_lap: i(s, 600), pit_open: i(s, 676), pit_close: i(s, 680),
      online: i(s, 684),
    };
  }
}

/** The fields not yet checked in a real session, raw, once a second: compare them with what the game shows. */
export async function probe(): Promise<never> {
  const pages = new AccPages();
  for (;;) {
    const r = pages.read();
    console.log(`pit_open=${r.pit_open} pit_close=${r.pit_close} missing_pits=${r.missing_pits} track_len=${r.track_len.toFixed(1)} timed=${r.timed} ` +
      `sector=${r.sector} last_sector_ms=${r.last_sector_ms} cur_ms=${r.cur_ms}   (session ${r.session}, lap ${r.laps + 1})`);
    await new Promise((res) => setTimeout(res, 1000));
  }
}
