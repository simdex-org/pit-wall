import { describe, expect, it } from "vitest";
import { clean, driverOf, nameOf, swapAt } from "./team";

describe("team stints", () => {
  const t = clean({ names: ["Ana", "", "Cal"], spd: 2 });
  it("hands stints to drivers in turn, spd in a row", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => driverOf(t, n))).toEqual([0, 0, 1, 1, 2, 2, 0]);
  });
  it("starts with the chosen driver", () => {
    expect([1, 2, 3].map((n) => driverOf({ ...t, first: 2 }, n))).toEqual([2, 2, 0]);
  });
  it("finds the stops where the driver changes", () => {
    expect(swapAt(t, 1)).toBeNull();
    expect(swapAt(t, 2)).toEqual({ from: 0, to: 1 });
    expect(swapAt(t, 6)).toEqual({ from: 2, to: 0 });
  });
  it("solo never swaps", () => {
    expect(swapAt(clean({}), 3)).toBeNull();
  });
  it("names fall back to D#, and bad input is cleaned", () => {
    expect(nameOf(t, 1)).toBe("D2");
    expect(nameOf(t, 0)).toBe("Ana");
    expect(clean({ names: ["<b>x</b>"], spd: 99, maxStintMin: -5 })).toMatchObject({ names: ["bx/b"], spd: 10, maxStintMin: null });
  });
});
