// Validation of a pit plan from the network.
import { isObj, Rec, ValueError } from "../util.js";

export const GROUPS = ["fuel", "tyres", "pressures", "brakes", "repairs"] as const;
export const CORNERS = ["fl", "fr", "rl", "rr"] as const;

export interface Plan {
  fuel: number; tyres: boolean; compound: "dry" | "wet"; tyre_set: number; pressures: number[];
  brakes: boolean; front_pad: number; rear_pad: number; repair_suspension: boolean; repair_bodywork: boolean;
  only: (typeof GROUPS)[number][];
  /** The pads the page last sent, for when the bridge has no memory of its own (it restarted). */
  pads_from: [number, number] | null;
  /** The repair ticks the page last sent (suspension, bodywork), for the same reason. */
  repairs_from: [boolean, boolean] | null;
}

const FILLER: Rec = { fuel: 0, compound: "dry", tyre_set: 1, pressures: [27.0, 27.0, 27.0, 27.0], front_pad: 1, rear_pad: 1, repair_suspension: true, repair_bodywork: true };
const WANTED: Record<string, string[]> = { fuel: ["fuel"], tyres: ["compound", "tyre_set", "pressures"], pressures: ["pressures"], brakes: ["front_pad", "rear_pad"], repairs: ["repair_suspension", "repair_bodywork"] };

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
  for (const k of ["repair_suspension", "repair_bodywork"]) if (typeof plan[k] !== "boolean") throw new ValueError(`${k} must be true or false`);
  if (plan.compound !== "dry" && plan.compound !== "wet") throw new ValueError("compound must be dry or wet");
  const pf = plan.pads_from;
  const padsFrom = Array.isArray(pf) && pf.length === 2 && pf.every((x) => Number.isInteger(x) && x >= 1 && x <= 4) ? (pf as [number, number]) : null;
  const rf = plan.repairs_from;
  const repairsFrom = Array.isArray(rf) && rf.length === 2 && rf.every((x) => typeof x === "boolean") ? (rf as [boolean, boolean]) : null;
  return {
    fuel: num("fuel", 0, 150), tyres: plan.tyres === true, compound: plan.compound, tyre_set: num("tyre_set", 1, 50),
    pressures: p.map(psi), brakes: plan.brakes === true, front_pad: num("front_pad", 1, 4), rear_pad: num("rear_pad", 1, 4),
    repair_suspension: plan.repair_suspension as boolean, repair_bodywork: plan.repair_bodywork as boolean,
    only: GROUPS.filter((g) => only.has(g)), pads_from: padsFrom, repairs_from: repairsFrom,
  };
}
