// What the pretend teams decide: when to stop and how much fuel to take in a race, and how to run a qualifying session.
import { clamp } from "../util.js";
import { Box, SimCar, TANK } from "./car.js";
import type { World } from "./world.js";

export const REFUEL_MS_PER_L = 370;
export const SERVICE_START_MS = 900;

/** The litres to drive for ms of racing, with a margin. */
const fuelFor = (c: SimCar, ms: number): number => clamp(((ms / (c.lapSec * 1000)) * 1.06 + 0.8) * c.lpl, 8, TANK);

const avgLapMs = (c: SimCar): number => c.lapSec * 1000 * 1.012;

/** Race: the planned stop times (inside the pit window) and the fuel for the first stint. */
export function setupRace(w: World, c: SimCar): void {
  const total = w.durMs, lm = avgLapMs(c);
  const need = (total / lm + 1) * c.lpl;
  let n = Math.ceil(need / (TANK - 8)) - 1;
  if (w.mandatory) n = Math.max(1, n);
  c.stopTimes = [];
  for (let k = 0; k < n; k++) {
    const slot = total / (n + 1);
    let t = slot * (k + 1) + w.rnd.uniform(-0.12, 0.12) * slot;
    t = clamp(t, w.pitOpen + 20000, w.pitClose - lm * 1.5);
    if (k) t = Math.max(t, c.stopTimes[k - 1]! + 3 * lm);
    c.stopTimes.push(t);
  }
  c.slot = total / (n + 1);
  c.fuel = fuelFor(c, (c.stopTimes[0] ?? total) + lm);
  c.mandatoryDone = !w.mandatory;
}

/** Qualifying: when the car first leaves the garage, how many runs it makes, and the fuel for the first. */
export function setupQuali(w: World, c: SimCar, slot: number): void {
  c.runsLeft = (w.rnd.random() < 0.7 ? 2 : 3) - 1;
  c.pushes = w.rnd.random() < 0.35 ? 2 : 1;
  c.releaseAt = 6000 + slot * 3500 * w.rnd.uniform(0.2, 1.4) + w.rnd.uniform(0, 90000) * w.rnd.random();
  c.fuel = runFuel(c);
  c.runLap = 0;
}

const runFuel = (c: SimCar): number => (c.pushes + 2.4) * c.lpl + 2;

/** Called as a lap starts: what kind of lap it is, and whether the car comes in at its end. */
/** On the wrong tyres for the track: slicks on a wet one, wets on a drying one. Drivers differ in how long they wait. */
export const wrongTyres = (w: World, c: SimCar): boolean =>
  c.wetTyres ? w.wet < 0.14 && w.rain < 0.1 : w.wet > 0.33 + 0.1 * (1 - c.spec.aggr);

export function lapStarted(w: World, c: SimCar): void {
  if (c.penalty && c.laps > c.penalty.due) { // not served in time: the stewards add the time instead
    c.timePen += 30000; c.penalty = null;
    w.say(3, c, `#${c.spec.num} +30 s: penalty not served`);
  }
  if (w.kind !== "race") {
    c.runLap++;
    c.kind = c.runLap === 1 ? "out" : c.runLap <= 1 + c.pushes ? "push" : "in";
    if (c.kind === "push" && wrongTyres(w, c)) c.kind = "in"; // abandons the lap when the rain comes
    c.wantStop = c.kind === "in";
    c.wantPit = c.wantStop;
    return;
  }
  c.kind = "race";
  const lm = avgLapMs(c), left = w.durMs - w.t;
  const due = c.stopTimes.length > 0 && w.t >= c.stopTimes[0]! && w.t <= w.durMs - lm;
  const short = c.fuel < c.lpl * Math.min(2.2, left / lm + 1.2);
  const worn = c.wear > 0.88 && left > 4 * 60000; // stops before the cliff, not at the bottom of it
  const weather = c.laps >= 1 && left > 3 * lm && wrongTyres(w, c);
  c.wantStop = due || short || worn || weather || c.damageSum > 60 || c.st === "limp";
  c.wantPit = c.wantStop || c.penalty !== null;
}

/** The planned stops still to come after one made now. */
export const remainingStops = (w: World, c: SimCar, t0: number): number[] => c.stopTimes.filter((x) => x > t0 + 0.4 * c.slot);

/** Bookkeeping when a stop ends: the plan moves on, and the mandatory stop is still owed if this one was out of the window. */
export function afterStop(w: World, c: SimCar, box: Box): void {
  if (w.kind !== "race") return;
  if (w.t >= w.pitOpen && w.t <= w.pitClose) c.mandatoryDone = true;
  c.stopTimes = remainingStops(w, c, box.t0);
  const lm = avgLapMs(c);
  if (!c.mandatoryDone && !c.stopTimes.length && w.t < w.pitClose - 3 * lm) c.stopTimes = [clamp(w.t + c.slot, w.pitOpen + 20000, w.pitClose - 1.5 * lm)];
}

/** The stop a car makes now: fuel, tyres, repairs and how long it stands. The driver's own car may be changed by w.customize. */
export function service(w: World, c: SimCar): Box {
  const t0 = w.t;
  const wet = c.wetTyres ? !(w.wet < 0.14 && w.rain < 0.1) : w.wet > 0.27 || w.rain > 0.4;
  const box: Box = { t0, end: t0, fuel0: c.fuel, add: 0, fuelEnd: c.fuel, tyres: true, wet, park: false, repair: c.damageSum > 35 };
  if (w.kind === "race") {
    const next = remainingStops(w, c, t0)[0];
    const lm = avgLapMs(c);
    const left = next !== undefined ? next - t0 + lm : w.durMs - t0 + 1.5 * lm;
    box.add = clamp(fuelFor(c, left) - c.fuel, 0, TANK - c.fuel);
    box.tyres = wet !== c.wetTyres || c.wear > 0.5 || w.rnd.random() < 0.85 || c.id === w.playerId;
  } else {
    box.park = !(c.runsLeft > 0 && w.durMs - t0 > c.lapSec * 1000 * 1.6);
    if (!box.park) {
      c.runsLeft--;
      c.pushes = w.rnd.random() < 0.4 ? 2 : 1;
      box.add = clamp(runFuel(c) - c.fuel, 0, TANK - c.fuel);
      box.tyres = wet !== c.wetTyres || w.rnd.random() < 0.6;
    }
  }
  if (c.id === w.playerId) w.customize?.(box, c);
  seal(w, c, box);
  return box;
}

/** Sets the end of the stop and the fuel at its end from what is to be done. */
export function seal(w: World, c: SimCar, box: Box): void {
  const fuelT = box.add > 0.05 ? SERVICE_START_MS + box.add * REFUEL_MS_PER_L : 0;
  const tyreT = box.tyres ? 10500 + w.rnd.normal(0, 900) : 0;
  const repairT = box.repair ? 5000 + c.damageSum * 400 : 0;
  let svc = Math.max(fuelT, tyreT, 2500) + 1200 + repairT;
  box.fuelEnd = box.fuel0 + box.add;
  if (w.kind !== "race" && !box.park) {
    const wait = w.rnd.uniform(8000, 60000);
    c.releaseAt = box.t0 + Math.max(svc, wait);
    svc = c.releaseAt - box.t0;
  }
  box.end = box.t0 + svc;
}
