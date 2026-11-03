import { roundHalfEven } from "../util.js";
import { Key, Mfd, MfdSnapshot } from "./mfd.js";
import { CORNERS, Plan } from "./plan.js";

const diff = (a: MfdSnapshot, b: MfdSnapshot) => ({
  fuel: Math.round((b.fuel - a.fuel) * 10) / 10, set: b.tyre_set - a.tyre_set,
  p: [0, 1, 2, 3].filter((i) => Math.abs(a.pressures[i]! - b.pressures[i]!) > 0.05),
});

const pads = new WeakMap<Mfd, number[]>();
type Repairs = "all" | "body" | "none";
const repairs = new WeakMap<Mfd, Repairs>();
const repairState = (suspension: boolean, bodywork: boolean): Repairs => (suspension ? "all" : bodywork ? "body" : "none");

export async function applyPlan(plan: Plan, mfd: Mfd, fitted: (number | undefined)[] = []): Promise<Record<string, string>> {
  if (mfd.read().status !== "live") throw new Error("ACC is not in a live session on the driver's PC");
  const res: Record<string, string> = {};
  const press = async (k: Key, n = 1) => { await mfd.press(k, n); };
  const look = async () => { await mfd.settle?.(); return mfd.read(); };

  let pos: number | null = null;

  const at = async (row: number, key?: Key, n = 1) => {
    if (row < 0 || pos === null) {
      await press("pit", 2);
      await press(row >= 0 ? "down" : "up", Math.abs(row));
    } else {
      await press(row > pos ? "down" : "up", Math.abs(row - pos));
    }
    pos = row >= 0 ? row : null;
    if (key) await press(key, n);
  };

  const changed = async (row: number, key: Key) => {
    await at(row, key);
    pos = null;
  };

  const probe = async (row: number) => {
    const a = await look();
    await at(row, "right");
    const d = diff(a, await look());
    await press("left");
    return d;
  };

  const steer = async (row: number, get: (m: MfdSnapshot) => number, target: number, step: number) => {
    for (let k = 0; k < 4; k++) {
      const n = roundHalfEven((target - get(await look())) / step);
      if (n === 0) return "ok";
      await at(row, n > 0 ? "right" : "left", Math.abs(n));
    }
    const v = get(await look());
    return roundHalfEven((target - v) / step) === 0 ? "ok" : `stopped at ${v}`;
  };

  const steerFuel = async () => {
    for (let unlock = 0; unlock < 4; unlock++) {
      const before = (await look()).fuel;
      if (Math.abs(plan.fuel - before) < 0.5) return "ok";
      const r = await steer(REFUEL, (m) => m.fuel, plan.fuel, 1);
      if ((await look()).fuel !== before || r === "ok") return unlock ? `ok (Pit Strategy stepped ${unlock}x)` : r;
      if (unlock < 3) await at(STRATEGY, "left");
    }
    return "locked: Fuel to add does not answer, even with Pit Strategy changed";
  };

  const only = new Set<string>(plan.only);
  const setTyres = only.has("tyres") && plan.tyres;
  const tyreRows = ["tyres", "pressures", "brakes"].some((g) => only.has(g));
  const STRATEGY = 1, REFUEL = 2, tyres = 3;

  const wetNow = async () => {
    const d = (await probe(tyres + 4)).p;
    if (!(d.length === 1 && (d[0] === 0 || d[0] === 1))) throw new Error("the tyre rows are not where ACC puts them");
    return d[0] === 1;
  };

  const tailNow = async () => {
    for (let tail = 3; tail < 7; tail++) {
      const p = (await probe(-(tail + 1))).p;
      if (p.length === 1 && p[0] === 3) return tail;
    }
    throw new Error("could not count the rows below the tyres");
  };

  if (only.has("fuel")) res.fuel = await steerFuel();

  let tyresWereOn = false;
  if (tyreRows) {
    tyresWereOn = (await probe(tyres + 3)).p.length > 0;
    if (!tyresWereOn) {
      await changed(tyres, "right");
      if (!(await probe(tyres + 3)).p.length) throw new Error("could not find the tyre rows on the pit page - is it the pitstop MFD page this key opens?");
    }
    let wet = await wetNow();
    if (setTyres && (plan.compound === "wet") !== wet) {
      await changed(tyres + (wet ? 1 : 2), plan.compound === "wet" ? "right" : "left");
      wet = await wetNow();
    }
    if (setTyres) {
      res.compound = (plan.compound === "wet") === wet ? "ok" : "did not change";
      res.tyre_set = wet ? "skipped" : await steer(tyres + 1, (m) => m.tyre_set, plan.tyre_set, 1);
    }
    if (setTyres || (only.has("pressures") && !only.has("tyres"))) {
      const first = tyres + (wet ? 3 : 4);
      for (let i = 0; i < CORNERS.length; i++) res[CORNERS[i]!] = await steer(first + i, (m) => m.pressures[i]!, plan.pressures[i]!, 0.1);
    }

    if (only.has("brakes")) {
      let brakesOn = (await tailNow()) >= 5;
      const brakes = tyres + (wet ? 6 : 7) + 1;
      if (plan.brakes !== brakesOn) {
        await changed(brakes, "right");
        brakesOn = (await tailNow()) >= 5;
      }
      res.brakes = brakesOn === plan.brakes ? "ok" : "did not change";
      if (plan.brakes && brakesOn) {
        const memo = pads.get(mfd) ?? [];
        for (const [i, row, k] of [[0, brakes + 1, "front_pad"], [1, brakes + 2, "rear_pad"]] as const) {
          const car = fitted[i] != null && fitted[i]! >= 1 && fitted[i]! <= 4 ? fitted[i] : undefined;
          const [from, how] = memo[i] ? [memo[i]!, "sent"] : plan.pads_from ? [plan.pads_from[i]!, "sent (from page)"]
            : car ? [car, "sent (from car)"] : [1, "sent (guessed 1)"];
          const n = (plan[k] - from + 4) % 4;
          await at(row, n <= 2 ? "right" : "left", n <= 2 ? n : 4 - n);
          memo[i] = plan[k];
          res[k] = how;
        }
        pads.set(mfd, memo);
      }
    }
  }

  const setRepairs = async (to: Repairs) => {
    await at(-1, "right");
    await press("up"); await press("right");
    if (to === "body") await press("right");
    else if (to === "none") { await press("down"); await press("right"); }
    repairs.set(mfd, to);
  };
  if (only.has("repairs")) {
    await setRepairs(repairState(plan.repair_suspension, plan.repair_bodywork));
    res.repairs = "sent";
  } else if (tyreRows && !tyresWereOn) {
    await setRepairs(repairs.get(mfd) ?? (plan.repairs_from ? repairState(...plan.repairs_from) : "all"));
  }

  if (tyreRows) {
    const wantOn = only.has("tyres") ? plan.tyres : only.has("pressures") ? true : tyresWereOn;
    if (!wantOn) await changed(tyres, "right");
    res.tyres = only.has("pressures") && !only.has("tyres") && !tyresWereOn ? "switched on for the pressures" : "sent";
  }
  return res;
}
