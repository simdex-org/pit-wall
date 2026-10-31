// How one car moves in a step: the speed it could hold, the traffic in front of it, the pit lane, the laps it completes
// and the mistakes it makes.
import { clamp, mod } from "../util.js";
import { CAR_LEN, Lap, SimCar } from "./car.js";
import { LANE_IN, LANE_OFFSET, LANE_OUT } from "./circuit.js";
import { accCap, brakeCap, circle, drag, latMax } from "./physics.js";
import { afterStop, lapStarted, REFUEL_MS_PER_L, service, SERVICE_START_MS } from "./plan.js";
import type { World } from "./world.js";

export const LANE_V = 60 / 3.6;
const FCY_V = 80 / 3.6;
const BOX_SIDE = -5; // metres further from the lane than a car driving through

const smooth = (x: number): number => x * x * (3 - 2 * x);
/** Signed metres from `from` to `to` round a lap of len, in (-len/2, len/2]. */
const rel = (len: number, from: number, to: number): number => mod(to - from + len / 2, len) - len / 2;
const lanePath = (l: number): number => LANE_OFFSET * smooth(Math.min(clamp((l - LANE_IN) / 60, 0, 1), clamp((LANE_OUT - l) / 60, 0, 1)));

export function stepCar(w: World, c: SimCar, dt: number): void {
  const circ = w.circuit, len = circ.len, k = circ.k, t = w.t;
  if (c.st === "garage" || c.st === "retired") { parked(w, c, dt); return; }
  if (c.st === "grid") {
    if (t < c.launch) return;
    c.st = "race"; c.lapStart = 0; lapStarted(w, c); c.newLap(w.wet);
  }
  if (c.st === "stopped" && t >= c.until) {
    if (c.wrecked) { tow(w, c); return; }
    c.st = "race";
  }
  if (c.box) { servicing(w, c, dt); return; }

  if (!c.inLane && c.wantPit && c.p > len / 2 && c.lane >= LANE_IN) {
    c.inLane = true; c.stopHere = c.wantStop; c.servingPen = !c.wantStop && c.penalty !== null;
    if (c.stopHere && c.id !== w.playerId && w.rnd.random() < 0.008) penalize(w, c, 7, "speeding in the pit lane");
  }

  // the speed this car could hold, then what the others and the pit lane leave of it
  const toBox = c.boxLp - c.lane;
  let free = c.st === "stopped" ? 0 : circ.speed(c.d) * c.pace(t, w.evo, w.wet);
  if (c.st !== "stopped") {
    if (c.inLane) {
      free = Math.min(free, c.stopHere ? Math.min(LANE_V, Math.sqrt(2 * 8 * k * Math.max(0, toBox))) : LANE_V);
      if (!c.stopHere && c.lane > LANE_OUT - 80 && trackBusy(w, c)) free = Math.min(free, Math.sqrt(2 * 8 * k * Math.max(0, LANE_OUT - 8 - c.lane))); // waits at the end of the lane
    }
    else {
      if (w.yellow[c.sector]! > t) free *= 0.8;
      if (c.wantPit && c.p > len / 2) free = Math.min(free, Math.sqrt(LANE_V ** 2 + 2 * 11 * k * Math.max(0, LANE_IN - c.lane)));
    }
  }
  if (w.fcyOn && !c.inLane) free = Math.min(free, FCY_V);
  c.giveWay = yielding(w, c);
  if (c.giveWay) free *= 0.97;
  free = traffic(w, c, free, dt);

  const u = c.v / k, load = circle(Math.abs(c.ay) / (latMax(u) * k * k)); // the car's limits, shared with the corner it is in
  const brMax = c.st === "stopped" ? 22 * k : brakeCap(u) * k * k * 1.1 * load, accMax = accCap(u) * k * k * 1.1 * load;
  const a = clamp((free - c.v) / dt, -brMax, accMax);
  c.a += (a - c.a) * clamp(dt * 15, 0, 1);
  const v0 = c.v;
  c.v = Math.max(0, c.v + a * dt);
  const ds = ((v0 + c.v) / 2) * dt, d0 = c.d, p0 = c.p;
  c.d += ds;
  if (c.finishT === null) c.burn(ds, w.wet);
  const grip = latMax(u) * k * k * 1.03; // past this the tyres slide: the car cannot pull more
  c.ay += (clamp(c.v * c.v * circ.curvature(c.d), -grip, grip) - c.ay) * clamp(dt * 8, 0, 1);
  // Drag slows the car by itself: below that it is a lift, not the brake. Only a real braking zone gets the pedal,
  // and the throttle is full except where the corner asks for the grip.
  const coast = drag(u) * k * k, use = Math.min(1, Math.abs(c.ay) / (latMax(u) * k * k));
  const g = c.a > 0.5 ? 1 : c.a >= -coast ? 1 - 1.6 * Math.max(0, use - 0.5) ** 2 : 0;
  const b = -c.a - coast > 1.2 ? clamp((-c.a - coast) / 13, 0, 1) : 0;
  c.gas += (g - c.gas) * clamp(dt * 12, 0, 1);
  c.brake += (b - c.brake) * clamp(dt * 20, 0, 1);
  if (c === w.player) c.thermal(dt, w.road);

  lateral(w, c, dt);
  if (c.inLane && c.stopHere && c.boxLp - c.lane <= 0.6 && c.v < 1.5) { arrive(w, c); return; }
  if (c.inLane && !c.stopHere && c.lane > LANE_OUT && c.p < len / 2) {
    c.inLane = false;
    if (c.servingPen) { c.servingPen = false; c.penalty = null; w.say(3, c, `#${c.spec.num} penalty served`); }
  }

  const i0 = Math.floor(d0 / len), i1 = Math.floor(c.d / len);
  if (i1 > i0) crossLine(w, c, i1);
  else sectors(w, c);
  mistakes(w, c, p0);
  if (c.st === "limp" && !c.inLane) w.yellow[c.sector] = t + 1500;
}

