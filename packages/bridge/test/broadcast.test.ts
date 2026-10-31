import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { enable, readConfig } from "../src/broadcast/config.js";
import { FakeField } from "../src/broadcast/fake-field.js";
import { wrap } from "../src/broadcast/field.js";
import { PIT_LOCS } from "../src/broadcast/models.js";
import { MAXI, packRegister, packRequest, parse, testing } from "../src/broadcast/wire.js";
import { FakePages } from "../src/telemetry/fake-pages.js";
import { Rec, ValueError } from "../src/util.js";

const { str } = testing;
const b = (...parts: Buffer[]) => Buffer.concat(parts);
const u8 = (...v: number[]) => Buffer.from(v);
const u16 = (v: number) => { const x = Buffer.alloc(2); x.writeUInt16LE(v); return x; };
const i32 = (v: number) => { const x = Buffer.alloc(4); x.writeInt32LE(v); return x; };
const f32 = (v: number) => { const x = Buffer.alloc(4); x.writeFloatLE(v); return x; };
const lapBytes = (ms: number, n = 3, bad = 0) => b(i32(ms), u16(1), u16(0), u8(n), ...[20000, 20000, MAXI].slice(3 - n).map(i32), u8(bad, 1, 0, 0));

const msgs: Record<number, Buffer> = {
  1: b(u8(1), i32(5), u8(1, 0), str("ok")),
  2: b(u8(2), u16(1), u16(2), u8(10, 5), f32(1000), f32(3600000), i32(3), str("set"), str("cam"), str("hud"), u8(0),
    f32(50400000), u8(22, 29, 2, 0, 0), lapBytes(59640)),
  3: b(u8(3), u16(12), u16(0), u8(1, 7), f32(1.5), f32(-2.5), f32(0.1), u8(1), u16(214), u16(1), u16(1), u16(1), f32(0.412), u16(18), i32(-120),
    lapBytes(59640), lapBytes(MAXI, 0), lapBytes(24123, 1, 1)),
  4: b(u8(4), i32(5), u16(3), u16(12), u16(7), u16(33)),
  5: b(u8(5), i32(5), str("spa"), i32(7), i32(7004), u8(1), str("set"), u8(1), str("cam"), u8(1), str("hud")),
  6: b(u8(6), u16(12), u8(32), str("Team \x07Bell"), i32(12), u8(1, 0), u16(3), u8(1), str("Aiko"), str("Mori"), str("MOR"), u8(2), u16(48)),
  7: b(u8(7), u8(3), str("Car 33 penalty"), i32(120000), i32(33)),
};

describe("wire", () => {
  test("seven message types parse and every truncation is refused", () => {
    for (const [kind, buf] of Object.entries(msgs)) {
      expect(parse(buf)[0]).toBe(Number(kind));
      for (let cut = 1; cut < buf.length; cut++) expect(() => parse(buf.subarray(0, cut)), `type ${kind} cut at ${cut}`).toThrow(ValueError);
    }
    expect(parse(msgs[1]!)[1]).toEqual({ conn: 5, success: true, readonly: true, msg: "ok" });
    const c = parse(msgs[3]!)[1];
    expect(c.gear).toBe(5); expect(c.last.ms).toBeNull(); expect(c.last.s).toEqual([null, null, null]); expect(c.best.s).toEqual([20000, 20000, null]);
    expect(c.cur.valid).toBe(false); expect(c.laps).toBe(18); expect(Math.abs(c.spl - 0.412)).toBeLessThan(1e-6);
    expect(parse(msgs[6]!)[1].team).toBe("Team Bell"); expect(parse(msgs[6]!)[1].drivers[0].short).toBe("MOR");
    expect(parse(msgs[5]!)[1].meters).toBe(7004); expect(parse(msgs[7]!)[1].car).toBe(33); expect(parse(msgs[4]!)[1].cars).toEqual([12, 7, 33]);
    expect(() => parse(Buffer.alloc(0))).toThrow(ValueError);
  });

  test("only registration and requests 9-11 can be built", () => {
    expect(packRegister("Pit Wall", "pw", 250).subarray(0, 2)).toEqual(Buffer.from([1, 4]));
    expect(packRequest(10, 5)).toEqual(Buffer.from([0x0a, 5, 0, 0, 0]));
    expect(() => packRequest(7 * 7 + 1, 1)).toThrow(ValueError);
    // no message type that moves the driver's camera, HUD or replay may sit next to a packer
    const src = readFileSync(new URL("../src/broadcast/wire.ts", import.meta.url), "utf-8").split("\n").filter((l) => l.includes("pack") && !l.trim().startsWith("//"));
    expect(src.filter((l) => /0x3[123]|\b(49|5[01])\b/.test(l))).toEqual([]);
  });
});

