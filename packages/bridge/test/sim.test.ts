import { describe, expect, test } from "vitest";
import { Box, CAR_LEN, TANK } from "../src/sim/car.js";
import { World } from "../src/sim/world.js";
import { mod } from "../src/util.js";

/** Runs a session in 1/60 s steps until the stop condition holds, calling look every simulated second. */
function run(w: World, until: (w: World) => boolean, look: (w: World) => void = () => {}): void {
  let n = 0;
  while (!until(w)) { w.step(); if (++n % 60 === 0) look(w); }
}

describe("simulated race", { timeout: 60000 }, () => {
  const w = new World("race", { seed: 2 });
  const lapMs = w.circuit.lapMs;
  const tooClose: string[] = [];
  let overlapping = new Set<string>();
  const lapsSeen: { ms: number; kind: string }[] = [];
  let maxPass = 0, maxDamage = 0, minFuel = TANK, yellow = false, gridOrder: number[] = [];
  const flagged = new Set<number>();
  const stopLaps: number[] = [], greenLaps: number[] = [];
  const lapDone = w.lapDone.bind(w);
  w.lapDone = (c, lap) => {
    lapDone(c, lap);
    if (lap.ms && c.kind === "race" && c.st === "race" && lap.valid) (lap.in || lap.out ? stopLaps : greenLaps).push(lap.ms);
  };

  run(w, (x) => x.phase >= 7, (x) => {
    if (x.t < 0 && !gridOrder.length) gridOrder = x.cars.map((c) => c.id);
    for (const c of x.cars) {
      minFuel = Math.min(minFuel, c.fuel);
      if (c.pass) maxPass++;
      maxDamage = Math.max(maxDamage, c.damageSum);
      if (c.finishT !== null) flagged.add(c.id);
    }
    if (x.yellow.some((u) => u > x.t)) yellow = true;
    const now = new Set<string>();
    for (const a of x.cars) for (const b of x.cars) {
      if (a.id >= b.id || a.inLane !== b.inLane || !a.running || !b.running || a.box || b.box || x.t < 0) continue;
      const gap = Math.abs(mod(a.d - b.d + x.circuit.len / 2, x.circuit.len) - x.circuit.len / 2);
      if (gap < CAR_LEN * 0.6 && Math.abs(a.lat - b.lat) < 1.2 && (a.v > 5 || b.v > 5)) {
        const key = `${a.id}/${b.id}`;
        now.add(key);
        if (overlapping.has(key)) tooClose.push(`${key} at ${(x.t / 1000).toFixed(0)} s, ${gap.toFixed(1)} m`); // in each other for a second
      }
    }
    overlapping = now;
  });
  for (const c of w.cars) if (c.best?.ms) lapsSeen.push({ ms: c.best.ms, kind: String(c.spec.gt4) });

  test("the lights go out, a lap takes about the reference time, GT4 is slower", () => {
    const best = w.best!;
    expect(best.ms).toBeGreaterThan(lapMs * 0.95);
    expect(best.ms).toBeLessThan(lapMs * 1.03);
    const gt3 = lapsSeen.filter((l) => l.kind === "false").map((l) => l.ms), gt4 = lapsSeen.filter((l) => l.kind === "true").map((l) => l.ms);
    expect(Math.min(...gt4)).toBeGreaterThan(Math.min(...gt3) * 1.04);
  });

  test("everyone stops in the window, nobody runs dry, the flag ends it", () => {
    expect(minFuel).toBeGreaterThan(0);
    const finishers = w.cars.filter((c) => c.finishT !== null);
    expect(finishers.length).toBeGreaterThanOrEqual(14);
    for (const c of finishers) {
      expect(c.pits).toBeGreaterThanOrEqual(1);
      expect(c.mandatoryDone).toBe(true);
    }
    expect(w.leaderDone).toBe(true);
    const order = w.rank().filter((c) => c.finishT !== null);
    expect(order[0]!.laps).toBeGreaterThanOrEqual(order[order.length - 1]!.laps);
    for (let i = 1; i < order.length; i++) {
      if (order[i]!.laps === order[i - 1]!.laps) expect(order[i]!.finishT! + order[i]!.timePen).toBeGreaterThanOrEqual(order[i - 1]!.finishT! + order[i - 1]!.timePen);
      else expect(order[i]!.laps).toBeLessThan(order[i - 1]!.laps);
    }
  });

  test("there is racing: cars follow, pass, spin, and the field gets yellow flags", () => {
    expect(maxPass).toBeGreaterThan(30);
    expect(yellow).toBe(true);
    expect(maxDamage).toBeGreaterThan(0);
  });

  test("cars do not drive through each other", () => {
    expect(tooClose.slice(0, 5)).toEqual([]);
  });

  test("a stop costs the time of the lane plus the box", () => {
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    expect(stopLaps.length).toBeGreaterThan(15);
    expect(mean(stopLaps) - mean(greenLaps)).toBeGreaterThan(12000);
  });

  test("the session restarts after the results", () => {
    expect(w.idx).toBe(0);
    run(w, (x) => x.idx === 1);
    expect(w.t).toBeLessThan(0);
    expect(w.cars.every((c) => c.laps === 0 && c.st === "grid")).toBe(true);
    expect(w.best).toBeNull();
    expect(gridOrder).toHaveLength(20);
  });
});

