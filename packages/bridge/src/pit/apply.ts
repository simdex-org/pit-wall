// Drives the pit page to a plan.
//
// The pit page, top to bottom (the pitstop key pressed twice leaves the cursor on the first row; Up from the first row wraps
// to the last):
//
//     Pit limiter, [Strategy], Refuel, Change tyres,
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

/** Returns {field: "ok" | "sent" | "skipped" | problem}. "ok" was read back from the game; "sent" was pressed but ACC does not publish it. */
export async function applyPlan(plan: Plan, mfd: Mfd): Promise<Record<string, string>> {
  if (mfd.read().status !== "live") throw new Error("ACC is not in a live session on the driver's PC");
  const res: Record<string, string> = {};
  const press = async (k: Key, n = 1) => { await mfd.press(k, n); };

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
    const a = mfd.read();
    await at(row, "right");
    const d = diff(a, mfd.read());
    await press("left");
    return d;
  };

  const steer = async (row: number, get: (m: MfdSnapshot) => number, target: number, step: number) => {
    for (let k = 0; k < 4; k++) {
      const n = roundHalfEven((target - get(mfd.read())) / step);
      if (n === 0) return "ok";
      await at(row, n > 0 ? "right" : "left", Math.abs(n));
    }
    const v = get(mfd.read());
    return roundHalfEven((target - v) / step) === 0 ? "ok" : `stopped at ${v}`;
  };

  const only = new Set<string>(plan.only);
  const tyreRows = ["tyres", "pressures", "brakes"].some((g) => only.has(g)); // brakes are found by counting past the tyre rows
  let refuel = 1, tyres = 2;

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

  if ([...only].some((g) => g !== "repairs")) {
    // Refuel is row 2 under a Strategy row, else row 1. Row 2 is probed, never row 1: stepping the Strategy row reloads that
    // strategy's fuel, tyres and pressures. Without a Strategy row, row 2 is Change tyres, which the probe switches and back.
    const d = await probe(2);
    refuel = Math.abs(Math.abs(d.fuel) - 1) < 0.05 && !d.set && !d.p.length ? 2 : 1;
    tyres = refuel + 1; // the Change tyres row
  }

  if (only.has("fuel")) res.fuel = await steer(refuel, (m) => m.fuel, plan.fuel, 1);

  let tyresWereOn = false;
  if (tyreRows) {
    tyresWereOn = (await probe(tyres + 3)).p.length > 0; // All four (dry) or FL (wet) only exists while tyres change
    if (!tyresWereOn) { // the tyre rows have to show to set them, or to count past them
      await changed(tyres, "right");
      if (!(await probe(tyres + 3)).p.length) throw new Error("could not find the tyre rows on the pit page - is it the pitstop MFD page this key opens?");
    }
    let wet = await wetNow();
    if (only.has("tyres") && (plan.compound === "wet") !== wet) {
      await changed(tyres + (wet ? 1 : 2), plan.compound === "wet" ? "right" : "left"); // Right is wet, Left is dry, whatever it was
      wet = await wetNow();
    }
    if (only.has("tyres")) {
      res.compound = (plan.compound === "wet") === wet ? "ok" : "did not change";
      res.tyre_set = wet ? "skipped" : await steer(tyres + 1, (m) => m.tyre_set, plan.tyre_set, 1);
    }
    if (only.has("tyres") || only.has("pressures")) {
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
        for (const [row, k] of [[brakes + 1, "front_pad"], [brakes + 2, "rear_pad"]] as const) {
          await at(row, "left", 3); // down to compound 1, then up to the one asked for
          await press("right", plan[k] - 1);
          res[k] = "sent";
        }
      }
    }
  }

  if (only.has("repairs")) {
    for (const [row, k] of [[-2, "flip_suspension"], [-1, "flip_bodywork"]] as const) {
      if (plan[k]) { await at(row, "right"); res[k] = "sent"; }
    }
  }

  if (tyreRows) {
    // Tyres sent: as planned. Pressures alone: tyres stay on, since pressures only matter with new tyres. Otherwise as found.
    const wantOn = only.has("tyres") ? plan.tyres : only.has("pressures") ? true : tyresWereOn;
    if (!wantOn) await changed(tyres, "right"); // not probed after: with the tyre rows gone, the row it would step on can be a pad
    res.tyres = only.has("pressures") && !only.has("tyres") && !tyresWereOn ? "switched on for the pressures" : "sent";
  }
  return res;
}
