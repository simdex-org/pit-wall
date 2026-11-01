// The pretend entry list: who is in the field, which class each car races in, how fast it is, and how clean its driver.
import { MODELS } from "../broadcast/models.js";
import { Rng } from "./rng.js";

const FIRST = ["Lena", "Tomas", "Aiko", "Jonas", "Mara", "Pietro", "Ines", "Kalle", "Noor", "Felix", "Sofia", "Ruben", "Yuki", "Oskar", "Leila", "Matteo", "Hana", "Dario", "Elin", "Bruno"];
const LAST = ["Varga", "Reyes", "Mori", "Lindqvist", "Okafor", "Sala", "Duarte", "Rautio", "Haddad", "Brandt", "Marek", "Castell", "Tanabe", "Wiles", "Farrow", "Ricci", "Novak", "Pell", "Strand"];
const TEAMS = ["Northline Racing", "Vela Motorsport", "Kestrel GT", "Blue Fen Racing", "Atlas Endurance", "Corsa Nove", "Redwater GT",
  "Ostra Racing", "Halden Motorsport", "Sable Works", "Ironvale Racing", "Lumen GT", "Takeda Motorsport", "Fjord Racing", "Orbit Endurance",
  "Quarry Motorsport", "Delta Nine", "Harrow GT", "Silvermoor Racing", "Cobalt Works"];
const NUMS = [3, 11, 14, 22, 27, 33, 41, 46, 52, 58, 61, 66, 72, 77, 81, 88, 91, 95, 99];

export const PLAYER = 7;
export const MAX_FIELD = 60;
export const MIN_FIELD = 8;

/** How many cars, and the share of each class among them. */
export interface Field { cars: number; mix: Record<string, number> }
export const DEFAULT_FIELD: Field = { cars: 20, mix: { GT3: 80, GT4: 20 } };
export const CLASSES = ["GT3", "GT4", "GTC", "TCX", "GT2"];

/** How much slower than the reference GT3 each class is, as a fraction, and the cup its drivers race in (null: the GT3 cups). */
const CLASS_BASE: Record<string, [delta: number, cup: number | null]> = { GT3: [0, null], GT2: [-0.015, 3], GT4: [0.07, 3], GTC: [0.09, 4], TCX: [0.15, 4] };

/** Cars per class: the shares rounded so they add up to `cars`. The player drives a GT3, so there is always one. */
export function split(f: Field): Record<string, number> {
  const total = Object.values(f.mix).reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  let left = f.cars;
  const rest = Object.entries(f.mix).map(([k, v]) => { const x = (f.cars * v) / total; out[k] = Math.floor(x); left -= out[k]!; return [k, x - out[k]!] as const; });
  rest.sort((a, b) => b[1] - a[1]);
  for (let i = 0; left > 0; i++, left--) out[rest[i % rest.length]![0]]!++;
  if (!out.GT3) { out.GT3 = 1; const k = Object.keys(out).filter((c) => c !== "GT3").sort((a, b) => out[b]! - out[a]!)[0]!; out[k]!--; }
  return out;
}

export interface Spec {
  id: number; num: number; model: number; team: string; cup: number; first: string; last: string; gt4: boolean;
  /** The class: GT3, GT4, GTC, TCX or GT2. */
  cls: string;
  /** How much slower than the reference GT3 lap, as a fraction. */
  delta: number;
  /** Lap-to-lap spread of the pace, fraction. */
  sd: number;
  /** Chance of a moment near the limit in a lap, before the state of the car is counted. */
  slip: number;
  /** Chance of a breakdown in a lap (the player never has one). */
  trouble: number;
  /** The traits below are 0..1, 0.5 being a typical driver. */
  /** How readily the driver goes for a gap. */
  aggr: number;
  /** How hard the driver is to pass. */
  defence: number;
  /** Fewer errors, and less rattled by pressure. */
  comp: number;
  /** Kindness to the tyres. */
  tyreMgmt: number;
  /** Fuel use: the frugal driver burns less. */
  fuelSave: number;
  /** Pace and safety in the wet. */
  wetSkill: number;
  /** One-lap pace on a push lap. */
  quali: number;
  /** Race pace against one-lap pace, as a fraction of the lap: a good qualifier can be a poor racer. */
  race: number;
  /** Reaction at the lights. */
  start: number;
  /** The team's pit crew: a quick stop, or a slow one. */
  crew: number;
}

const CUP_DELTA: [number, number][] = [[-0.004, 0.006], [0.014, 0.026], [0.026, 0.04], [0.008, 0.018]]; // Pro, Pro-Am, Am, Silver

export function roster(rnd: Rng, playerName: string, field: Field = DEFAULT_FIELD): Spec[] {
  const out: Spec[] = [];
  const trait = (mean = 0.5, sd = 0.2) => Math.min(1, Math.max(0, rnd.normal(mean, sd)));
  const crews = TEAMS.map(() => trait());
  const counts = split(field);
  const slots = ["GT3", ...Object.keys(counts).filter((k) => k !== "GT3")].flatMap((k) => Array<string>(counts[k]!).fill(k));
  const pool = (cls: string) => Object.entries(MODELS).filter(([, m]) => m[1] === cls).map(([id]) => Number(id));
  const offset: Record<string, number> = {}, seen: Record<string, number> = {};
  const numbers = [...new Set([...NUMS, ...Array.from({ length: 98 }, (_, i) => i + 2)])].filter((x) => x !== 7);
  let n = 0;
  for (let id = 1; id <= field.cars; id++) {
    const player = id === PLAYER;
    const cls = player ? "GT3" : slots[id - 1]!;
    const [base, fixedCup] = CLASS_BASE[cls]!;
    const cup = player ? rnd.randint(0, 3) : fixedCup ?? id % 4;
    const [lo, hi] = CUP_DELTA[cls === "GT3" ? cup : 3]!;
    const skill = trait(0.5, 0.25), comp = trait(0.5 + 0.4 * (skill - 0.5), 0.18);
    const models = pool(cls);
    offset[cls] ??= rnd.randint(0, models.length - 1);
    const model = player ? 32 : models[(offset[cls]! + (seen[cls] = (seen[cls] ?? -1) + 1)) % models.length]!;
    const team = player ? "Pit Wall Demo" : TEAMS[id % TEAMS.length]!;
    const [first, last] = player ? [playerName, ""] : [FIRST[(n * 7 + Math.floor(n / LAST.length)) % FIRST.length]!, LAST[n % LAST.length]!];
    out.push({ id, num: player ? 7 : numbers[n]!, model, team, cup, first, last, gt4: cls === "GT4", cls,
      delta: base + lo + (hi - lo) * (1 - skill),
      sd: rnd.uniform(0.0025, 0.0055) * (1 + cup * 0.15) * (1.35 - 0.7 * comp),
      slip: rnd.uniform(0.01, 0.035) * (1 + cup * 0.2) * (1.5 - comp),
      trouble: player ? 0 : rnd.uniform(0.002, 0.007),
      aggr: rnd.uniform(0.2, 0.9), defence: trait(), comp, tyreMgmt: trait(), fuelSave: trait(), wetSkill: trait(0.5, 0.25),
      quali: trait(0.5 + 0.3 * (skill - 0.5), 0.2), race: rnd.normal(0, 0.006), start: trait(),
      crew: player ? 0.5 : crews[id % TEAMS.length]! });
    if (!player) n++;
  }
  return out;
}