describe("simulated qualifying", () => {
  const w = new World("quali");
  const seen = new Set<string>();
  run(w, (x) => x.phase >= 7, (x) => { for (const c of x.cars) seen.add(`${c.id}:${c.kind}`); });

  test("every car runs out, push, in; out and in laps are never the best", () => {
    expect(w.cars.filter((c) => c.best).length).toBeGreaterThanOrEqual(18);
    for (const c of w.cars) {
      if (c.best) { expect(c.best.out).toBe(false); expect(c.best.in).toBe(false); expect(c.best.valid).toBe(true); }
    }
    expect([...seen].some((s) => s.endsWith(":push"))).toBe(true);
    expect([...seen].some((s) => s.endsWith(":in"))).toBe(true);
    expect([...seen].some((s) => s.endsWith(":out"))).toBe(true);
  });

  test("the order is the best lap; the cars come in after the flag", () => {
    const r = w.rank();
    const bests = r.map((c) => c.best?.ms).filter((x): x is number => !!x);
    expect(bests).toEqual([...bests].sort((a, b) => a - b));
    expect(w.cars.every((c) => c.st === "garage" || c.st === "retired" || c.finishT !== null)).toBe(true);
    expect(w.best!.ms).toBe(bests[0]);
  });
});

describe("the clock", { timeout: 60000 }, () => {
  test("the same session whatever the chunking of time", () => {
    const a = new World("race", { seed: 3 }), b = new World("race", { seed: 3 });
    a.sync(0); b.sync(0);
    for (let i = 1; i <= 900; i++) a.sync(i / 10);
    for (let i = 1; i <= 90; i++) b.sync(i);
    expect(a.t).toBeCloseTo(b.t, 6);
    expect(a.cars.map((c) => c.d)).toEqual(b.cars.map((c) => c.d));
  });

  test("a stop takes the fuel the pit page asked for", () => {
    const w = new World("race", { seed: 5 });
    let seen: Box | null = null;
    w.customize = (box) => { box.add = 33; seen = box; };
    run(w, (x) => x.player.pits > 0 || x.t > 3500000);
    expect(w.player.pits).toBe(1);
    expect(w.player.stopTimes.length).toBe(0);
    const box = seen as unknown as Box;
    expect(box.fuelEnd - box.fuel0).toBeCloseTo(33, 6);
    expect(box.end - box.t0).toBeGreaterThan(33 * 300);
  });

  test("a real layout runs: the Nordschleife", () => {
    const w = new World("race", { track: "nordschleife" });
    run(w, (x) => x.t > 12 * 60000);
    expect(w.player.laps).toBeGreaterThanOrEqual(1);
    expect(w.circuit.len).toBeCloseTo(25378, 0);
    expect(w.cars.every((c) => Number.isFinite(c.d) && c.fuel >= 0)).toBe(true);
  });
});

