import { openShared } from "../win/shm.js";
import { Rec } from "../util.js";
import { withPlugin } from "../broadcast/ac-plugin.js";
import { f, fs, i, Pages, w } from "./pages.js";

const SIZES = { physics: 580, graphics: 1260, static: 592 } as const;

// Assetto Corsa (the first one) shares the first part of ACC's pages but has no MFD, no pad/water/set
// fields and no session index, so those are filled with what "not available" means to the rest of the bridge.
export function decodeAc(p: Buffer, g: Buffer, s: Buffer, index: number): Rec {
  const laps = i(g, 132), total = i(g, 172), pit = i(g, 160), speed = f(p, 28);
  // AC's graphics page has no flags: the white and chequered ones follow from the lap count
  const flag = total > 0 && laps >= total ? 5 : total > 0 && laps === total - 1 ? 4 : 0;
  return {
    coords: {}, game: "ac",
    status: i(g, 4), session: i(g, 8), session_index: index,
    gas: f(p, 4), brake: f(p, 8), fuel: f(p, 12), gear: i(p, 16), rpm: i(p, 20), steer: f(p, 24),
    speed, acc_g: fs(p, 44, 3), pressure: fs(p, 88, 4), core_temp: fs(p, 152, 4),
    damage: fs(p, 224, 5), tyres_out: i(p, 244), limiter: i(p, 248), air: f(p, 288), road: f(p, 292),
    brake_temp: fs(p, 348, 4), clutch: f(p, 364), bias: f(p, 564),
    tc_on: f(p, 204) > 0 ? 1 : 0, abs_on: f(p, 252) > 0 ? 1 : 0,
    laps, position: i(g, 136), cur_ms: i(g, 140), last_ms: i(g, 144), best_ms: i(g, 148),
    time_left: f(g, 152), in_box: pit && speed < 1 ? 1 : 0, sector: i(g, 164), last_sector_ms: i(g, 168), compound: w(g, 176), track_pos: f(g, 248),
    xyz: fs(g, 252, 3), me: 0, penalty_time: 0, flag,
    pit_lane: pit, grip: 0, mandatory_done: 0, wind: 0, wind_dir: 0,
    car: w(s, 68), track: [w(s, 134), w(s, 524, 33)].filter(Boolean).join(" "), name: `${w(s, 200)} ${w(s, 266)}`.trim(),
    sectors: i(s, 400), max_rpm: i(s, 412), max_fuel: f(s, 416), fuel_rate: f(s, 468), tyre_rate: f(s, 472),
    track_len: f(s, 520),
    susp_damage: [0, 0, 0, 0], water: 0, brake_press: [0, 0, 0, 0], front_pad_compound: 0, rear_pad_compound: 0,
    pad: [0, 0, 0, 0], disc: [0, 0, 0, 0], penalty: 0, tc: 0, tc_cut: 0, map: 0, abs: 0, fuel_per_lap: 0,
    rain_lights: 0, lights_stage: 0, exhaust: 0, wiper: 0, stint_total_left: -1, stint_left: -1, rain_tyres: 0,
    used_fuel: 0, delta_ms: 0, est_lap_ms: 0, valid: 1, fuel_laps: 0, track_status: "", missing_pits: -1, clock: 0,
    g_flags: [0, 0, 0, 0, flag === 4 ? 1 : 0, 0, flag === 5 ? 1 : 0, 0], rain: [0, 0, 0], tyre_set: 0, gap_ahead: 0, gap_behind: 0,
    timed: 0, extra_lap: 0, pit_open: 0, pit_close: 0, online: 0,
  };
}

// Modded tracks often define no sectors, so the bridge cuts the lap into thirds itself.
export class ThirdSectors {
  private lap = -1; private sector = 0; private at = 0; private lastMs = 0;

  apply(r: Rec): void {
    if (r.sectors >= 2) return;
    r.sectors = 3;
    const s = Math.min(2, Math.floor(r.track_pos * 3));
    if (r.laps !== this.lap) { this.lap = r.laps; this.sector = 0; this.at = 0; }
    else if (s > this.sector) { this.lastMs = r.cur_ms - this.at; this.at = r.cur_ms; this.sector = s; }
    r.sector = this.sector; r.last_sector_ms = this.lastMs;
  }
}

export class AcPages implements Pages {
  private m: Record<keyof typeof SIZES, () => Buffer>;
  private index = 0;
  private thirds = new ThirdSectors();
  private last = { session: -2, laps: 0 };

  constructor() {
    this.m = Object.fromEntries(Object.entries(SIZES).map(([k, n]) => [k, openShared("Local\\acpmf_" + k, n)])) as typeof this.m;
  }

  read(): Rec {
    const r = withPlugin(decodeAc(this.m.physics(), this.m.graphics(), this.m.static(), this.index));
    this.thirds.apply(r);
    // AC has no session counter: a new session type, or the lap count going back down, is a new session
    if (r.status === 2 && (r.session !== this.last.session || r.laps < this.last.laps)) {
      if (this.last.session !== -2) this.index++;
      r.session_index = this.index;
    }
    if (r.status === 2) this.last = { session: r.session, laps: r.laps };
    return r;
  }
}

export async function probeAc(): Promise<never> {
  const g = openShared("Local\acpmf_graphics", SIZES.graphics);
  for (;;) {
    const b = g();
    const rows: string[] = [];
    for (let o = 244; o < SIZES.graphics; o += 4) {
      const v = b.readInt32LE(o), x = b.readFloatLE(o);
      if (v) rows.push(`${o}: i=${v} f=${Math.abs(x) > 1e-6 && Math.abs(x) < 1e7 ? x.toPrecision(6) : "-"}`);
    }
    console.log(`status ${b.readInt32LE(4)} (2 = driving)  lap fraction ${b.readFloatLE(248).toFixed(4)}\n${rows.join("\n")}\n`);
    await new Promise((res) => setTimeout(res, 3000));
  }
}
