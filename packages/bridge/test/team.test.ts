import { afterEach, describe, expect, test } from "vitest";
import { cleanConfig } from "../src/config.js";
import { STATE } from "../src/state.js";
import { drivingHere, inCar } from "../src/team/driver.js";
import { following, join, parseLink, Peer, TEAM } from "../src/team/link.js";
import { receive } from "../src/team/mirror.js";
import { DEFAULT_FIELD, MIN_FIELD } from "../src/sim/roster.js";
import { FakePages } from "../src/telemetry/fake-pages.js";
import { Telemetry } from "../src/telemetry/telemetry.js";
import { Rec, ValueError } from "../src/util.js";

describe("who is in the car", () => {
  const field = { me: 4, cars: [{ i: 3, drv: 0 }, { i: 4, drv: 1 }] };
  const entries = { cars: { 4: { drivers: [{ first: "Ana", last: "Lima" }, { first: "Sam", last: "" }] } } };

  test("broadcasting names the current driver of our car", () => {
    expect(inCar(field, entries)).toBe("Sam");
    expect(inCar({ ...field, me: null }, entries)).toBeNull();
    expect(inCar(field, null)).toBeNull();
  });

  test("this PC drives when its game is live and broadcasting agrees or cannot tell", () => {
    expect(drivingHere(true, "sam", "Sam")).toBe(true);
    expect(drivingHere(true, "Ana Lima", "Sam")).toBe(false);
    expect(drivingHere(true, "Ana Lima", null)).toBe(true);
    expect(drivingHere(false, "Sam", "Sam")).toBe(false);
  });
});

describe("one race history across a driver swap", { timeout: 60000 }, () => {
  test("the next driver's bridge carries on from the stop, laps and fuel of the first", () => {
    const now = [0];
    const clock = () => now[0]!;
    const pages = new FakePages({ clock, minutes: 12, driver: 1, field: { ...DEFAULT_FIELD, cars: MIN_FIELD } });
    const w = pages.world;
    const tels = [new Telemetry(undefined, clock), new Telemetry(undefined, clock)];
    const wire = (h: Rec) => JSON.parse(JSON.stringify(h)) as Rec;
    let lapsBefore = 0, sentAt = -1;
    while (now[0]! < 600 && !(w.driver === 1 && tels[1]!.stops.length)) {
      now[0]! += 1 / 10;
      const r = pages.read(), drv = w.driver;
      tels[drv]!.update(r);
      if (now[0]! - sentAt >= 1) { tels[1 - drv]!.adopt(wire(tels[drv]!.exportHist())); sentAt = now[0]!; }
      if (drv === 0) lapsBefore = tels[0]!.laps.length;
    }
    const b = tels[1]!;
    expect(lapsBefore).toBeGreaterThan(2);
    expect(b.stops).toHaveLength(1);
    const st = b.stops[0]!;
    expect(st.box_ms).toBeGreaterThan(5000);
    expect(st.lane_ms).toBeGreaterThan(st.box_ms);
    expect(st.fuel_added_l).toBeGreaterThan(1);
    expect(b.stintNo).toBe(2);
    expect(b.laps.length).toBeGreaterThanOrEqual(lapsBefore);
    expect(b.lapFuel.length).toBeGreaterThan(1);
    expect(b.summary(pages.read()).stints.map((s: Rec) => s.n)).toEqual([1, 2]);
  });

  test("taking the car over in the pits without the teammate's pit entry still counts the stop", () => {
    const now = [0];
    const pages = new FakePages({ clock: () => now[0]!, minutes: 12 });
    const tel = new Telemetry(undefined, () => now[0]!);
    while (now[0]! < 40) { now[0]! += 0.1; pages.read(); }
    tel.adopt({ sess: null, fuel: 10, set: 1, laps: [], stops: [], stintNo: 1, lapFuel: [], stint: [], debrief: [], secKept: [], stop: null, pending: null });
    const at = (o: Rec) => ({ ...pages.read(), ...o });
    for (let i = 0; i < 100; i++) { now[0]! += 0.1; tel.update(at({ pit_lane: 1, in_box: 1, speed: 0, fuel: 50, tyre_set: 2 })); }
    now[0]! += 0.1; tel.update(at({ pit_lane: 0, in_box: 0, speed: 80, fuel: 50, tyre_set: 2 }));
    expect(tel.stops).toHaveLength(1);
    expect(tel.stops[0]).toMatchObject({ fuel_added_l: 40, tyres: true });
    expect(tel.stops[0]!.box_ms).toBeGreaterThan(9000);
    expect(tel.stintNo).toBe(2);
  });

  test("a hand-over from another session starts a new one", () => {
    const now = [0];
    const tel = new Telemetry(undefined, () => now[0]!);
    tel.last = { session: 1, track: "spa", session_index: 1 };
    tel.laps = [{ n: 1, ms: 130000, stint: 1, valid: true }];
    tel.adopt({ sess: { session: 2, track: "spa", session_index: 2 }, laps: [], stops: [], stintNo: 1, lapFuel: [], stint: [], debrief: [], secKept: [], stop: { lap: 3, age: 4, box: 1 } });
    expect(tel.past.map((p) => p.kind)).toEqual(["Qualifying"]);
    expect(tel.stop!.t).toBe(-4);
  });
});

