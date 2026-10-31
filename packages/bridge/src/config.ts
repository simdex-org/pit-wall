// The thresholds and strategy inputs shared by every screen (POST /config), validated as a whole.
import { isObj, Rec, ValueError } from "./util.js";

export const CLASSES = ["GT3", "GT4", "GT2", "GTC", "TCX"] as const;
export const DRY_PSI = [26.0, 27.0];
export const WET_PSI = [29.5, 31.0];
export const BRAKE_HOT_C = 750;
export const PAD_LOW_MM = 12;
export const TYRE_COLD_C = 65;

const classTh = (): Rec => ({
  dry_psi: [...DRY_PSI], wet_psi: [...WET_PSI], tyre_c: [TYRE_COLD_C, 105],
  brake_c: { front: [200, BRAKE_HOT_C], rear: [200, BRAKE_HOT_C] }, pad_low_mm: PAD_LOW_MM, water_c: [105, 115],
});

/** Every class starts as a copy of GT3. */
export const defaultConfig = (): Rec => ({
  thresholds: Object.fromEntries(CLASSES.map((k) => [k, classTh()])),
  fuel_low_laps: 3,
  strategy: {
    reserve_laps: 1.0, laps_override: null, pit_loss_s: 25.0, refuel_s_per_l: 0.25, tyre_s: 30.0, min_stationary_s: 0.0,
    fuel_and_tyres: "parallel", mandatory_stops: null, pit_window_open_min: null, pit_window_close_min: null,
  },
});

function num(v: unknown, lo: number, hi: number, name: string, integer = false, nullable = false): number | null {
  if (v === null && nullable) return null;
  if (typeof v !== "number" || !(lo <= v && v <= hi) || (integer && !Number.isInteger(v))) {
    throw new ValueError(`${name} must be ${integer ? "a whole number" : "a number"} from ${lo} to ${hi}${nullable ? " or empty" : ""}`);
  }
  return v;
}

function pair(v: unknown, lo: number, hi: number, name: string): number[] {
  if (!Array.isArray(v) || v.length !== 2) throw new ValueError(`${name} must be two numbers`);
  const a = num(v[0], lo, hi, name) as number;
  const b = num(v[1], lo, hi, name) as number;
  if (!(a < b)) throw new ValueError(`${name}: the first must be below the second`);
  return [a, b];
}

function merge(dst: Rec, src: Rec, path: string): void {
  for (const [k, v] of Object.entries(src)) {
    if (!(k in dst)) throw new ValueError(`unknown setting ${path}${k}`);
    if (isObj(dst[k])) {
      if (!isObj(v)) throw new ValueError(`${path}${k} must be an object`);
      merge(dst[k], v, `${path}${k}.`);
    } else dst[k] = v;
  }
}

/** A partial config from the network, merged onto base (default: the defaults) and checked whole. Throws ValueError. */
export function cleanConfig(raw: unknown, base?: Rec): Rec {
  if (!isObj(raw)) throw new ValueError("config must be an object");
  const out: Rec = structuredClone(base ?? defaultConfig());
  merge(out, raw, "");
  for (const [cls, t] of Object.entries<Rec>(out.thresholds)) {
    t.dry_psi = pair(t.dry_psi, 15, 40, `${cls} dry psi`);
    t.wet_psi = pair(t.wet_psi, 15, 40, `${cls} wet psi`);
    t.tyre_c = pair(t.tyre_c, 0, 200, `${cls} tyre °C`);
    for (const axle of ["front", "rear"]) t.brake_c[axle] = pair(t.brake_c[axle], 100, 1200, `${cls} ${axle} brake °C`);
    t.pad_low_mm = num(t.pad_low_mm, 0, 30, `${cls} pad mm`);
    t.water_c = pair(t.water_c, 60, 150, `${cls} water °C`);
  }
  out.fuel_low_laps = num(out.fuel_low_laps, 0, 20, "fuel_low_laps");
  const s = out.strategy;
  s.reserve_laps = num(s.reserve_laps, 0, 10, "reserve_laps");
  s.laps_override = num(s.laps_override, 1, 999, "laps_override", true, true);
  for (const [k, hi] of [["pit_loss_s", 200], ["refuel_s_per_l", 5], ["tyre_s", 120], ["min_stationary_s", 200]] as const) s[k] = num(s[k], 0, hi, k);
  if (s.fuel_and_tyres !== "parallel" && s.fuel_and_tyres !== "sequential") throw new ValueError("fuel_and_tyres must be parallel or sequential");
  s.mandatory_stops = num(s.mandatory_stops, 0, 9, "mandatory_stops", true, true);
  const o = (s.pit_window_open_min = num(s.pit_window_open_min, 0, 1440, "pit_window_open_min", false, true));
  const c = (s.pit_window_close_min = num(s.pit_window_close_min, 0, 1440, "pit_window_close_min", false, true));
  if ((o === null) !== (c === null) || (o !== null && !(o < (c as number)))) {
    throw new ValueError("pit window: set both minutes, open before close, or neither");
  }
  return out;
}
