import { describe, expect, test } from "vitest";
import { expectedFuel, nextStop, type RacePlan } from "./racePlan";

const plan: RacePlan = {
  total: 20, fpl: 2, tyres: false,
  stints: [
    { n: 1, laps: 10, from: 1, to: 10, load: 24, add: null, stat: 0 },
    { n: 2, laps: 10, from: 11, to: 20, load: 24, add: 20, stat: 8 },
  ],
};

describe("race plan", () => {
  test("the next stop is the first one not yet made", () => {
    expect(nextStop(plan, 0)).toEqual({ n: 1, lap: 10, add: 20 });
    expect(nextStop(plan, 1)).toBeNull();
    expect(nextStop(null, 0)).toBeNull();
  });

  test("expected fuel falls by the burn through a stint and resets at the stop", () => {
    expect(expectedFuel(plan, 1)).toBe(24);
    expect(expectedFuel(plan, 10)).toBe(6);
    expect(expectedFuel(plan, 11)).toBe(24);
    expect(expectedFuel(plan, 21)).toBeNull();
    expect(expectedFuel(plan, null)).toBeNull();
  });
});