describe("broadcasting.json", () => {
  test("is kept as UTF-16LE when switched on", () => {
    const tmp = mkdtempSync(join(tmpdir(), "pw-"));
    const p = join(tmp, "broadcasting.json");
    writeFileSync(p, Buffer.from(JSON.stringify({ updListenerPort: 0, connectionPassword: "", commandPassword: "" }), "utf16le"));
    expect(readConfig(p).port).toBe(0);
    expect(enable(9000, p).endsWith("Restart ACC for this to take effect.")).toBe(true);
    const cfg = readConfig(p), raw = readFileSync(p);
    expect(cfg.port).toBe(9000); expect(cfg.password).toHaveLength(12);
    expect(raw[1]).toBe(0); expect(raw[0] === 0xff && raw[1] === 0xfe).toBe(false);
    expect(existsSync(p + ".bak")).toBe(true);
  });
});

describe("simulated field", () => {
  const hint = (pages: FakePages): Rec => { const r = pages.read(); return { id: r.me, laps: r.laps, spl: r.track_pos, name: r.name, xyz: r.xyz, kmh: r.speed }; };

  test("a 20-car race: order, gaps, pits, rel, net, rejoin", () => {
    const now = [0];
    const pages = new FakePages({ clock: () => now[0]! });
    const ff = new FakeField(pages);
    let pitted = false;
    for (let k = 0; k < 3 * 60 * 4; k++) { // three simulated minutes at 4 Hz
      now[0]! += 0.25;
      ff.step();
      pitted = pitted || [...ff.cars].some(([i, c]) => i !== 7 && PIT_LOCS.includes(c.loc));
    }
    const snap = ff.snapshot(hint(pages), 1, 25000);
    const cars: Rec[] = snap.cars;
    expect(cars).toHaveLength(20);
    expect(cars.map((c) => c.pos).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(snap.me).toBe(7); expect(snap.mode).toBe("race");
    const gaps = cars.map((c) => [c.gap_laps, c.gap]);
    expect(gaps.every(([, g]) => g !== null && g >= 0)).toBe(true);
    expect(gaps).toEqual([...gaps].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!));
    expect(pitted).toBe(true);
    const me = ff.cars.get(7)!;
    const rel = [...ff.cars].filter(([i]) => i !== 7).map(([, c]) => [wrap(c.spl - me.spl), c.rel] as const).sort((a, z) => Math.abs(a[0]) - Math.abs(z[0]));
    const ahead = rel.find(([f]) => f > 0)![1]!, behind = rel.find(([f]) => f < 0)![1]!;
    expect(ahead).toBeGreaterThan(0); expect(behind).toBeLessThan(0);
    expect(cars.every((c) => c.net)).toBe(true);
    expect(ff.rejoin(7, 30000)!.pos).toBeGreaterThanOrEqual(1);
    expect(ff.raceInfo()!.leader_dist).toBeGreaterThan(3);
    const [slow, seq] = ff.slowSince(-1);
    expect(Object.keys(slow)).toHaveLength(20);
    expect(ff.slowSince(seq)[0]).toEqual({});
    expect(Object.keys(ff.entries().cars)).toHaveLength(20);
    expect([...ff.cars.keys()].some((i) => ff.carLaps(i).length)).toBe(true);
    expect(snap.xz_ok).toBe(false);
  });

  test("qualifying is ordered by best lap and nobody pits", () => {
    const now = [0];
    const pages = new FakePages({ clock: () => now[0]! });
    const fq = new FakeField(pages, "quali");
    for (let k = 0; k < 3 * 60 * 4; k++) { now[0]! += 0.25; fq.step(); }
    const q: Rec[] = fq.snapshot(hint(pages), null, null).cars;
    const p1 = fq.cars.get(q[0]!.i)!.best;
    expect(q.every((c) => !fq.cars.get(c.i)!.best || c.gap === fq.cars.get(c.i)!.best - p1)).toBe(true);
    const bests = q.map((c) => fq.cars.get(c.i)!.best as number | null).filter((x): x is number => !!x);
    expect(bests).toEqual([...bests].sort((a, z) => a - z));
    expect(fq.rejoin(7, 30000)).toBeNull();
    expect([...fq.cars.values()].some((c) => PIT_LOCS.includes(c.loc))).toBe(false);
  });
});
