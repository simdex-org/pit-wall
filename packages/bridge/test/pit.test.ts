import { expect, test } from "vitest";
import { applyPlan } from "../src/pit/apply.js";
import { FakeMfd, Layout } from "../src/pit/fake-mfd.js";
import { cleanPlan, GROUPS } from "../src/pit/plan.js";
import { ValueError } from "../src/util.js";

const plans = [
  { fuel: 47, tyres: true, compound: "dry", tyre_set: 5, pressures: [26.4, 26.6, 26.1, 26.3], brakes: true, front_pad: 1, rear_pad: 4, repair_suspension: false, repair_bodywork: true },
  { fuel: 0, tyres: true, compound: "wet", tyre_set: 2, pressures: [30.0, 30.0, 29.5, 29.5], brakes: false, front_pad: 2, rear_pad: 2, repair_suspension: true, repair_bodywork: true },
  { fuel: 120, tyres: false, compound: "dry", tyre_set: 1, pressures: [27.0, 27.0, 27.0, 27.0], brakes: false, front_pad: 1, rear_pad: 1, repair_suspension: false, repair_bodywork: false },
];

/** Every combination of the four optional rows. */
const layouts: Layout[] = Array.from({ length: 16 }, (_, n) => ({
  tyres: !!(n & 8), wet: !!(n & 4), brakes: !!(n & 2), driver: !!(n & 1),
}));

test("full plans land on every layout", async () => {
  for (const layout of layouts) {
    for (const plan of plans) {
      const m = new FakeMfd(layout);
      const res = await applyPlan(cleanPlan(plan), m);
      const ctx = JSON.stringify({ layout, plan, res });
      expect(m.fuel, ctx).toBe(plan.fuel); expect(res.fuel, ctx).toBe("ok");
      expect(m.s.tyres, ctx).toBe(plan.tyres); expect(m.s.brakes, ctx).toBe(plan.brakes);
      if (plan.tyres) {
        expect(m.s.wet, ctx).toBe(plan.compound === "wet");
        expect(m.p, ctx).toEqual(plan.pressures);
        if (plan.compound !== "wet") expect(m.set, ctx).toBe(plan.tyre_set);
      }
      if (plan.brakes) expect(m.pads, ctx).toEqual([plan.front_pad, plan.rear_pad]);
      expect(m.repair, ctx).toEqual([plan.repair_suspension, plan.repair_bodywork]);
      expect(m.s.driver, ctx).toBe(layout.driver);
    }
  }
});

test("single blocks touch only their own rows", async () => {
  for (const layout of layouts) {
    for (const only of [["fuel"], ["repairs"], ["pressures"], ["brakes"], ["fuel", "pressures"]]) {
      const m = new FakeMfd(layout);
      const before = { fuel: m.fuel, p: [...m.p], s: { ...m.s }, repair: [...m.repair] };
      const plan = cleanPlan({ ...plans[0], only });
      const res = await applyPlan(plan, m);
      const ctx = JSON.stringify({ layout, only });
      if (only.includes("fuel")) { expect(m.fuel, ctx).toBe(plan.fuel); expect(res.fuel, ctx).toBe("ok"); }
      else { expect(m.fuel, ctx).toBe(before.fuel); expect(m.strat, ctx).toBe(0); } // the Strategy row is never stepped
      if (only.includes("pressures")) { expect(m.p, ctx).toEqual(plan.pressures); expect(m.s.tyres, ctx).toBe(true); }
      else expect(m.p, ctx).toEqual(before.p);
      if (only.includes("brakes")) {
        expect(m.s.brakes, ctx).toBe(true); expect(m.pads, ctx).toEqual([plan.front_pad, plan.rear_pad]); expect(m.s.tyres, ctx).toBe(before.s.tyres);
      } else expect(m.s.brakes, ctx).toBe(before.s.brakes);
      if (only.includes("repairs")) { expect(m.repair, ctx).toEqual([!before.repair[0], before.repair[1]]); expect(m.presses, ctx).toBeLessThanOrEqual(8); }
      else expect(m.repair, ctx).toEqual(before.repair);
      expect(m.s.wet, ctx).toBe(before.s.wet);
    }
  }
});

test("a fuel row locked by the strategy is unlocked, and a stuck one is reported", async () => {
  const m = new FakeMfd();
  m.lockedByStrategy = true; m.strat = 1;
  const res = await applyPlan(cleanPlan({ only: ["fuel"], fuel: 40 }), m);
  expect(m.fuel).toBe(40); expect(res.fuel).toMatch(/^ok/);
  const stuck = new FakeMfd();
  stuck.lockedByStrategy = true; stuck.strat = 1;
  stuck.press = ((p) => function (this: FakeMfd, k: never, n?: number) { p.call(this, k, n); this.strat = 1; })(stuck.press) as never;
  expect((await applyPlan(cleanPlan({ only: ["fuel"], fuel: 40 }), stuck)).fuel).toMatch(/^locked/);
});

