import { describe, expect, test } from "vitest";
import fixture from "./fixtures/sim.json";
import { numbersOnly } from "./sanitize";
import { applyPayload, emptyCtx, emptyInternals, withFocus, addPageLog } from "./store";
import type { Payload } from "./types";

const first = fixture.first as unknown as Payload;
const next = fixture.next as unknown as Payload;

describe("numbersOnly", () => {
  test("keeps known text keys and turns every other string into a number", () => {
    const out = numbersOnly<{ text: string; gap: number; nested: { name: string; x: number }[] }>({ text: "hello", gap: "12", nested: [{ name: "a", x: "7" }] });
    expect(out).toEqual({ text: "hello", gap: 12, nested: [{ name: "a", x: 7 }] });
    expect(Number.isNaN(numbersOnly<number>("<script>", "gap"))).toBe(true);
  });
});

describe("applyPayload with a simulated session", () => {
  test("the first message fills the reading, summary, field and cars", () => {
    const it = emptyInternals();
    const c = applyPayload(emptyCtx(), it, structuredClone(first), 1000);
    expect(c.r?.car.speed_kmh).toBeTypeOf("number");
    expect(c.s?.strategy).toBeTruthy();
    expect(c.st).toBe(c.s?.strategy);
    expect(c.cars.size).toBe(20);
    expect(c.me).toBe(7);
    expect(c.focusCar?.i).toBe(7);
    expect(c.mode).toBe("race");
    expect(c.bc?.state).toBe("live");
    expect(c.th.dry_psi).toHaveLength(2);
  });

  test("cars carry their entry list and slow fields", () => {
    const c = applyPayload(emptyCtx(), emptyInternals(), structuredClone(first), 1000);
    const car = c.cars.get(3)!;
    expect(car.drivers?.[0]?.last).toBeTypeOf("string");
    expect(car.model_name).toBeTypeOf("string");
    expect(car.pits).toBeTypeOf("number");
  });

  test("a later message keeps what it did not resend and counts the reading rate", () => {
    const it = emptyInternals();
    let c = applyPayload(emptyCtx(), it, structuredClone(first), 1000);
    const summary = c.s;
    c = applyPayload(c, it, structuredClone({ ...next, summary: null }), 1100);
    expect(c.s).toBe(summary);
    expect(c.cars.size).toBe(20);
    expect(c.hz).toBeGreaterThanOrEqual(0);
  });

  test("the same reading twice counts once", () => {
    const it = emptyInternals();
    applyPayload(emptyCtx(), it, structuredClone(first), 1000);
    applyPayload(emptyCtx(), it, structuredClone(first), 1050);
    expect(it.rx).toHaveLength(1);
  });

  test("page log lines sort in with the bridge's", () => {
    const it = emptyInternals();
    let c = applyPayload(emptyCtx(), it, structuredClone(first), 1000);
    const before = c.log.length;
    c = addPageLog(c, it, 1, "PLAN", "Sent a plan");
    expect(c.log).toHaveLength(before + 1);
    expect(c.log.some((l) => l.src === "page" && l.text === "Sent a plan")).toBe(true);
  });

  test("focus: another car, then back to self when it is the own car", () => {
    const c = applyPayload(emptyCtx(), emptyInternals(), structuredClone(first), 1000);
    expect(withFocus(c, 3).focusCar?.i).toBe(3);
    expect(withFocus(c, 7).focus).toBe("self");
    expect(withFocus(c, "x" as unknown as number)).toBe(c);
  });
});
