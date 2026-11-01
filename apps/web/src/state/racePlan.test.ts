import { describe, expect, it } from "vitest";
import { expectedFuel, nextStop, RacePlan } from "./racePlan";

const plan: RacePlan = {
  total: 30, fpl: 3, tyres: true,
  stints: [
    { n: 1, laps: 10, from: 1, to: 10, load: 34, add: null, stat: 0 },
    { n: 2, laps: 10, from: 11, to: 20, load: 33, add: 30, stat: 8 },
    { n: 3, laps: 10, from: 21, to: 30, load: 33, add: 30, stat: 8 },
  ],
};

describe("race plan", () => {
  it("finds the next stop at or after this lap", () => {
    expect(nextStop(plan, 4)).toEqual({ lap: 10, add: 30, n: 1 });
    expect(nextStop(plan, 10)?.lap).toBe(10);
    expect(nextStop(plan, 11)?.lap).toBe(20);
    expect(nextStop(plan, 21)).toBeNull();
    expect(nextStop(null, 4)).toBeNull();
  });
  it("works out the fuel expected at the start of a lap", () => {
    expect(expectedFuel(plan, 1)).toBe(34);
    expect(expectedFuel(plan, 5)).toBe(22);
    expect(expectedFuel(plan, 11)).toBe(33);
    expect(expectedFuel(plan, 31)).toBeNull();
  });
});
