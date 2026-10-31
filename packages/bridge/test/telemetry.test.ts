import { describe, expect, test } from "vitest";
import { cleanConfig } from "../src/config.js";
import { carClass, NB } from "../src/telemetry/constants.js";
import { FakePages } from "../src/telemetry/fake-pages.js";
import { Telemetry } from "../src/telemetry/telemetry.js";
import { Rec, ValueError } from "../src/util.js";

describe("telemetry pipeline", () => {
  const now = [0];
  const clock = () => now[0]!;
  const pages = new FakePages({ lapMs: 60000, clock });
  const tel = new Telemetry(undefined, clock);
  let raw: Rec = {}, reading: Rec = {};

  test("a real layout has a believable speed profile", () => {
    const mz = new FakePages({ track: "monza" });
    expect(Math.min(...mz.v) * 3.6).toBeGreaterThan(50);
    expect(Math.min(...mz.v) * 3.6).toBeLessThan(100);
    expect(Math.max(...mz.v) * 3.6).toBeGreaterThan(250);
    expect(Math.max(...mz.v) * 3.6).toBeLessThan(320);
    expect(Math.abs(mz.tcum[mz.tcum.length - 1]! - 1)).toBeLessThan(1e-9);
  });

  test("three laps: debrief, sectors, fuel, advice, strategy", () => {
    for (let i = 0; i < Math.floor(3.2 * 60 * 30); i++) { now[0]! += 1 / 30; raw = pages.read(); reading = tel.update(raw); }
    const s = tel.summary(raw);
    const car = reading.reading.car, ses = reading.reading.session;
    expect(tel.debrief).toHaveLength(3);
    expect(tel.debrief[0]!.lap_number).toBeGreaterThan(tel.debrief[1]!.lap_number);
    const d = tel.debrief[0]!;
    expect(d.sectors_ms).toHaveLength(3);
    expect(d.sectors_ms.reduce((a: number, b: number) => a + b, 0)).toBe(d.lap_time_ms);
    expect(Math.abs(s.fuel_per_lap - 3.1)).toBeLessThan(0.05);
    expect(s.advice.some((a: Rec) => a.text.startsWith("Fronts 27.7 psi, 0.7 over") && a.id === "press_front")).toBe(true);
    expect(s.stint_laps).toBeGreaterThanOrEqual(3);
    expect(car.gear).toBeGreaterThanOrEqual(1); expect(car.gear).toBeLessThanOrEqual(6);
    expect(ses.status).toBe("Live"); expect(ses.kind).toBe("Race");
    expect(d.lines.some((l: Rec) => l.text.includes("Pressures out of"))).toBe(true);
    expect(d.lines.some((l: Rec) => l.text === "Used 3.10 L")).toBe(true);
    expect(s.stint.map((l: Rec) => l.n)).toEqual([...tel.debrief].reverse().map((x) => x.lap_number));
    expect(tel.laps.map((l) => l.n)).toEqual(s.stint.map((l: Rec) => l.n));
    expect(tel.laps[tel.laps.length - 1]!.s).toHaveLength(3);
    expect(tel.laps[tel.laps.length - 1]!.out).toBe(false);
    expect(s.stint[s.stint.length - 1].pads[0]).toBeLessThan(s.stint[0].pads[0]);
    expect(ses.gap_ahead_ms).toBeGreaterThan(0);
    expect(reading.reading.fixed.max_fuel).toBe(120);
    const st = s.strategy;
    expect(Math.abs(st.laps_of_fuel - car.fuel_litres / s.fuel_per_lap)).toBeLessThan(1e-9);
    expect("fuel_laps_remaining" in s).toBe(false);
    // the fuel runs out (L18) before the window opens (L21): a splash first, then the mandatory stop inside the window
    expect(st.pit_window.open_lap).toBeGreaterThan(st.box_by_lap);
    expect(st.mandatory_left).toBe(1);
    expect([st.laps_src, st.stops_needed, st.stops_why, st.pit_window.src]).toEqual(["timed", 2, "fuel + mandatory", "acc"]);
    expect(st.options.map((o: Rec) => o.id)).toEqual(["now_f", "now_ft", "late_f", "late_ft", "win_f", "win_ft"]);
    expect(st.options[1].stationary_s).toBe(30.0);
    expect(st.drive_loss_src).toBe("config"); expect(s.best_src).toBe("bridge");
    const o = Object.fromEntries(st.options.map((x: Rec) => [x.id, x]));
    expect(o.now_f.more_stops).toBe(1); expect(o.late_f.more_stops).toBe(1);
    expect(o.late_f.outside_window).toBe(true); expect(o.late_f.reach).toBe(true); expect(o.win_f.reach).toBe(false);
    const d2 = tel.strategy({ ...raw, missing_pits: 0 }); // the mandatory stop made: boxing now leaves a second fuel stop, boxing late does not
    const o2 = Object.fromEntries(d2.options.map((x: Rec) => [x.id, x]));
    expect(d2.stops_needed).toBe(1); expect(d2.stops_why).toBe("fuel");
    expect(o2.now_f.more_stops).toBe(1); expect(o2.late_f.more_stops).toBe(0);
    const q = new Telemetry(undefined, clock).strategy({ ...raw, session: 1 });
    expect(q.laps_to_go).toBeNull(); expect(q.options).toEqual([]); expect(q.box_by_lap).not.toBeNull();
  });

  test("traces, saved layout and log categories", () => {
    const traced = tel.laps.filter((l) => l.trace);
    expect(traced.length).toBeGreaterThan(0);
    expect(tel.laps[0]!.trace).toBe(false); // the first lap was joined halfway
    const lt = tel.lapTrace(traced[traced.length - 1]!.n)!;
    expect(lt.ch.t).toHaveLength(NB);
    expect(Math.abs(lt.ch.t[NB - 1] - lt.ms)).toBeLessThan(0.01);
    expect(lt.line.length).toBeGreaterThan(1000);
    expect(tel.lapTrace(999)).toBeNull();
    const lay = tel.bestLayout()!;
    expect(lay.line.length).toBeGreaterThan(1000);
    expect(lay.sec).toHaveLength(2);
    expect(lay.sec[0]).toBeGreaterThan(0); expect(lay.sec[0]).toBeLessThan(lay.sec[1]); expect(lay.sec[1]).toBeLessThan(1);
    const cats = new Set(tel.events.map((e) => e[1]));
    for (const c of ["LAP", "ENG", "FLAG"]) expect(cats.has(c)).toBe(true);
  });

  test("a measured pit stop", () => {
    let fuelAdd = 0;
    const n0 = now[0]!;
    while (now[0]! < n0 + 3 * 60) {
      now[0]! += 1 / 30;
      raw = pages.read();
      const e = now[0]! - n0;
      if (20 <= e && e < 50) Object.assign(raw, { pit_lane: 1, in_box: +(30 <= e && e < 40), speed: 30 <= e && e < 40 ? 0.0 : 60.0 });
      if (e >= 40) fuelAdd = 40.0;
      raw.fuel += fuelAdd;
      if (e >= 40) raw.tyre_set = 4;
      tel.update(raw);
    }
    const s = tel.summary(raw);
    const stop = s.stops[0];
    expect(s.stops).toHaveLength(1);
    expect(Math.abs(stop.box_ms - 10000)).toBeLessThan(100);
    expect(Math.abs(stop.fuel_added_l - 40)).toBeLessThan(2);
    expect(stop.tyres).toBe(true);
    expect(stop.loss_ms).not.toBeNull();
    expect(s.strategy.drive_loss_src).toBe("measured");
    expect(s.stints.map((x: Rec) => x.n)).toEqual([1, 2]);
    expect(tel.events.some(([, , t]) => t.startsWith("Stop L") && t.includes("cost"))).toBe(true);
  });

  test("a reset mid-lap gives that lap no trace", () => {
    const tp = new FakePages({ lapMs: 60000, clock }), tt = new Telemetry(undefined, clock);
    const n0 = now[0]!;
    while (now[0]! < n0 + 3 * 60) {
      now[0]! += 1 / 30;
      const r = tp.read();
      if (r.laps % 2 && 0.5 < r.track_pos && r.track_pos < 0.52) r.xyz = [r.xyz[0] + 500, r.xyz[1], r.xyz[2]];
      tt.update(r);
    }
    const jumped = tt.laps.filter((l) => l.n % 2 === 0).map((l) => l.n); // lap n is driven while raw.laps is n - 1
    expect(jumped.length).toBeGreaterThan(0);
    expect(jumped.every((n) => tt.lapTrace(n) === null)).toBe(true);
    expect(tt.laps.some((l) => l.trace)).toBe(true);
  });

  test("the demo's own stop at lap 18", () => {
    const tp = new FakePages({ lapMs: 60000, clock }), tt = new Telemetry(undefined, clock);
    const n0 = now[0]!;
    while (now[0]! < n0 + 16.2 * 60) { now[0]! += 1 / 10; tt.update(tp.read()); }
    const st = tt.stops;
    expect(st).toHaveLength(1); expect(st[0]!.lap).toBe(18);
    expect(Math.abs(st[0]!.box_ms - 3000)).toBeLessThan(200); expect(st[0]!.fuel_added_l).toBeGreaterThan(50);
    expect(tt.laps[tt.laps.length - 1]!.s.slice(0, 2)).toEqual([20000, 20000]);
    expect(tt.laps.filter((l) => l.in || l.out).map((l) => l.n)).toEqual([18, 19]);
  });
});

describe("config", () => {
  test("merges and checks", () => {
    const c = cleanConfig({ thresholds: { GT4: { dry_psi: [25, 26.5] } }, strategy: { mandatory_stops: 1 } });
    expect(c.thresholds.GT4.dry_psi).toEqual([25, 26.5]);
    expect(c.thresholds.GT3.dry_psi).toEqual([26, 27]);
    expect(c.strategy.mandatory_stops).toBe(1);
  });
  test.each([
    [{ thresholds: { GT5: {} } }], [{ strategy: { tyre_s: 500 } }], [{ thresholds: { GT3: { dry_psi: [27, 26] } } }],
    [{ strategy: { pit_window_open_min: 10 } }], [{ fuel_low_laps: true }], [[]], [{ strategy: { mandatory_stops: 1.5 } }],
  ])("rejects %j", (bad) => expect(() => cleanConfig(bad)).toThrow(ValueError));
  test("car classes", () => {
    expect([carClass("bmw_m4_gt4"), carClass("porsche_992_gt3_cup"), carClass("ferrari_296_gt3")]).toEqual(["GT4", "GTC", "GT3"]);
  });
});
