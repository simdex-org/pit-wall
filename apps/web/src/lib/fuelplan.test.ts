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
});
