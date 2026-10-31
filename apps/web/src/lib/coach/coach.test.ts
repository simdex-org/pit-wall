import { describe, expect, test } from "vitest";
import { findCorners, LapBins, NB, zoneTime } from "./measure";
import { buildReport } from "./report";

// A lap with two corners (bins 100 and 300). `brakeAt` is the bin where braking starts for the first one.
function lap(brakeAt: number, secs = 90): LapBins {
  const speed = new Float32Array(NB), brk = new Float32Array(NB), thr = new Float32Array(NB), t = new Float32Array(NB);
  for (let i = 0; i < NB; i++) {
    const d = Math.min(Math.abs(i - 100), Math.abs(i - 300));
    speed[i] = Math.min(250, 90 + d * 4);
    brk[i] = i >= brakeAt && i < 100 ? 1 : 0;
    thr[i] = i > 100 && i < 200 || i > 300 ? 1 : 0;
    t[i] = (i / (NB - 1)) * secs * 1000;
  }
  return { speed, brk, thr, t };
}

describe("lap coach", () => {
  test("finds the two corners and tiles the lap", () => {
    const cs = findCorners([lap(80), lap(80)]);
    expect(cs.map((c) => c.apex)).toEqual([100, 300]);
    expect(zoneTime(lap(80), cs[0]!) + zoneTime(lap(80), cs[1]!)).toBeCloseTo(90, 0);
  });

  test("a slower zone is reported with braking as the cause", () => {
    const fast = lap(90), slow = lap(70, 91);
    const cs = findCorners([fast, slow]);
    const rep = buildReport(cs, slow, [fast, slow], (v) => v, "km/h");
    expect(rep.total).toBeGreaterThan(0);
    expect(rep.focus[0]!.cause).toMatch(/early|Time lost/);
  });
});