test("pads are reached from the last value sent, round the wrap", async () => {
  const m = new FakeMfd();
  for (const [front_pad, rear_pad] of [[4, 2], [1, 3], [3, 4], [2, 1]]) {
    await applyPlan(cleanPlan({ ...plans[0], only: ["brakes"], brakes: true, front_pad, rear_pad }), m);
    expect(m.pads).toEqual([front_pad, rear_pad]);
  }
});

test("pads start from the page's memory, then the car, then 1", async () => {
  const ask = { ...plans[0], only: ["brakes"], brakes: true, front_pad: 1, rear_pad: 4 };
  const a = new FakeMfd(); a.pads = [3, 2];
  expect((await applyPlan(cleanPlan({ ...ask, pads_from: [3, 2] }), a)).front_pad).toBe("sent (from page)");
  expect(a.pads).toEqual([1, 4]);
  const b = new FakeMfd(); b.pads = [2, 3];
  const res = await applyPlan(cleanPlan(ask), b, [2, 3]);
  expect(res.rear_pad).toBe("sent (from car)"); expect(b.pads).toEqual([1, 4]);
  expect((await applyPlan(cleanPlan(ask), new FakeMfd())).front_pad).toBe("sent (guessed 1)");
  expect(cleanPlan({ ...ask, pads_from: [0, 9] }).pads_from).toBeNull();
});

test("repairs reach any of the three states from any other in one press", async () => {
  const states = [[true, true], [false, true], [false, false]] as const;
  for (const a of states) for (const b of states) {
    const m = new FakeMfd();
    await applyPlan(cleanPlan({ ...plans[0], only: ["repairs"], repair_suspension: a[0], repair_bodywork: a[1] }), m);
    expect(m.repair, `to ${a}`).toEqual([...a]);
    const before = m.presses;
    await applyPlan(cleanPlan({ ...plans[0], only: ["repairs"], repair_suspension: b[0], repair_bodywork: b[1] }), m);
    expect(m.repair, `${a} to ${b}`).toEqual([...b]);
    expect(m.presses - before, `${a} to ${b}`).toBeLessThanOrEqual(8);
  }
  for (const start of states) { // whatever the screen shows, the state asked for is reached
    const m = new FakeMfd(); m.repair = [...start];
    await applyPlan(cleanPlan({ ...plans[0], only: ["repairs"], repair_suspension: true, repair_bodywork: true }), m);
    expect(m.repair, `from ${start}`).toEqual([true, true]);
  }
});

test("a probe that lands on a repair row leaves the repairs as they were", async () => {
  for (const layout of layouts) for (const only of [["pressures"], ["tyres"], ["brakes"]]) {
    const m = new FakeMfd(layout);
    await applyPlan(cleanPlan({ ...plans[0], only }), m);
    expect(m.repair, JSON.stringify({ layout, only })).toEqual([true, true]);
  }
});

test("with Change tyres off a tyres send only switches them off", async () => {
  for (const layout of layouts) {
    const m = new FakeMfd(layout);
    const before = { p: [...m.p], set: m.set, wet: m.s.wet };
    await applyPlan(cleanPlan({ ...plans[0], only: ["tyres", "pressures"], tyres: false, compound: "wet", pressures: [30, 30, 30, 30] }), m);
    expect(m.s.tyres, JSON.stringify(layout)).toBe(false);
    expect(m.p).toEqual(before.p); expect(m.set).toBe(before.set); expect(m.s.wet).toBe(before.wet);
  }
});

test("bad plans are refused", () => {
  const bad = [{}, { ...plans[0], only: ["everything"] }, { ...plans[0], only: [] }, { ...plans[0], fuel: -1 }, { ...plans[0], pressures: [27, 27, 27] },
    { ...plans[0], compound: "slick" }, { ...plans[0], front_pad: true }, { ...plans[0], repair_bodywork: "yes" }];
  for (const b of bad) expect(() => cleanPlan(b), JSON.stringify(b)).toThrow(ValueError);
  expect(cleanPlan({ only: ["fuel"], fuel: 30 }).fuel).toBe(30); // a fuel-only plan needs no tyre fields
  expect(cleanPlan(plans[0]).only).toEqual([...GROUPS]);
});