describe("a weekend", { timeout: 120000 }, () => {
  test("practice, qualifying and the race follow each other, and the race grid is qualifying's order", () => {
    const w = new World("practice", { sequence: ["practice", "quali", "race"], minutes: 6 });
    const kinds: string[] = [];
    let qualiOrder: number[] = [], gridOrder: number[] = [];
    while (w.idx < 3) {
      if (kinds[kinds.length - 1] !== w.kind) kinds.push(w.kind);
      if (w.kind === "quali" && w.phase === 7) qualiOrder = w.rank().map((c) => c.id);
      if (w.kind === "race" && w.t > -1000 && !gridOrder.length) gridOrder = [...w.cars].sort((a, b) => b.d - a.d).map((c) => c.id);
      w.step();
    }
    expect(kinds).toEqual(["practice", "quali", "race"]);
    expect(gridOrder).toEqual(qualiOrder);
  });
});

describe("weather, flags and penalties", { timeout: 120000 }, () => {
  const messages: string[] = [];
  const fcySpeeds: number[] = [];
  let wetCars = 0, wetPeak = 0, fcyRuns = 0, wasFcy = false, rainSeen = false;
  let rain = new World("race");
  for (let seed = 1; seed <= 16 && wetCars < 15; seed++) { // the first race the weather turns wet in
    rain = new World("race", { seed, minutes: 40 });
    messages.length = 0; rainSeen = false; wetPeak = wetCars = 0;
    const say = rain.say.bind(rain);
    rain.say = (type, c, msg) => { say(type, c, msg); if (msg) messages.push(msg); };
    run(rain, (x) => x.phase >= 7, (x) => {
      rainSeen = rainSeen || x.rain > 0.2;
      wetPeak = Math.max(wetPeak, x.wet);
      wetCars = Math.max(wetCars, x.cars.filter((c) => c.wetTyres).length);
    });
  }

  let fcy = new World("race");
  for (let seed = 1; seed <= 16 && !fcyRuns; seed++) { // the first race with a wreck
    fcy = new World("race", { seed, minutes: 30 });
    fcySpeeds.length = 0; wasFcy = false;
    run(fcy, (x) => x.phase >= 7, (x) => {
      if (x.fcyOn && !wasFcy) fcyRuns++;
      wasFcy = x.fcyOn;
      if (x.fcyOn) for (const c of x.cars) if (c.st === "race" && !c.inLane) fcySpeeds.push(c.v * 3.6);
    });
  }

  test("a shower wets the track, the teams switch to wets", () => {
    expect(rainSeen).toBe(true);
    expect(wetPeak).toBeGreaterThan(0.3);
    expect(wetCars).toBeGreaterThanOrEqual(15);
  });

  test("wet tyres are quicker than slicks on a wet track, slicks quicker on a dry one", () => {
    const c = new World("race").player;
    const dry = c.pace(0, 0, 0), damp = c.pace(0, 0, 0.5);
    expect(damp).toBeLessThan(dry * 0.95);
    c.wetTyres = true;
    expect(c.pace(0, 0, 0.8)).toBeGreaterThan(damp);
    expect(c.pace(0, 0, 0)).toBeLessThan(dry);
  });

  test("a wreck brings the full course yellow: the field slows down, then goes green", () => {
    expect(fcyRuns).toBeGreaterThanOrEqual(1);
    expect(fcy.cars.some((c) => c.st === "retired")).toBe(true);
    const slow = fcySpeeds.filter((v) => v < 90).length / fcySpeeds.length;
    expect(slow).toBeGreaterThan(0.9);
    expect(fcy.fcyOn).toBe(false);
  });

  test("penalties are given, served in the lane or turned into time, and change the result", () => {
    const given = messages.filter((m) => m.includes("drive-through:") || m.includes("collision"));
    const closed = messages.filter((m) => m.includes("penalty served") || m.includes("not served"));
    expect(given.length).toBeGreaterThan(0);
    expect(closed.length).toBeGreaterThan(0);
    expect(rain.cars.every((c) => c.penalty === null || c.laps <= c.penalty.due + 1)).toBe(true);
  });
});

