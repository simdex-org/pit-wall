// The pretend entry list: who is in the field, how fast each car is, and how clean its driver.
import { Rng } from "./rng.js";

const NAMES: [string, string][] = [["Lena", "Varga"], ["Tomas", "Reyes"], ["Aiko", "Mori"], ["Jonas", "Lindqvist"], ["Mara", "Okafor"], ["Pietro", "Sala"],
  ["Ines", "Duarte"], ["Kalle", "Rautio"], ["Noor", "Haddad"], ["Felix", "Brandt"], ["Sofia", "Marek"], ["Ruben", "Castell"],
  ["Yuki", "Tanabe"], ["Oskar", "Wiles"], ["Leila", "Farrow"], ["Matteo", "Ricci"], ["Hana", "Novak"], ["Dario", "Pell"], ["Elin", "Strand"]];
const TEAMS = ["Northline Racing", "Vela Motorsport", "Kestrel GT", "Blue Fen Racing", "Atlas Endurance", "Corsa Nove", "Redwater GT",
  "Ostra Racing", "Halden Motorsport", "Sable Works"];
const MODELS = [32, 30, 34, 31, 25, 33, 35, 22, 24, 20, 36, 23, 16, 19, 21, 50, 61, 53, 60]; // 15 GT3, then 4 GT4
const NUMS = [3, 11, 14, 22, 27, 33, 41, 46, 52, 58, 61, 66, 72, 77, 81, 88, 91, 95, 99];

export const PLAYER = 7;
export const FIELD_SIZE = 20;

export interface Spec {
  id: number; num: number; model: number; team: string; cup: number; first: string; last: string; gt4: boolean;
  /** How much slower than the reference GT3 lap, as a fraction. */
  delta: number;
  /** Lap-to-lap spread of the pace, fraction. */
  sd: number;
  /** Chance of a track-limits moment in a lap. */
  slip: number;
  /** Chance of a spin or a failure in a lap (the player never has one). */
  trouble: number;
  /** 0..1, how readily the driver goes for a gap. */
  aggr: number;
}

const CUP_DELTA: [number, number][] = [[-0.004, 0.006], [0.014, 0.026], [0.026, 0.04], [0.008, 0.018]]; // Pro, Pro-Am, Am, Silver

export function roster(rnd: Rng, playerName: string): Spec[] {
  const out: Spec[] = [];
  let n = 0;
  for (let id = 1; id <= FIELD_SIZE; id++) {
    if (id === PLAYER) {
      out.push({ id, num: 7, model: 32, team: "Pit Wall Demo", cup: 0, first: playerName, last: "", gt4: false, delta: 0.004, sd: 0.0022, slip: 0.012, trouble: 0, aggr: 0.5 });
      continue;
    }
    const gt4 = n >= 15, cup = gt4 ? 3 : id % 4;
    const [lo, hi] = CUP_DELTA[cup]!;
    const [first, last] = NAMES[n]!;
    out.push({ id, num: NUMS[n]!, model: MODELS[n]!, team: TEAMS[id % TEAMS.length]!, cup, first, last, gt4,
      delta: rnd.uniform(lo, hi) + (gt4 ? 0.07 : 0), sd: rnd.uniform(0.0025, 0.0055) * (1 + cup * 0.15), slip: rnd.uniform(0.01, 0.035) * (1 + cup * 0.2),
      trouble: rnd.uniform(0.002, 0.007), aggr: rnd.uniform(0.2, 0.9) });
    n++;
  }
  return out;
}
