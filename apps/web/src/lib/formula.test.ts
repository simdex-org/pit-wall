import { describe, expect, test } from "vitest";
import { evaluate, flatten, FormulaError, level, names } from "./formula";

describe("custom figure formulas", () => {
  const vars = { fuel_litres: 30, fuel_per_lap: 4, tyre_pressure_psi_fl: 27.5, tyre_pressure_psi_rr: 26.9 };

  test("arithmetic with precedence, brackets, unary minus and names", () => {
    expect(evaluate("fuel_litres / fuel_per_lap", vars)).toBe(7.5);
    expect(evaluate("1 + 2 * 3", {})).toBe(7);
    expect(evaluate("(1 + 2) * 3", {})).toBe(9);
    expect(evaluate("-2 * -3 + .5", {})).toBe(6.5);
    expect(evaluate("FUEL_LITRES - 10", vars)).toBe(20);
  });

  test("functions", () => {
    expect(evaluate("max(tyre_pressure_psi_fl, tyre_pressure_psi_rr) - min(tyre_pressure_psi_fl, tyre_pressure_psi_rr)", vars)).toBeCloseTo(0.6);
    expect(evaluate("round(10 / 3, 2)", {})).toBe(3.33);
    expect(evaluate("abs(-4)", {})).toBe(4);
  });

  test("mistakes are errors, never code", () => {
    for (const bad of ["", "1 +", "(1", "1 2", "fuel", "abs(1, 2)", "alert(1)", "a.b", "x = 1", "constructor", "__proto__", "constructor(1)", "tostring(1)", "valueof"]) {
      expect(() => evaluate(bad, vars), bad).toThrow(FormulaError);
    }
  });

  test("names lists what a formula reads", () => {
    expect(names("max(fuel_litres, 2) / fuel_per_lap + fuel_litres")).toEqual(["fuel_litres", "fuel_per_lap"]);
  });

  test("flatten: numbers, booleans, tyre corners and short arrays", () => {
    expect(flatten([{ Speed_kmh: 120, pit_limiter: true, tyre_core_temp_c: [80, 81, 82, 83], acc_g: [0.1, 1, -0.2], car_model: "x", big: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, null])).toEqual({
      speed_kmh: 120, pit_limiter: 1, tyre_core_temp_c_fl: 80, tyre_core_temp_c_fr: 81, tyre_core_temp_c_rl: 82, tyre_core_temp_c_rr: 83, acc_g_0: 0.1, acc_g_1: 1, acc_g_2: -0.2,
    });
  });

  test("thresholds", () => {
    expect(level(5, "below", 3, 1)).toBe(0);
    expect(level(2, "below", 3, 1)).toBe(1);
    expect(level(1, "below", 3, 1)).toBe(2);
    expect(level(29, "above", 28, null)).toBe(1);
    expect(level(29, "off", 28, 28)).toBe(0);
    expect(level(NaN, "above", 1, 1)).toBe(0);
  });
});
