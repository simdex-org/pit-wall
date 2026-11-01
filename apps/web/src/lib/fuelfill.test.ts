import { describe, expect, it } from "vitest";
import { fromLaps } from "./fuelfill";

describe("fromLaps", () => {
  it("averages the clean laps near the best and skips pit, invalid and slow laps", () => {
    const r = fromLaps([
      { ms: 100000, valid: true, fuel: 3 }, { ms: 101000, valid: true, fuel: 3.2 }, { ms: 99000, valid: false, fuel: 9 },
      { ms: 130000, valid: true, fuel: 2 }, { ms: 100500, valid: true, in: true, fuel: 1 }, { ms: 100500, valid: true, fuel: null },
    ]);
    expect(r).toEqual({ lap: "1:40.500", fpl: "3.10", n: 3 });
  });

  it("gives nothing without a clean lap", () => {
    expect(fromLaps([{ ms: 100000, valid: false }])).toEqual({ lap: null, fpl: null, n: 0 });
  });
});
