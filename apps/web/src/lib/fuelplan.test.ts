import { describe, expect, it } from "vitest";
import { fuelPlan, PlanInputs } from "./fuelplan";

const base: PlanInputs = {
  raceMin: 180, raceLaps: null, extra: 0, lapS: 108, fpl: 3, cap: 120, reserve: 1, formL: 3, mand: 0, maxStintMin: null, lossS: 25,
  refuelSpl: 0.25, tyreS: 30, tyres: true, seq: false, minStat: 0, wt: 0,
};

describe("fuelPlan", () => {
  it("splits a three hour race into two stops that fit the tank", () => {
    const p = fuelPlan(base);
    expect(p.total).toBe(100);
    expect(p.best!.n).toBe(2);
    expect(p.best!.stints.every((s) => s.load <= 120)).toBe(true);
    expect(p.best!.stints.reduce((a, s) => a + s.laps, 0)).toBe(100);
  });

  it("is forced to the mandatory stop count", () => {
    expect(fuelPlan({ ...base, mand: 3 }).best!.n).toBe(3);
  });

  it("needs no stop for a short race", () => {
    const p = fuelPlan({ ...base, raceMin: null, raceLaps: 30 });
    expect(p.best!.n).toBe(0);
    expect(p.best!.start).toBe(30 * 3 + 3 + 3);
    expect(p.save).toBeNull();
  });

  it("says what consumption saves a stop", () => {
    const p = fuelPlan({ ...base, raceMin: null, raceLaps: 40 });
    expect(p.best!.n).toBe(1);
    expect(p.save!.fpl).toBeLessThan(3);
  });

  it("returns nothing without a consumption", () => {
    expect(fuelPlan({ ...base, fpl: 0 }).total).toBeNull();
  });

  it("builds a plan for stop laps chosen by hand and bounds a stint by the tank", () => {
    const p = fuelPlan(base), o = p.build([34, 67]);
    expect(o.stints.map((t) => t.laps)).toEqual([34, 33, 33]);
    expect(o.stints.map((t) => t.from - 1)).toEqual([0, 34, 67]);
    expect(o.stints[1]!.add).toBe(99);
    expect(o.tank).toBe(true);
    expect(p.maxStint.rest).toBe(39);
    expect(p.build([60]).tank).toBe(false);
  });

  it("plans a 24 hour race with many stops", () => {
    const p = fuelPlan({ ...base, raceMin: 1440, mand: 60, cap: 60, fpl: 3, reserve: 0.5 });
    expect(p.best!.n).toBe(60);
    expect(p.options.some((o) => o === p.best)).toBe(true);
  });

  it("keeps every stint inside the max driver stint in whole laps", () => {
    const p = fuelPlan({ ...base, raceLaps: 164, lapS: 535.1, maxStintMin: 75, cap: 120, fpl: 3.43, formL: 0 });
    expect(p.best!.n).toBe(20);
    expect(Math.max(...p.best!.stints.map((t) => t.laps))).toBeLessThanOrEqual(8);
  });

  it("full stints fill the max stint and leave the rest to the last one", () => {
    const p = fuelPlan({ ...base, raceLaps: 164, lapS: 535.1, maxStintMin: 75, cap: 120, fpl: 3.43, formL: 0 });
    const o = p.full(20);
    expect(o.stints.map((t) => t.laps)).toEqual([...Array(20).fill(8), 4]);
    expect(o.ok).toBe(true);
  });
});
