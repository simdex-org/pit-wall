import { describe, expect, it } from "vitest";
import { paceLaps } from "./pace";

const lap = (n: number, ms: number, x: { out?: boolean; in?: boolean; valid?: boolean } = {}) => ({ n, ms, ...x });
const v = (l: { ms: number }) => l.ms;

describe("paceLaps", () => {
  it("drops out, in and slow laps but keeps invalid ones", () => {
    const L = [lap(1, 130000, { out: true }), lap(2, 91000), lap(3, 91500, { valid: false }), lap(4, 120000), lap(5, 92000), lap(6, 150000, { in: true })];
    expect(paceLaps(L, v).map((l) => l.n)).toEqual([2, 3, 5]);
  });
  it("is empty when every lap is out or in", () => {
    expect(paceLaps([lap(1, 90000, { out: true }), lap(2, 90000, { in: true })], v)).toEqual([]);
  });
});