/** A car on the track is about to pass the end of the lane. */
function trackBusy(w: World, c: SimCar): boolean {
  const len = w.circuit.len;
  return w.cars.some((o) => !o.inLane && o.running && rel(len, c.d, o.d) > -90 && rel(len, c.d, o.d) < 20);
}

/** The nearest car ahead decides the speed: close up behind it, tow, and go past when the pace is there. */
function traffic(w: World, c: SimCar, free: number, dt: number): number {
  const len = w.circuit.len, t = w.t;
  let near: SimCar | null = null, gap = 1e9;
  for (const o of w.cars) {
    if (o === c || o.inLane !== c.inLane || o.box || o.st === "garage" || o.st === "retired") continue;
    const r = mod(o.d - c.d, len);
    if (r > 70 || r - CAR_LEN >= gap) continue;
    if (Math.abs(c.lat - o.lat) >= 2) continue; // alongside, not in the way
    near = o; gap = r - CAR_LEN;
  }
  if (c.pass && w.fcyOn) c.pass = null;
  if (c.pass) {
    const o = w.cars[c.pass.id - 1]!;
    const r = rel(len, c.d, o.d);
    if (r < -(CAR_LEN + 2) || t > c.pass.until || o.inLane !== c.inLane) { c.passCool = r < 0 ? 5 : 2.5; c.pass = null; }
  }
  c.passCool = Math.max(0, c.passCool - dt);
  if (c.pass) free *= 1.025; // the run on the car being passed: late braking, the tow, the better exit
  if (!near) { c.heldFor = Math.max(0, c.heldFor - dt); return free; }
  const o = near, stuck = o.v < 8;
  if (gap < 0.3 && c.v > o.v + 2) collide(w, c, o);
  if (gap > 3 && gap < 32 && free > 35 && c.st === "race") free *= 1 + 0.025 * (1 - gap / 32);
  const brake = 0.7 * brakeCap(c.v / w.circuit.k) * w.circuit.k ** 2; // can always stop behind it if it brakes flat out
  const cap = Math.max(0, Math.min(o.v + (gap - (1.5 + 0.06 * o.v)) * 0.9, Math.sqrt(o.v * o.v + 2 * brake * Math.max(0, gap - 0.5))));
  const held = cap < free && (gap < 10 || (stuck && gap < 45));
  free = Math.min(free, cap);
  c.heldFor = held ? c.heldFor + dt : Math.max(0, c.heldFor - dt);
  if (held && !c.pass && c.passCool <= 0 && !w.fcyOn) {
    const need = stuck ? 0 : c.kind === "push" && o.kind !== "push" ? 0.6 : 2;
    const faster = stuck || c.pace(t, w.evo, w.wet) > o.pace(t, w.evo, w.wet) * 1.002;
    const circ = w.circuit;
    const open = Math.abs(circ.curvature(c.d)) < 0.0035 && Math.abs(circ.curvature(c.d + 90)) < 0.006;
    if (faster && (open || stuck) && c.heldFor >= need && w.rnd.random() < (0.3 + 0.7 * c.spec.aggr) * 1.5 * dt) {
      c.pass = { id: o.id, side: w.rnd.random() < 0.5 ? 1 : -1, until: t + 14000 };
      if (w.rnd.random() < 0.0025) contact(w, c, o);
    }
  }
  return free;
}

