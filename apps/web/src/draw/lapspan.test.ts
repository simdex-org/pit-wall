import { describe, expect, test } from "vitest";
import { lapSpan } from "./lapspan.js";

const line = (...q: number[]) => q.map((f) => [0, 0, f]);

describe("lapSpan", () => {
  test("a stretch across the start line is short, however far apart its fractions are", () => {
    expect(lapSpan(line(0.97, 0.98, 0.99, 0.0, 0.01, 0.02))).toBeCloseTo(0.05, 6);
  });
  test("a long run is counted from the first point to the last, wrap included", () => {
    expect(lapSpan(line(0.0, 0.2, 0.4))).toBeCloseTo(0.4, 6);
    expect(lapSpan(line(0.6, 0.8, 0.99, 0.1, 0.3))).toBeCloseTo(0.7, 6);
  });
  test("a point that steps back a little adds nothing", () => {
    expect(lapSpan(line(0.1, 0.2, 0.19, 0.3))).toBeCloseTo(0.21, 6);
  });
});