describe("linked bridges", () => {
  TEAM.self = { host: "127.0.0.1", port: 8765, tls: false, key: "own-key-1234" };
  afterEach(() => { for (const p of TEAM.peers) p.stop(); TEAM.peers.length = 0; TEAM.driving = false; });

  test("a teammate's link gives their bridge and key", () => {
    expect(parseLink(" http://25.1.2.3:8765/?key=abcdefghijkl ")).toEqual({ url: "http://25.1.2.3:8765", key: "abcdefghijkl" });
    expect(parseLink("http://teammate:8765/")).toBeNull();
    expect(parseLink("ftp://25.1.2.3/")).toBeNull();
  });

  test("a join needs a port, tls flag and key, and links back to the caller's own address", () => {
    expect(join("25.1.2.3", { port: "8765", tls: false, key: "k" })).toBe(false);
    expect(join("25.1.2.3", { port: 8765, key: "k" })).toBe(false);
    expect(join("::ffff:127.0.0.1", { port: 1, tls: false, key: "k" })).toBe(true);
    expect(join("::ffff:127.0.0.1", { port: 1, tls: false, key: "k2" })).toBe(true);
    expect(TEAM.peers.map((p) => [p.url, p.key])).toEqual([["http://127.0.0.1:1", "k2"]]);
  });

  test("while the teammate drives their car data and settings become ours, field lines are not copied", () => {
    const p = new Peer("http://127.0.0.1:1", "k", () => {});
    p.up = true;
    TEAM.peers.push(p);
    const cfg = cleanConfig({ team: { names: ["Ana", "Sam"], spd: 1, first: 0, max_stint_min: 60 } });
    const before = STATE.log.length;
    receive(p, { team: { name: "Sam", driving: true, config_t: Date.now() }, config: cfg, reading: { sequence: 9, from: "Sam" }, reading_age_ms: 0,
      laps: [{ n: 1 }], past: [], pit_log: [], pit: { status: "live" }, pit_job: null, log: [] }, true);
    expect(following()).toBe(p);
    expect(STATE.reading.from).toBe("Sam");
    expect(STATE.pit_remote).toEqual({ status: "live" });
    expect(STATE.config.team.names).toEqual(["Ana", "Sam"]);
    receive(p, { team: { name: "Sam", driving: true }, log: [{ sev: 0, cat: "LAP", text: "Lap 1", lap: 1 }, { sev: 0, cat: "FIELD", text: "#3 in the pits", lap: 1 }] }, false);
    expect(STATE.log.slice(before).map((l: Rec) => l.text)).toEqual(["Lap 1"]);
    TEAM.driving = true;
    expect(following()).toBeNull();
  });

  test("the stint plan is checked like the other settings", () => {
    expect(cleanConfig({}).team).toEqual({ names: [""], spd: 1, first: 0, max_stint_min: null });
    expect(cleanConfig({ team: { names: ["<b>A</b>", "B"], spd: 2, first: 1, max_stint_min: null } }).team.names).toEqual(["bA/b", "B"]);
    expect(() => cleanConfig({ team: { names: ["A"], spd: 1, first: 1, max_stint_min: null } })).toThrow(ValueError);
    expect(() => cleanConfig({ team: { names: [], spd: 1, first: 0, max_stint_min: null } })).toThrow(ValueError);
  });
});