function lateral(w: World, c: SimCar, dt: number): void {
  let to = 0;
  if (c.inLane) to = lanePath(c.lane) + (c.stopHere && c.boxLp - c.lane < 20 ? BOX_SIDE * clamp(1 - (c.boxLp - c.lane) / 20, 0, 1) : 0);
  else if (c.pass) to = c.pass.side * 2.3;
  else if (c.giveWay) to = (c.id % 2 ? 1 : -1) * 2.2;
  const next = c.lat + clamp(to - c.lat, -1.6 * dt, 1.6 * dt), len = w.circuit.len;
  for (const o of w.cars) { // never close the side gap on a car that is alongside
    if (o === c || o.inLane !== c.inLane) continue;
    if (Math.abs(rel(len, c.d, o.d)) < CAR_LEN + 1.5 && Math.abs(o.lat - next) < 2 && Math.abs(o.lat - next) < Math.abs(o.lat - c.lat)) return;
  }
  c.lat = next;
}

/** Standing in the lane at its box, not moving. */
function parked(w: World, c: SimCar, dt: number): void {
  c.v = 0; c.a = 0; c.gas = c.brake = 0;
  c.lat += clamp(LANE_OFFSET + BOX_SIDE - c.lat, -1.6 * dt, 1.6 * dt);
  if (c.st !== "garage" || w.kind === "race" || c.finishT !== null || w.t < c.releaseAt || w.t - w.lastRelease < 3500) return;
  if (w.durMs - w.t < c.lapSec * 1000 * 1.2) { c.releaseAt = Infinity; return; }
  w.lastRelease = w.t;
  c.st = "race"; c.stopHere = false; c.wantPit = c.wantStop = false; c.runLap = 0;
  if (c.boxLp >= 0) { c.lapStart = w.t; c.out = true; c.secIdx = c.sector; lapStarted(w, c); c.newLap(w.wet); }
}

function servicing(w: World, c: SimCar, dt: number): void {
  const b = c.box!;
  c.v = 0; c.a = 0; c.gas = c.brake = 0;
  c.lat += clamp(LANE_OFFSET + BOX_SIDE - c.lat, -1.6 * dt, 1.6 * dt);
  c.fuel = b.fuel0 + clamp((w.t - b.t0 - SERVICE_START_MS) / REFUEL_MS_PER_L, 0, b.add);
  if (w.t < b.end) return;
  c.fuel = b.fuelEnd;
  if (b.tyres) c.freshTyres(b.wet);
  if (b.repair) { c.damage = [0, 0, 0, 0, 0]; c.suspDamage = [0, 0, 0, 0]; }
  c.pits++; c.box = null; c.stopHere = false; c.wantPit = c.wantStop = false;
  afterStop(w, c, b);
  if (b.park || (w.kind !== "race" && w.durMs - w.t < c.lapSec * 1000 * 0.9)) { c.st = "garage"; c.releaseAt = Infinity; }
}

/** The car is at its box: stop for service, or park (a car that has finished, or is out of the race). */
function arrive(w: World, c: SimCar): void {
  c.v = 0; c.a = 0;
  if (c.st === "limp" && c.fuel > 0) { c.st = "retired"; c.stopHere = false; w.say(3, c, `#${c.spec.num} retired`); return; }
  if (c.st === "limp") c.st = "race";
  if (c.st === "finished") { c.st = "garage"; c.stopHere = false; c.releaseAt = Infinity; return; }
  c.box = service(w, c);
}

function sectors(w: World, c: SimCar): void {
  const s = c.sector;
  if (s === c.secIdx) return;
  if (s === c.secIdx + 1 && c.lapStart !== null) {
    c.splits.push(w.t - c.lapStart);
    c.lastSector = c.splits.length === 1 ? c.splits[0]! : c.splits[c.splits.length - 1]! - c.splits[c.splits.length - 2]!;
  }
  c.secIdx = s;
}

function crossLine(w: World, c: SimCar, idx: number): void {
  if (idx >= 1 && c.lapStart !== null) {
    const ms = Math.round(w.t - c.lapStart);
    const s0 = c.splits[0] ?? null, s1 = c.splits[1] ?? null;
    const sec = [s0 === null ? null : Math.round(s0), s0 === null || s1 === null ? null : Math.round(s1 - s0),
      s1 === null ? null : ms - Math.round(s1)];
    const lap: Lap = { ms, s: sec, valid: c.valid, out: c.out, in: c.inLane };
    c.last = lap; c.laps++;
    c.lastSector = sec[2] ?? c.lastSector;
    if (lap.valid && !lap.out && !lap.in && (!c.best || ms < c.best.ms!)) c.best = lap;
    w.lapDone(c, lap);
    if (lap.in) c.runLap = 0;
  }
  if (idx === 0 && c.lapStart !== null) return; // a grid car's first lap began with the lights
  c.lapStart = w.t; c.splits = []; c.secIdx = 0; c.valid = true; c.out = c.inLane;
  if (w.ending(c)) { finish(w, c); return; }
  lapStarted(w, c);
  c.newLap(w.wet);
}

