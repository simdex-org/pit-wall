import { describe, expect, test } from "vitest";
import { cleanConfig } from "../src/config.js";
import { carClass, LCH, NB } from "../src/telemetry/constants.js";
import { World } from "../src/sim/world.js";
import { FakePages } from "../src/telemetry/fake-pages.js";
import { Telemetry } from "../src/telemetry/telemetry.js";
import { Rec, ValueError } from "../src/util.js";

describe("telemetry pipeline", { timeout: 60000 }, () => {
  const now = [0];
  const clock = () => now[0]!;
  const pages = new FakePages({ clock, seed: 2 });
  const tel = new Telemetry(undefined, clock);
  let raw: Rec = {}, reading: Rec = {};
  const run = (p: FakePages, t: Telemetry, seconds: number, hz = 30, each: (r: Rec) => void = () => {}) => {
    const n0 = now[0]!;
    while (now[0]! < n0 + seconds) { now[0]! += 1 / hz; const r = p.read(); each(r); t.update(r); raw = r; }
  };

  test("a real layout has a believable speed profile", () => {
    const mz = new World("race", { track: "monza" }).circuit;
    expect(Math.min(...mz.v) * 3.6).toBeGreaterThan(50);
    expect(Math.min(...mz.v) * 3.6).toBeLessThan(100);
    expect(Math.max(...mz.v) * 3.6).toBeGreaterThan(250);
    expect(Math.max(...mz.v) * 3.6).toBeLessThan(320);
    expect(Math.abs(mz.tcum[mz.tcum.length - 1]! - 1)).toBeLessThan(1e-9);
  });

  test("the grid, the start and three laps: debrief, sectors, fuel, advice, strategy", () => {
    run(pages, tel, 20 + 4 * 100); // twenty seconds of grid, then lights out
    expect(raw.laps).toBeGreaterThanOrEqual(3);
    reading = tel.update(raw);
    const s = tel.summary(raw);
    const car = reading.reading.car, ses = reading.reading.session;
    expect(tel.debrief).toHaveLength(3);
    expect(tel.debrief[0]!.lap_number).toBeGreaterThan(tel.debrief[1]!.lap_number);
    const d = tel.debrief[0]!;
    expect(d.sectors_ms).toHaveLength(3);
    expect(tel.secKept).toHaveLength(2);
    expect(d.sectors_ms.reduce((a: number, b: number) => a + b, 0)).toBe(d.lap_time_ms);
    expect(Math.abs(s.fuel_per_lap - pages.world.player.lpl)).toBeLessThan(0.3);
    expect(s.stint_laps).toBeGreaterThanOrEqual(3);
    expect(car.gear).toBeGreaterThanOrEqual(1); expect(car.gear).toBeLessThanOrEqual(6);
    expect(ses.status).toBe("Live"); expect(ses.kind).toBe("Race");
    expect(d.lines.some((l: Rec) => l.text.startsWith("Used "))).toBe(true);
    expect(s.stint.map((l: Rec) => l.n).slice(-3)).toEqual([...tel.debrief].reverse().map((x) => x.lap_number));
    expect(tel.laps.map((l) => l.n)).toEqual(expect.arrayContaining(s.stint.map((l: Rec) => l.n)));
    expect(tel.laps[tel.laps.length - 1]!.s).toHaveLength(3);
    expect(tel.laps[tel.laps.length - 1]!.out).toBe(false);
    expect(s.stint[s.stint.length - 1].pads[0]).toBeLessThan(s.stint[0].pads[0]);
    expect(ses.gap_ahead_ms).toBeGreaterThan(0);
    expect(reading.reading.fixed.max_fuel).toBe(120);
    const st = s.strategy;
    expect(Math.abs(st.laps_of_fuel - car.fuel_litres / s.fuel_per_lap)).toBeLessThan(1e-9);
    expect("fuel_laps_remaining" in s).toBe(false);
    expect([st.laps_src, st.pit_window.src]).toEqual(["timed", "acc"]);
    expect(st.mandatory_left).toBe(1);
    expect(st.stops_needed).toBeGreaterThanOrEqual(1);
    expect(st.pit_window.open_lap).toBeGreaterThan(10);
    expect(st.options.map((o: Rec) => o.id)).toEqual(expect.arrayContaining(["now_f", "now_ft"]));
    expect(st.options[1].stationary_s).toBe(30.0);
    expect(st.drive_loss_src).toBe("config"); expect(s.best_src).toBe("bridge");
    const d2 = tel.strategy({ ...raw, missing_pits: 0 }); // the mandatory stop made
    expect(d2.mandatory_left).toBe(0);
    const q = new Telemetry(undefined, clock).strategy({ ...raw, session: 1 });
    expect(q.laps_to_go).toBeNull(); expect(q.options).toEqual([]); expect(q.box_by_lap).not.toBeNull();
  });

  test("traces, saved layout and log categories", () => {
    const traced = tel.laps.filter((l) => l.trace);
    expect(traced.length).toBeGreaterThan(0);
    expect(tel.laps[0]!.trace).toBe(false); // the standing start lap has no whole trace to compare
    const lt = tel.lapTrace(traced[traced.length - 1]!.n)!;
    expect(lt.ch.t).toHaveLength(NB);
    for (const k of LCH) expect(lt.ch[k]).toHaveLength(NB);
    expect(Math.max(...lt.ch.glat!.map(Math.abs))).toBeGreaterThan(0);
    for (const k of LCH) expect(lt.ch[k]).toHaveLength(NB);
    expect(Math.max(...lt.ch.glat!.map(Math.abs))).toBeGreaterThan(0);
    expect(Math.abs(lt.ch.t[NB - 1] - lt.ms)).toBeLessThan(0.01);
    expect(lt.line.length).toBeGreaterThan(1000);
    expect(tel.lapTrace(999)).toBeNull();
    const lay = tel.bestLayout()!;
    expect(lay.line.length).toBeGreaterThan(1000);
    expect(lay.sec).toHaveLength(2);
    expect(lay.sec[0]).toBeGreaterThan(0); expect(lay.sec[0]).toBeLessThan(lay.sec[1]); expect(lay.sec[1]).toBeLessThan(1);
    const cats = new Set(tel.events.map((e) => e[1]));
    for (const c of ["LAP", "ENG"]) expect(cats.has(c)).toBe(true);
  });

  test("a measured pit stop", () => {
    let fuelAdd = 0;
    const n0 = now[0]!;
    while (now[0]! < n0 + 4.5 * 60) {
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
    const tp = new FakePages({ clock }), tt = new Telemetry(undefined, clock);
    run(tp, tt, 20 + 4 * 100, 30, (r) => { if (r.laps % 2 && 0.5 < r.track_pos && r.track_pos < 0.52) r.xyz = [r.xyz[0] + 500, r.xyz[1], r.xyz[2]]; });
    const jumped = tt.laps.filter((l) => l.n % 2 === 0).map((l) => l.n); // lap n is driven while raw.laps is n - 1
    expect(jumped.length).toBeGreaterThan(0);
    expect(jumped.every((n) => tt.lapTrace(n) === null)).toBe(true);
    expect(tt.laps.some((l) => l.trace)).toBe(true);
  });

  test("a new session files the old one: laps, stints, stops, traces and the field's final state", () => {
    const tp = new FakePages({ clock }), tt = new Telemetry(undefined, clock);
    run(tp, tt, 20 + 3 * 100);
    const n = tt.laps.length, traced = tt.laps.find((l) => l.trace)!.n;
    expect(n).toBeGreaterThan(0);
    const r = tp.read();
    tt.update({ ...r, session_index: r.session_index + 1, session: 0, laps: 0 });
    expect(tt.laps).toHaveLength(0);
    const p = tt.past[0]!;
    expect(p).toMatchObject({ id: 1, kind: "Race", laps: expect.any(Array), stints: expect.any(Array), stops: [], field: false });
    expect(p.laps).toHaveLength(n);
    expect(tt.lapTrace(traced)).toBeNull();
    expect(tt.lapTrace(traced, 1)!.ch.t).toHaveLength(NB);
    expect(tt.lapTrace(traced, 2)).toBeNull();
    tt.attachField(1, { field: { cars: [] } });
    expect(tt.past[0]!.field).toBe(true);
    expect(tt.vault.get(1)!.field).toEqual({ field: { cars: [] } });
    for (let i = 0; i < 8; i++) { tt.update({ ...r, session_index: r.session_index + 2 + i, laps: 0 }); tt.laps.push({ n: 1 }); }
    expect(tt.past).toHaveLength(6);
    expect(tt.vault.size).toBe(6);
  });

  test("the driver's own stop: the lane, the box, the fuel and the tyres, measured from the pages", () => {
    const tp = new FakePages({ clock, seed: 3 }), tt = new Telemetry(undefined, clock);
    const w = tp.world;
    w.rainAt = () => 0; // a dry race, so the one stop is the planned one
    run(tp, tt, 50 * 60, 10, () => {});
    expect(tt.stops).toHaveLength(1);
    const st = tt.stops[0]!;
    expect(st.lap).toBeGreaterThan(10); expect(st.lap).toBeLessThan(40);
    expect(st.box_ms).toBeGreaterThan(8000); expect(st.box_ms).toBeLessThan(45000);
    expect(st.fuel_added_l).toBeGreaterThan(20);
    expect(st.tyres).toBe(true);
    expect(w.player.mandatoryDone).toBe(true);
    const flagged = tt.laps.filter((l) => l.in || l.out).map((l) => l.n);
    expect(flagged).toContain(st.lap);
    expect(tt.events.some(([, c]) => c === "PIT")).toBe(true);
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