describe("the pedals", () => {
  test("full throttle where the car is not slowing for a corner, the brake only in a braking zone, never both", () => {
    const w = new World("race", { seed: 2, track: "monza" });
    let fullThrottle = 0, straight = 0, fullOnStraight = 0, brakeOnStraight = 0, braking = 0, both = 0, hardBrakes = 0, n = 0;
    run(w, (x) => x.t > 4 * 60000, (x) => {
      for (const c of x.cars) {
        if (c.st !== "race" || c.inLane || x.t < 20000) continue;
        n++;
        if (c.gas > 0.3 && c.brake > 0.3) both++;
        if (Math.abs(c.ay) < 3 && c.a > -1) { straight++; if (c.gas > 0.95) fullOnStraight++; if (c.brake > 0.05) brakeOnStraight++; }
        if (c.brake > 0.05) braking++;
        if (c.gas > 0.95) fullThrottle++;
        if (c.brake > 0.5) hardBrakes++;
      }
    });
    expect(both / n).toBeLessThan(0.005);
    expect(fullOnStraight / straight).toBeGreaterThan(0.6);
    expect(brakeOnStraight / straight).toBeLessThan(0.03);
    expect(hardBrakes).toBeGreaterThan(0);
    expect(braking / n).toBeLessThan(0.3); // a GT3 lap is not mostly braking
    expect(fullThrottle / n).toBeGreaterThan(0.5);
  });
});

describe("flags", () => {
  test("no yellow on the grid or in a clean start", () => {
    const w = new World("race", { seed: 2 });
    run(w, (x) => x.t > 15000, (x) => { expect(x.yellow.some((u) => u > x.t)).toBe(false); });
  });
});

describe("the drivers", () => {
  test("every driver has their own traits, and the player is no better placed than the rest", () => {
    const ranks = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const w = new World("race", { seed });
      const specs = w.cars.map((c) => c.spec);
      for (const k of ["aggr", "defence", "comp", "tyreMgmt", "fuelSave", "wetSkill", "quali", "start", "crew"] as const) {
        expect(new Set(specs.map((x) => x[k])).size).toBeGreaterThan(5);
        expect(Math.min(...specs.map((x) => x[k]))).toBeGreaterThanOrEqual(0);
        expect(Math.max(...specs.map((x) => x[k]))).toBeLessThanOrEqual(1);
      }
      ranks.add(specs.filter((x) => x.delta < w.player.spec.delta).length);
    }
    expect(ranks.size).toBeGreaterThanOrEqual(6);
  });
});

describe("a bigger, mixed field", { timeout: 60000 }, () => {
  const w = new World("race", { track: "nurburgring", field: { cars: 40, mix: { GT3: 60, GT4: 20, GTC: 10, GT2: 10 } } });
  run(w, (x) => x.t > 6 * 60000);

  test("the classes add up, each at its own pace, with their own cars and numbers", () => {
    const by = (cls: string) => w.cars.filter((c) => c.spec.cls === cls);
    expect(w.cars).toHaveLength(40);
    expect(["GT3", "GT4", "GTC", "GT2"].map((k) => by(k).length)).toEqual([24, 8, 4, 4]);
    expect(w.player.spec.cls).toBe("GT3");
    expect(new Set(w.cars.map((c) => c.spec.num)).size).toBe(40);
    const mean = (cls: string) => by(cls).reduce((a, c) => a + c.spec.delta, 0) / by(cls).length;
    expect(mean("GT2")).toBeLessThan(mean("GT3"));
    expect(mean("GT3")).toBeLessThan(mean("GT4"));
    expect(mean("GT4")).toBeLessThan(mean("GTC"));
  });

  test("every pit box is inside the lane and nobody is stuck", () => {
    expect(w.cars.every((c) => c.boxLp > -240 && c.boxLp < 210)).toBe(true);
    expect(new Set(w.cars.map((c) => c.boxLp)).size).toBe(40);
    expect(w.cars.every((c) => Number.isFinite(c.d) && c.fuel >= 0)).toBe(true);
    expect(w.cars.filter((c) => c.laps >= 2).length).toBeGreaterThan(30);
  });
});
