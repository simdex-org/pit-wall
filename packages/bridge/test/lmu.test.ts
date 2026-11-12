import { describe, expect, test } from "vitest";
import { toMessages } from "../src/broadcast/ac-plugin.js";
import { menuSnapshot, MenuRow, planMenu } from "../src/pit/lmu-menu.js";
import { cleanPlan } from "../src/pit/plan.js";
import { decodeLmu, EnergyLaps, LMU_SIZE } from "../src/telemetry/lmu-decode.js";
import { Telemetry } from "../src/telemetry/telemetry.js";

// Offsets from SharedMemoryInterface.hpp / InternalsPlugin.hpp: scoring info at 1632, cars from 2192 (584 each),
// telemetry block at 128464 with cars from 128468 (1888 each, wheels from +848, 260 each)
const SCO = 1632, VEH = (k: number) => 2192 + 584 * k, TEL = (k: number) => 128468 + 1888 * k, WH = (k: number, w: number) => TEL(k) + 848 + 260 * w;

function lmuBuffer(): Buffer {
  const b = Buffer.alloc(LMU_SIZE);
  b.write("Circuit de la Sarthe", SCO, "utf8");
  b.writeInt32LE(12, SCO + 64); // race
  b.writeDoubleLE(1000, SCO + 68); b.writeDoubleLE(4600, SCO + 76);
  b.writeInt32LE(2147483647, SCO + 84);
  b.writeDoubleLE(13626, SCO + 88);
  b.writeInt32LE(2, SCO + 104);
  b[SCO + 108] = 5; b[SCO + 115] = 1; b.writeInt8(1, SCO + 112);
  b.writeDoubleLE(0.4, SCO + 220); b.writeDoubleLE(18, SCO + 228); b.writeDoubleLE(26, SCO + 236);
  b.writeDoubleLE(3, SCO + 244); b.writeDoubleLE(4, SCO + 260);
  for (const [k, id, name, place, dist] of [[0, 7, "Ann Driver", 2, 6813], [1, 3, "Bo Other", 1, 9000]] as const) {
    const v = VEH(k);
    b.writeInt32LE(id, v); b.write(name, v + 4, "utf8"); b.write("Ferrari 499P #50", v + 36, "utf8");
    b.writeInt16LE(4, v + 100); b.writeInt8(2, v + 102); b.writeDoubleLE(dist, v + 104);
    b.writeDoubleLE(212.5, v + 144); b.writeDoubleLE(213.25, v + 168); b.writeDoubleLE(70, v + 176); b.writeDoubleLE(150, v + 184);
    b[v + 196] = k === 0 ? 1 : 0; b[v + 199] = place; b.write("Hyper", v + 200, "utf8");
    b.writeDoubleLE(100 * (k + 1), v + 264); b.writeDoubleLE(-50, v + 280); b[v + 506] = 2;
  }
  b[128464] = 2; b[128465] = 0; b[128466] = 1;
  const t = TEL(0);
  b.writeDoubleLE(1000, t + 12); b.writeDoubleLE(890, t + 24);
  b.writeDoubleLE(100, t + 160); b.writeDoubleLE(1, t + 168); b.writeDoubleLE(-50, t + 176);
  b.writeDoubleLE(0, t + 184); b.writeDoubleLE(0, t + 192); b.writeDoubleLE(-50, t + 200);
  b.writeDoubleLE(-9.81, t + 224);
  b.writeInt32LE(3, t + 352); b.writeDoubleLE(8000, t + 356); b.writeDoubleLE(0.75, t + 420);
  b.writeDoubleLE(55.5, t + 524); b.writeDoubleLE(90, t + 608); b.writeDoubleLE(0.46, t + 664);
  b[t + 544] = 2; b[t + 550] = 1; // front, right
  b[t + 747] = 1; b[t + 750] = 4;
  b.writeFloatLE(0.62, t + 776); b.writeFloatLE(1.5, t + 780);
  b.write("499P", t + 796, "utf8"); b.write("Medium", t + 620, "utf8");
  for (let w = 0; w < 4; w++) {
    b.writeDoubleLE(273.15 + 400, WH(0, w) + 24); b.writeDoubleLE(172.4, WH(0, w) + 120);
    b.writeDoubleLE(0.9 - w / 10, WH(0, w) + 152); b.writeDoubleLE(273.15 + 85, WH(0, w) + 204);
    b[WH(0, w) + 176] = w === 3 ? 2 : 0; b[WH(0, w) + 241] = 1;
  }
  return b;
}

