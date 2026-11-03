// Drives the pit page to a plan.
//
// The pit page, top to bottom (the pitstop key pressed twice leaves the cursor on the first row; Up from the first row wraps
// to the last):
//
//     Pit limiter, Strategy, Refuel, Change tyres,
//       [Tyre set (dry only), Compound, All four, FL, FR, RL, RR]   while Change tyres is on
//     Change brakes, [Front pads, Rear pads]                          while Change brakes is on
//     [Driver], Repair suspension, Repair bodywork
import { roundHalfEven } from "../util.js";
import { Key, Mfd, MfdSnapshot } from "./mfd.js";
import { CORNERS, Plan } from "./plan.js";

const diff = (a: MfdSnapshot, b: MfdSnapshot) => ({
  fuel: Math.round((b.fuel - a.fuel) * 10) / 10, set: b.tyre_set - a.tyre_set,
  p: [0, 1, 2, 3].filter((i) => Math.abs(a.pressures[i]! - b.pressures[i]!) > 0.05),
});

const pads = new WeakMap<Mfd, number[]>(); // the pad compounds last sent, per MFD
type Repairs = "all" | "body" | "none";
const repairs = new WeakMap<Mfd, Repairs>(); // the repair ticks as last left, per MFD
const repairState = (suspension: boolean, bodywork: boolean): Repairs => (suspension ? "all" : bodywork ? "body" : "none");

/** Returns {field: "ok" | "sent" | "skipped" | problem}. "ok" was read back from the game; "sent" was pressed but ACC does not publish it. */
/** `fitted` is the pads on the car (1 to 4), the best guess for where the pad rows start when nothing was sent before. */
export async function applyPlan(plan: Plan, mfd: Mfd, fitted: (number | undefined)[] = []): Promise<Record<string, string>> {
  if (mfd.read().status !== "live") throw new Error("ACC is not in a live session on the driver's PC");
  const res: Record<string, string> = {};
  const press = async (k: Key, n = 1) => { await mfd.press(k, n); };
  const look = async () => { await mfd.settle?.(); return mfd.read(); }; // ACC publishes a value a frame or two after the key

  let pos: number | null = null; // the row the cursor is on, counted from the top; null after the rows above it may have changed

  const at = async (row: number, key?: Key, n = 1) => { // cursor to row (negative: from the bottom), then key n times
    if (row < 0 || pos === null) { // from the top: the pitstop key twice puts the cursor on the first row
      await press("pit", 2);
      await press(row >= 0 ? "down" : "up", Math.abs(row));
    } else { // from where it is: one row at a time, no trip back to the top
      await press(row > pos ? "down" : "up", Math.abs(row - pos));
    }
    pos = row >= 0 ? row : null; // counting from the bottom says nothing about the row from the top
    if (key) await press(key, n);
  };

  const changed = async (row: number, key: Key) => { // a step that shows or hides rows: where everything is must be found again from the top
    await at(row, key);
    pos = null;
  };

  const probe = async (row: number) => { // what one step right on this row changes; the step is undone with one step left
    // Only one way: a row already at its right-hand limit (pads on 4) moves one step left. Trying the other way as well
    // moved rows at their left-hand limit instead (pads on 1, the usual case), which is the worse risk.
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

  // Fuel to add is greyed out while a pit strategy holds it and ignores the keys. A press that moves nothing says so; the
  // Strategy row is then stepped left (it reloads that strategy's tyres and pressures, so send those blocks too) until the row answers.
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
  const setTyres = only.has("tyres") && plan.tyres; // with Change tyres off ACC ignores the compound, set and pressures
  const tyreRows = ["tyres", "pressures", "brakes"].some((g) => only.has(g)); // brakes are found by counting past the tyre rows
  const STRATEGY = 1, REFUEL = 2, tyres = 3; // the page has the same top rows for everyone

  const wetNow = async () => { // row tyres+4 is FL when dry (a Tyre set row is above), FR when wet
    const d = (await probe(tyres + 4)).p;
    if (!(d.length === 1 && (d[0] === 0 || d[0] === 1))) throw new Error("the tyre rows are not where ACC puts them");
    return d[0] === 1;
  };

  const tailNow = async () => { // rows below RR: Change brakes, [2 pads], [Driver], 2 repairs = 3..6
    for (let tail = 3; tail < 7; tail++) {
      const p = (await probe(-(tail + 1))).p;
      if (p.length === 1 && p[0] === 3) return tail;
    }
    throw new Error("could not count the rows below the tyres");
  };

  if (only.has("fuel")) res.fuel = await steerFuel();

  let tyresWereOn = false;
  if (tyreRows) {
    tyresWereOn = (await probe(tyres + 3)).p.length > 0; // All four (dry) or FL (wet) only exists while tyres change
    if (!tyresWereOn) { // the tyre rows have to show to set them, or to count past them
      await changed(tyres, "right");
      if (!(await probe(tyres + 3)).p.length) throw new Error("could not find the tyre rows on the pit page - is it the pitstop MFD page this key opens?");
    }
    let wet = await wetNow();
    if (setTyres && (plan.compound === "wet") !== wet) {
      await changed(tyres + (wet ? 1 : 2), plan.compound === "wet" ? "right" : "left"); // Right is wet, Left is dry, whatever it was
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
      const brakes = tyres + (wet ? 6 : 7) + 1; // the Change brakes row, tyre rows showing
      if (plan.brakes !== brakesOn) {
        await changed(brakes, "right");
        brakesOn = (await tailNow()) >= 5;
      }
      res.brakes = brakesOn === plan.brakes ? "ok" : "did not change";
      if (plan.brakes && brakesOn) {
        const memo = pads.get(mfd) ?? [];
        for (const [i, row, k] of [[0, brakes + 1, "front_pad"], [1, brakes + 2, "rear_pad"]] as const) {
          // The pads wrap from 4 to 1 and ACC does not publish them: step the shortest way from where they were left.
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

  // ACC allows three states: all, bodywork only, none (ticking Suspension ticks Bodywork, unticking Bodywork unticks Suspension).
  // Bodywork then Suspension ends at "all" from any state, so the start does not have to be known; from there one more press.
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
  } else if (tyreRows && !tyresWereOn) { // with the tyre rows hidden the probe above can land on a repair row: put them back
    await setRepairs(repairs.get(mfd) ?? (plan.repairs_from ? repairState(...plan.repairs_from) : "all"));
  }

  if (tyreRows) {
    // Tyres sent: as planned. Pressures alone: tyres stay on, since pressures only matter with new tyres. Otherwise as found.
    const wantOn = only.has("tyres") ? plan.tyres : only.has("pressures") ? true : tyresWereOn;
    if (!wantOn) await changed(tyres, "right"); // not probed after: with the tyre rows gone, the row it would step on can be a pad
    res.tyres = only.has("pressures") && !only.has("tyres") && !tyresWereOn ? "switched on for the pressures" : "sent";
  }
  return res;
}
