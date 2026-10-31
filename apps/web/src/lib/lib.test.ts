import { describe, expect, test } from "vitest";
import { fmtAgo, fmtClock, fmtDelta, fmtGap, fmtLap, fmtRel, fmtSector, MINUS, NONE, plural, signed } from "./format";
import { DEFAULT_THRESHOLDS, brakeState, fuelState, padState, pressState, StateCtx, tyreState, waterState } from "./states";
import { fv } from "./units";

describe("format", () => {
  test("lap times", () => {
    expect(fmtLap(83456)).toBe("1:23.456");
    expect(fmtLap(59999.6)).toBe("0:59.999");
    expect(fmtLap(0)).toBe(NONE);
    expect(fmtLap(null)).toBe(NONE);
    expect(fmtLap(3.6e6)).toBe(NONE);
    expect(fmtSector(24123)).toBe("24.123");
    expect(fmtSector(61000)).toBe("1:01.000");
  });
  test("deltas use a real minus and an unsigned zero", () => {
    expect(fmtDelta(-1234)).toBe(`${MINUS}1.234`);
    expect(fmtDelta(250)).toBe("+0.250");
    expect(fmtDelta(0.2)).toBe("0.000");
    expect(signed(-3.14159, 2)).toBe(`${MINUS}3.14`);
    expect(signed(0, 2)).toBe("0.00");
  });
  test("gaps, intervals and clocks", () => {
    expect(fmtGap(1234)).toBe("+1.23");
    expect(fmtGap(12345)).toBe("+12.3");
    expect(fmtGap(null, 2)).toBe("+2L");
    expect(fmtRel(-1500)).toBe("1.50");
    expect(fmtClock(3723000)).toBe("1:02:03");
    expect(fmtClock(-1)).toBe(NONE);
    expect(fmtAgo(900)).toBe("now");
    expect(fmtAgo(30000)).toBe("30 s");
    expect(plural(1, "lap")).toBe("1 lap");
    expect(plural(3, "lap")).toBe("3 laps");
  });
});

describe("states", () => {
  const c: StateCtx = { th: DEFAULT_THRESHOLDS, wet: false, fuelLowLaps: 3 };
  test("pressure windows follow the compound", () => {
    expect(pressState(26.5, c)).toBe("ok");
    expect(pressState(25, c)).toBe("cold");
    expect(pressState(27.5, c)).toBe("warn");
    expect(pressState(28.5, c)).toBe("bad");
    expect(pressState(30, { ...c, wet: true })).toBe("ok");
    expect(pressState(0, c)).toBe("none");
  });
  test("temperatures, pads, fuel and water", () => {
    expect(tyreState(90, c)).toBe("ok");
    expect(tyreState(60, c)).toBe("cold");
    expect(tyreState(120, c)).toBe("bad");
    expect(brakeState(800, "front", c)).toBe("bad");
    expect(brakeState(700, "rear", c)).toBe("warn");
    expect(padState(10, c)).toBe("bad");
    expect(padState(14, c)).toBe("warn");
    expect(fuelState(2, c)).toBe("bad");
    expect(fuelState(4, c)).toBe("warn");
    expect(fuelState(9, c)).toBe("ok");
    expect(waterState(110, c)).toBe("warn");
  });
});

describe("units", () => {
  test("converts for display only", () => {
    expect(fv("speed", 100, { speed: "mph", temp: "c", press: "psi" })).toBe("62");
    expect(fv("temp", 100, { speed: "kmh", temp: "f", press: "psi" })).toBe("212");
    expect(fv("press", 27.5)).toBe("27.5");
    expect(fv("press", 27.5, { speed: "kmh", temp: "c", press: "bar" })).toBe("1.90");
    expect(fv("speed", null)).toBe(NONE);
  });
});
