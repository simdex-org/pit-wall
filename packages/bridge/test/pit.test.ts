import { expect, test } from "vitest";
import { applyPlan } from "../src/pit/apply.js";
import { FakeMfd, Layout } from "../src/pit/fake-mfd.js";
import { cleanPlan, GROUPS } from "../src/pit/plan.js";
import { ValueError } from "../src/util.js";

const plans = [
  { fuel: 47, tyres: true, compound: "dry", tyre_set: 5, pressures: [26.4, 26.6, 26.1, 26.3], brakes: true, front_pad: 1, rear_pad: 4, flip_suspension: true, flip_bodywork: false },
  { fuel: 0, tyres: true, compound: "wet", tyre_set: 2, pressures: [30.0, 30.0, 29.5, 29.5], brakes: false, front_pad: 2, rear_pad: 2, flip_suspension: false, flip_bodywork: true },
  { fuel: 120, tyres: false, compound: "dry", tyre_set: 1, pressures: [27.0, 27.0, 27.0, 27.0], brakes: false, front_pad: 1, rear_pad: 1, flip_suspension: false, flip_bodywork: false },
];

/** Every combination of the five optional rows. */
const layouts: Layout[] = Array.from({ length: 32 }, (_, n) => ({
  strategy: !!(n & 16), tyres: !!(n & 8), wet: !!(n & 4), brakes: !!(n & 2), driver: !!(n & 1),
}));

test("full plans land on every layout", async () => {
  for (const layout of layouts) {
    for (const plan of plans) {
      const m = new FakeMfd(layout);
      const repair0 = [...m.repair];
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
      expect(m.repair, ctx).toEqual([repair0[0] !== plan.flip_suspension, repair0[1] !== plan.flip_bodywork]);
      expect(m.s.strategy, ctx).toBe(layout.strategy); expect(m.s.driver, ctx).toBe(layout.driver);
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

test("bad plans are refused", () => {
  const bad = [{}, { ...plans[0], only: ["everything"] }, { ...plans[0], only: [] }, { ...plans[0], fuel: -1 }, { ...plans[0], pressures: [27, 27, 27] },
    { ...plans[0], compound: "slick" }, { ...plans[0], front_pad: true }];
  for (const b of bad) expect(() => cleanPlan(b), JSON.stringify(b)).toThrow(ValueError);
  expect(cleanPlan({ only: ["fuel"], fuel: 30 }).fuel).toBe(30); // a fuel-only plan needs no tyre fields
  expect(cleanPlan(plans[0]).only).toEqual([...GROUPS]);
});
