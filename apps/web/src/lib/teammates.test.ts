import { describe, expect, test } from "vitest";
import type { Json } from "../feed/types";
import { driversOf, pairOf } from "./teammates";

const lap = (n: number, driver: string, ms: number, o: Json = {}): Json => ({ n, driver, ms, valid: true, out: false, in: false, trace: true, ...o });

describe("teammates' laps", () => {
  const laps = [
    lap(1, "Ana", 130000, { out: true }), lap(2, "Ana", 121000), lap(3, "Ana", 120500), lap(4, "Ana", 121400, { trace: false }), lap(5, "Ana", 150000),
    lap(6, "Sam", 125000, { out: true }), lap(7, "Sam", 120200, { valid: false }), lap(8, "Sam", 121800), lap(9, "Sam", 121200), lap(10, "Sam", 122100),
    lap(11, "", 119000), { n: 12, ms: 119000, valid: true },
  ];

  test("groups by driver in the order they drove; laps with no driver are left out", () => {
    expect(driversOf(laps).map((d) => [d.name, d.laps])).toEqual([["Ana", 5], ["Sam", 5]]);
  });

  test("one driver whatever the case the name is written in", () => {
    expect(driversOf([lap(1, "Sam Lee", 1), lap(2, "sam lee ", 2), lap(3, "Ana", 3)]).map((d) => [d.name, d.laps])).toEqual([["Sam Lee", 2], ["Ana", 1]]);
  });

  test("best and typical pace come from flying laps only: no out, in, invalid or slow laps", () => {
    const [ana, sam] = driversOf(laps);
    expect(ana!.best!.n).toBe(3);
    expect(ana!.typical).toBe(121000);
    expect(sam!.best!.n).toBe(9);
    expect(sam!.typical).toBe(121800);
    // the typical distance from the typical lap: half the laps are closer than this
    expect(sam!.spread).toBe(300);
    expect(ana!.spread).toBe(400);
  });

  test("the lap to compare must have a trace: the best traced one, or the traced one nearest the typical time", () => {
    expect(driversOf(laps, "best")[0]!.pick!.n).toBe(3);
    expect(driversOf(laps, "typical")[0]!.pick!.n).toBe(2);
    expect(driversOf(laps, "typical")[1]!.pick!.n).toBe(8);
    expect(driversOf([lap(1, "Ana", 120000, { trace: false })])[0]!.pick).toBeNull();
  });

  test("the faster driver on the chosen basis is the benchmark", () => {
    const ds = driversOf(laps);
    expect(pairOf(ds, "best", null)).toMatchObject({ bench: { name: "Ana" }, other: { name: "Sam" } });
    const slowAna = driversOf([...laps, lap(13, "Sam", 119900)]);
    expect(pairOf(slowAna, "best", null)).toMatchObject({ bench: { name: "Sam" }, other: { name: "Ana" } });
  });

  test("with three drivers the chosen pair is used, else the first two; one driver is no pair", () => {
    const three = driversOf([...laps, lap(20, "Lee", 120000)]);
    expect(pairOf(three, "best", ["Sam", "Lee"])).toMatchObject({ bench: { name: "Lee" }, other: { name: "Sam" } });
    expect(pairOf(three, "best", ["Sam", "Sam"])).toMatchObject({ bench: { name: "Ana" }, other: { name: "Sam" } });
    expect(pairOf(three, "best", ["Sam", "Nobody"])).toMatchObject({ bench: { name: "Ana" } });
    expect(pairOf(driversOf([lap(1, "Ana", 1)]), "best", null)).toBeNull();
  });
});