/** The chequered flag: one more lap in, then to the box. */
function finish(w: World, c: SimCar): void {
  c.finishT = w.t; c.finishRank = ++w.finished;
  c.st = "finished"; c.wantPit = c.wantStop = true; c.kind = "race";
}

function mistakes(w: World, c: SimCar, p0: number): void {
  const p1 = c.p, crossed = (at: number | null) => at !== null && p1 >= p0 && p0 <= at && at < p1;
  if (crossed(c.slipAt)) {
    c.slipAt = null; c.slipUntil = w.t + 2200;
    if (w.rnd.random() < 0.55) { c.valid = false; if (w.kind === "race" && ++c.cuts >= 2) { c.cuts = 0; penalize(w, c, 1, "track limits"); } }
  }
  if (crossed(c.troubleAt) && c.st === "race") {
    c.troubleAt = null;
    if (c.troubleKind === "spin") spin(w, c);
    else { c.st = "limp"; c.wantPit = c.wantStop = true; w.say(3, c, `#${c.spec.num} slow with a problem`); }
  }
}

export function spin(w: World, c: SimCar): void {
  c.st = "stopped"; c.until = w.t + w.rnd.uniform(4000, 9000); c.valid = false;
  c.damage[w.rnd.randint(0, 4)]! += w.rnd.uniform(3, 28);
  c.suspDamage[w.rnd.randint(0, 3)]! += w.rnd.uniform(0, 0.05);
  c.tyreDist += w.circuit.len * 0.04;
  c.pass = null; c.heldFor = 0;
  if (w.kind === "race" && !w.fcyOn && w.rnd.random() < 0.2) { // a hard hit: the car is wrecked and has to be recovered
    c.wrecked = true; c.until = w.t + w.rnd.uniform(35000, 60000);
    c.damage[w.rnd.randint(0, 4)]! += w.rnd.uniform(40, 90);
    w.startFcy(c.until - w.t);
  }
  w.yellow[c.sector] = c.until + 8000;
  w.say(4, c, "");
}

/** The marshals take the wrecked car off the track and into its garage. */
function tow(w: World, c: SimCar): void {
  const len = w.circuit.len;
  c.d = Math.floor(c.d / len) * len + (c.boxLp < 0 ? len + c.boxLp : c.boxLp);
  c.v = c.a = 0; c.inLane = true; c.box = null; c.pass = null; c.st = "retired"; c.wrecked = false;
  w.say(3, c, `#${c.spec.num} recovered, out of the race`);
}

/** Races only: a drive-through to serve within three laps, or a time added after the flag. */
function penalize(w: World, c: SimCar, id: number, why: string): void {
  if (w.kind !== "race" || c.penalty) return;
  c.penalty = { id, due: c.laps + 3 };
  w.say(3, c, `#${c.spec.num} drive-through: ${why}`);
}

/** A lapped car with the leaders coming up behind it, on a straight, moves over and lifts. */
function yielding(w: World, c: SimCar): boolean {
  if (w.kind !== "race" || c.inLane || c.st !== "race") return false;
  const len = w.circuit.len;
  if (Math.abs(w.circuit.curvature(c.d)) > 0.004) return false;
  return w.cars.some((o) => o !== c && !o.inLane && o.st === "race" && o.dist > c.dist + 0.98 && mod(c.d - o.d, len) > 3 && mod(c.d - o.d, len) < 70);
}

/** Ran into the back of a slower car: both are hurt, and the car behind goes round. */
function collide(w: World, c: SimCar, o: SimCar): void {
  c.v = o.v + (c.v - o.v) * 0.3;
  if (w.kind === "race") { c.timePen += 5000; w.say(3, c, `#${c.spec.num} +5 s: causing a collision`); }
  o.damage[w.rnd.randint(0, 4)]! += w.rnd.uniform(2, 14);
  c.damage[w.rnd.randint(0, 4)]! += w.rnd.uniform(4, 24);
  c.valid = false;
  c.pass = { id: o.id, side: w.rnd.random() < 0.5 ? 1 : -1, until: w.t + 8000 };
  w.say(4, c, "");
}

function contact(w: World, c: SimCar, o: SimCar): void {
  o.damage[w.rnd.randint(0, 4)]! += w.rnd.uniform(2, 12);
  c.damage[w.rnd.randint(0, 4)]! += w.rnd.uniform(2, 12);
  c.valid = false;
  if (w.rnd.random() < 0.5) spin(w, c);
  else w.say(4, c, "");
}
