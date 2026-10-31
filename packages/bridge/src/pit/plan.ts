// Validation of a pit plan from the network.
import { isObj, Rec, ValueError } from "../util.js";

export const GROUPS = ["fuel", "tyres", "pressures", "brakes", "repairs"] as const;
export const CORNERS = ["fl", "fr", "rl", "rr"] as const;

export interface Plan {
  fuel: number; tyres: boolean; compound: "dry" | "wet"; tyre_set: number; pressures: number[];
  brakes: boolean; front_pad: number; rear_pad: number; flip_suspension: boolean; flip_bodywork: boolean;
  only: (typeof GROUPS)[number][];
}

const FILLER: Rec = { fuel: 0, compound: "dry", tyre_set: 1, pressures: [27.0, 27.0, 27.0, 27.0], front_pad: 1, rear_pad: 1 };
const WANTED: Record<string, string[]> = { fuel: ["fuel"], tyres: ["compound", "tyre_set", "pressures"], pressures: ["pressures"], brakes: ["front_pad", "rear_pad"], repairs: [] };

const psi = (v: unknown): number => {
  if (typeof v !== "number" || !(v >= 15 && v <= 40)) throw new ValueError("pressures must be from 15 to 40 psi");
  return Math.round(v * 10) / 10;
};

/** Validate a plan from the network. Throws ValueError. `only` lists the groups to send (all when absent);
 * fields of groups not sent are not needed. */
export function cleanPlan(raw: unknown): Plan {
  if (!isObj(raw)) throw new ValueError("plan must be an object");
  const only0 = "only" in raw ? raw.only : [...GROUPS];
  if (!Array.isArray(only0) || !only0.length || only0.some((g) => !(GROUPS as readonly unknown[]).includes(g))) {
    throw new ValueError(`only must list some of ${GROUPS.join(", ")}`);
  }
  const only = new Set<string>(only0);
  const needed = new Set([...only].flatMap((g) => WANTED[g]!));
  const plan: Rec = {};
  for (const [k, v] of Object.entries(FILLER)) if (!needed.has(k)) plan[k] = v;
  for (const [k, v] of Object.entries(raw)) if (needed.has(k) || !(k in FILLER)) plan[k] = v;

  const num = (k: string, lo: number, hi: number): number => {
    const v = plan[k];
    if (typeof v !== "number" || !(lo <= v && v <= hi)) throw new ValueError(`${k} must be a number from ${lo} to ${hi}`);
    return Math.trunc(v);
  };
  const p = plan.pressures;
  if (!Array.isArray(p) || p.length !== 4) throw new ValueError("pressures must be four numbers");
  if (plan.compound !== "dry" && plan.compound !== "wet") throw new ValueError("compound must be dry or wet");
  return {
    fuel: num("fuel", 0, 150), tyres: plan.tyres === true, compound: plan.compound, tyre_set: num("tyre_set", 1, 50),
    pressures: p.map(psi), brakes: plan.brakes === true, front_pad: num("front_pad", 1, 4), rear_pad: num("rear_pad", 1, 4),
    flip_suspension: plan.flip_suspension === true, flip_bodywork: plan.flip_bodywork === true,
    only: GROUPS.filter((g) => only.has(g)),
  };
}
