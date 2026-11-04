import { describe, expect, test } from "vitest";
import { AcPlugin, PLUGIN, toMessages, withPlugin } from "../src/broadcast/ac-plugin.js";
import { Field } from "../src/broadcast/field.js";

const car = (i: number, laps: number, spl: number, pos: number) =>
  ({ i, name: i ? `Rival ${i}` : "Ann Driver", car: "rss_gt", x: 100 * i, z: 5, spl, laps, pos, kmh: 120, gear: 4, pit: 0, cur: 30000, last: 91000, best: 90500, inv: 0 });

describe("Pit Wall app packets", () => {
  test("become a field the standings code understands", () => {
    const seen = { track: "", ids: "", names: new Map<number, string>() };
    const f = new Field();
    const hint = { id: 0, laps: 2, spl: 0.5, name: "Ann Driver", xyz: [0, 0, 0], kmh: 0, len: 5000, session: 2, sidx: 1 };
    const send = (t: number, spl: number) => {
      for (const [k, d] of toMessages({ v: 1, t, track: "monza", config: "gp", cars: [car(0, 2, spl, 2), car(1, 2, spl + 0.05, 1)] }, hint, seen)) f.on(k, d);
    };
    send(10, 0.5); send(10.25, 0.51);
    const snap = f.snapshot(hint, null, null);
    expect(snap.cars).toHaveLength(2);
    expect(snap.cars.map((c: { pos: number }) => c.pos).sort()).toEqual([1, 2]);
    expect(f.track).toMatchObject({ name: "monza gp", length_m: 5000 });
    expect(f.ent.get(1)).toMatchObject({ team: "rss_gt", drivers: [{ first: "Rival", last: "1" }] });
    expect(toMessages({ v: 1, t: 11, track: "monza", config: "gp", cars: [car(0, 2, 0.6, 2), car(1, 2, 0.65, 1)] }, hint, seen).map(([k]) => k)).toEqual([2, 3, 3]);
  });

  test("the driver's own position and lap fraction come from the app", () => {
    PLUGIN.at = 1000; PLUGIN.flag = 5; PLUGIN.ses = 2; PLUGIN.cars = [{ i: 0, x: 10, z: 20, spl: 0.01 }, { i: 3, x: 30, z: 40, spl: 0.5 }];
    const r = { xyz: [0.1, -600, 0], track_pos: 0.7, me: 5, coords: {}, g_flags: [0, 0, 0, 0, 0, 0, 0, 0], flag: 0 };
    expect(withPlugin(r, 1500)).toMatchObject({ xyz: [10, 0, 20], track_pos: 0.01, me: 0, coords: { 0: [10, 20], 3: [30, 40] }, flag: 5, session: 2 });
    expect(withPlugin(r, 1500).g_flags[6]).toBe(1);
    expect(withPlugin(r, 9000)).toBe(r);
  });

  test("the app's HTTP posts reach the field, and a page cannot post", async () => {
    const got: number[] = [];
    const src = new AcPlugin(() => null, 19877);
    src.start((k) => got.push(k));
    await new Promise((r) => setTimeout(r, 100));
    const body = JSON.stringify({ v: 1, t: 1, track: "t", config: "", flag: 2, ses: 2, left: 5, cars: [car(0, 1, 0.1, 1)] });
    const post = (h: Record<string, string>) => fetch("http://127.0.0.1:19877/state", { method: "POST", headers: h, body }).then((r) => r.status);
    expect(await post({ "Content-Type": "text/plain" })).toBe(403);
    expect(got).toEqual([]);
    expect(await post({ "X-Pit-Source": "ac" })).toBe(204);
    expect(got).toContain(2);
    expect(src.state.state).toBe("live");
    expect(PLUGIN).toMatchObject({ flag: 2, ses: 2, left: 5 });
    src.close();
  });
});
