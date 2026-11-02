import { describe, expect, it } from "vitest";
import { angleOf, arcPath, polar } from "./arc";

describe("arc", () => {
  it("maps a value onto the 270 degree sweep and clamps it", () => {
    expect(angleOf(0, 0, 100)).toBe(-135);
    expect(angleOf(50, 0, 100)).toBe(0);
    expect(angleOf(100, 0, 100)).toBe(135);
    expect(angleOf(-5, 0, 100)).toBe(-135);
    expect(angleOf(500, 0, 100)).toBe(135);
  });

  it("puts twelve o'clock above the centre and 90 degrees to the right", () => {
    const [x, y] = polar(100, 100, 50, 0);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(50);
    const [x2, y2] = polar(100, 100, 50, 90);
    expect(x2).toBeCloseTo(150);
    expect(y2).toBeCloseTo(100);
  });

  it("uses the large-arc flag past 180 degrees and never draws an empty arc", () => {
    expect(arcPath(0, 0, 10, -135, 135)).toContain(" 0 1 1 ");
    expect(arcPath(0, 0, 10, -135, -100)).toContain(" 0 0 1 ");
    expect(arcPath(0, 0, 10, 20, 20)).toMatch(/^M[\d.-]+ [\d.-]+ A10 10 0 0 1 /);
  });
});