describe("Le Mans Ultimate shared memory", () => {
  const r = decodeLmu(lmuBuffer());

  test("reads the player's car", () => {
    expect(r).toMatchObject({ game: "lmu", status: 2, session: 2, gear: 4, rpm: 8000, gas: 0.75, fuel: 55.5, max_fuel: 90, laps: 4, position: 2,
      cur_ms: 110000, last_ms: 213250, best_ms: 212500, time_left: 3600000, car: "499P", track: "Circuit de la Sarthe", name: "Ann Driver",
      me: 7, sector: 1, last_sector_ms: 70000, track_len: 13626, compound: "Medium", tc_on: 1, tc: 4, tyres_out: 1, gap_ahead: 1500, timed: 1 });
    expect(r.speed).toBeCloseTo(180, 5);
    expect(r.track_pos).toBeCloseTo(0.5, 6);
    expect(r.bias).toBeCloseTo(0.54, 6);
    expect(r.acc_g[2]).toBeCloseTo(1, 6);
    expect(r.pressure[0]).toBeCloseTo(25, 1);
    expect(r.core_temp[0]).toBeCloseTo(85, 6);
    expect(r.brake_temp[0]).toBeCloseTo(400, 6);
    expect(r.xyz).toEqual([100, 1, -50]);
    expect(r.damage).toEqual([100, 0, 0, 50, 0]);
    expect(r.coords).toEqual({ 7: [100, -50], 3: [200, -50] });
    expect(r.wind).toBeCloseTo(5, 6);
    expect(r.rain).toEqual([2, 2, 2]);
    expect(r.g_flags).toEqual([1, 0, 0, 1, 0, 1, 0, 0]);
    expect(r.flag).toBe(2);
  });

  test("keeps what only LMU has", () => {
    expect(r.lmu).toMatchObject({ class: "Hyper", compounds: [1, 1, 1, 1] });
    expect(r.lmu.energy).toBeCloseTo(0.62, 5);
    expect(r.lmu.tread).toEqual([0.9, 0.8, 0.7, 0.6].map((x) => expect.closeTo(x, 6)));
    expect(r.cars).toHaveLength(2);
    expect(r.cars[1]).toMatchObject({ i: 3, pos: 1, laps: 4, cls: "Hyper", best: 212500 });
  });

  test("an empty mapping is no session", () => {
    expect(decodeLmu(Buffer.alloc(LMU_SIZE)).status).toBe(0);
  });

  test("the telemetry accepts it and passes the game on", () => {
    const t = new Telemetry();
    const out = t.update(r);
    expect(out.reading.game).toBe("lmu");
    expect(out.reading.lmu.energy).toBeCloseTo(0.62, 5);
    expect(out.reading.fixed.car_model).toBe("499P");
    t.update({ ...r, laps: 5 });
    t.summary(r, null);
  });

  test("the field takes the game's own positions", () => {
    const msgs = toMessages({ track: r.track, config: "", cars: r.cars, t: 1000 }, { session: 2, len: 13626 }, { track: "", ids: "", names: new Map() });
    const cars = msgs.filter(([k]) => k === 3).map(([, d]) => [d.i, d.pos]);
    expect(cars).toEqual([[7, 2], [3, 1]]);
  });

  test("virtual energy per lap comes from the line crossings", () => {
    const e = new EnergyLaps();
    const at = (laps: number, energy: number) => { const x = { status: 2, laps, lmu: { energy } } as Record<string, any>; e.apply(x); return x.lmu; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    at(1, 0.9);
    expect(at(2, 0.84).per_lap).toBeCloseTo(0.06, 6);
    expect(at(3, 0.76).per_lap).toBeCloseTo(0.07, 6);
    expect(at(4, 1).per_lap).toBeCloseTo(0.07, 6); // refuelled: not a lap's use
  });
});

const menu = (): MenuRow[] => [
  { name: "VIRTUAL ENERGY:", currentSetting: 50, settings: Array.from({ length: 101 }, (_, k) => ({ text: `${k}%` })) },
  { name: "FUEL RATIO:", currentSetting: 1, settings: [{ text: "0.80" }, { text: "0.90" }, { text: "1.00" }] },
  { name: "TIRES:", currentSetting: 0, settings: [{ text: "No Change" }, { text: "New Medium", type: "Medium" }, { text: "Used Medium", type: "Medium", isUsed: true }, { text: "New Wet", type: "Wet" }] },
  ...["FL", "FR", "RL", "RR"].map((c) => ({ name: `${c} TIRE:`, currentSetting: 0, settings: [{ text: "No Change" }, { text: "New Medium", type: "Medium" }, { text: "New Wet", type: "Wet" }] })),
  ...["FL", "FR", "RL", "RR"].map((c) => ({ name: `${c} PRESS:`, currentSetting: 0, settings: [{ text: "165 kPa" }, { text: "172 kPa" }, { text: "179 kPa" }] })),
  { name: "DAMAGE:", currentSetting: 0, settings: [{ text: "Do Not Repair" }, { text: "Repair Body" }, { text: "Repair All" }] },
  { name: "REPLACE BRAKES:", currentSetting: 0, settings: [{ text: "No" }, { text: "Yes" }] },
];

describe("Le Mans Ultimate pit menu", () => {
  const car = { fuel: 20, compound: "Medium", pressure: [25, 25, 25, 25] };

  test("reads fuel to add and pressures from the menu", () => {
    const s = menuSnapshot(menu(), car);
    expect(s.fuel).toBeCloseTo(25, 6); // 50 % x 0.9 = 45 L after the stop
    expect(s.pressures[0]).toBeCloseTo(23.93, 2);
  });

  test("sets virtual energy, new tyres of the same compound, pressures and repairs", () => {
    const plan = cleanPlan({ fuel: 52, tyres: true, compound: "dry", tyre_set: 1, pressures: [25, 25, 26, 26], brakes: true, front_pad: 1, rear_pad: 1, repair_suspension: false, repair_bodywork: true });
    const m0 = menu();
    const { menu: m, res } = planMenu(m0, plan, car);
    const at = (n: string) => m.find((r) => r.name === n)!.currentSetting;
    expect(at("VIRTUAL ENERGY:")).toBe(80); // 72 L / 0.9
    expect(at("TIRES:")).toBe(1);
    expect(at("RR TIRE:")).toBe(1);
    expect([at("FL PRESS:"), at("RL PRESS:")]).toEqual([1, 2]);
    expect(at("DAMAGE:")).toBe(1);
    expect(at("REPLACE BRAKES:")).toBe(1);
    expect(res).toMatchObject({ compound: "ok", tyres: "sent", repairs: "sent", brakes: "ok", tyre_set: "not in Le Mans Ultimate", front_pad: "not in Le Mans Ultimate" });
    expect(m0[0]!.currentSetting).toBe(50);
  });

  test("wet tyres, no tyres, only the parts asked for", () => {
    const wet = planMenu(menu(), cleanPlan({ only: ["tyres"], tyres: true, compound: "wet", tyre_set: 1, pressures: [25, 25, 25, 25] }), car).menu;
    expect(wet.find((r) => r.name === "TIRES:")!.currentSetting).toBe(3);
    expect(wet.find((r) => r.name === "FL TIRE:")!.currentSetting).toBe(2);
    expect(wet.find((r) => r.name === "VIRTUAL ENERGY:")!.currentSetting).toBe(50);
    const none = planMenu(menu().map((r) => (r.name.includes("TIRE") ? { ...r, currentSetting: 1 } : r)), cleanPlan({ only: ["tyres"], tyres: false, compound: "dry", tyre_set: 1, pressures: [25, 25, 25, 25] }), car).menu;
    expect(none.filter((r) => r.name.includes("TIRE")).every((r) => r.currentSetting === 0)).toBe(true);
  });

  test("a car without virtual energy picks the smallest fuel level that is enough", () => {
    const fuel: MenuRow = { name: "FUEL:", currentSetting: 0, settings: [{ text: "30l/8 laps" }, { text: "40l/11 laps" }, { text: "50l/14 laps" }] };
    const { menu: m, res } = planMenu([fuel], cleanPlan({ only: ["fuel"], fuel: 18 }), car);
    expect(m[0]!.currentSetting).toBe(1);
    expect(res.fuel).toBe("ok");
    expect(planMenu([fuel], cleanPlan({ only: ["fuel"], fuel: 90 }), car).res.fuel).toBe("tank full");
    expect(planMenu([{ name: "DAMAGE:", currentSetting: 0, settings: [{ text: "N/A" }] }], cleanPlan({ only: ["repairs"], repair_suspension: true, repair_bodywork: true }), car).res.repairs).toBe("nothing to repair");
  });
});
