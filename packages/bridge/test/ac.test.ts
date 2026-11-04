import { describe, expect, test } from "vitest";
import { decodeAc, ThirdSectors } from "../src/telemetry/ac-pages.js";
import { Telemetry } from "../src/telemetry/telemetry.js";

const utf16 = (b: Buffer, o: number, s: string) => b.write(s, o, "utf16le");

describe("Assetto Corsa pages", () => {
  const p = Buffer.alloc(580), g = Buffer.alloc(1260), s = Buffer.alloc(590);
  p.writeFloatLE(0.8, 4); p.writeInt32LE(3, 16); p.writeFloatLE(180, 28); p.writeFloatLE(41.5, 12);
  g.writeInt32LE(2, 4); g.writeInt32LE(2, 8); g.writeInt32LE(3, 132); g.writeInt32LE(1, 136); g.writeInt32LE(91234, 144);
  g.writeFloatLE(30, 252); g.writeFloatLE(1, 256); g.writeFloatLE(40, 260); g.writeInt32LE(1, 160); g.writeInt32LE(4, 172);
  utf16(s, 68, "ks_ferrari_488_gt3"); utf16(s, 134, "monza"); utf16(s, 200, "Ann"); utf16(s, 266, "Driver");
  utf16(s, 524, "gp"); s.writeInt32LE(3, 400); s.writeFloatLE(5793, 520);

  test("reads the shared pages", () => {
    const r = decodeAc(p, g, s, 0);
    expect(r).toMatchObject({ gas: expect.closeTo(0.8, 5), gear: 3, speed: 180, laps: 3, last_ms: 91234, car: "ks_ferrari_488_gt3", track: "monza gp", name: "Ann Driver", sectors: 3, pit_lane: 1, me: 0, flag: 4 });
    expect(r.xyz).toEqual([30, 1, 40]);
    expect(r.g_flags[4]).toBe(1);
  });

  test("the telemetry accepts it", () => {
    const t = new Telemetry();
    const r = decodeAc(p, g, s, 0);
    const out = t.update(r);
    expect(out.reading.fixed.car_model).toBe("ks_ferrari_488_gt3");
    expect(out.reading.session.missing_mandatory_pits).toBeNull();
    expect(out.reading.fixed.car_class).toBe("");
    t.update({ ...r, laps: 4 });
    t.summary(r, null);
  });

  test("a track without sectors is cut in thirds", () => {
    const th = new ThirdSectors();
    const at = (laps: number, pos: number, ms: number) => { const r = { sectors: 0, laps, track_pos: pos, cur_ms: ms } as Record<string, number>; th.apply(r); return r; };
    expect(at(0, 0.1, 10000)).toMatchObject({ sectors: 3, sector: 0 });
    expect(at(0, 0.4, 40000)).toMatchObject({ sector: 1, last_sector_ms: 40000 });
    expect(at(0, 0.7, 75000)).toMatchObject({ sector: 2, last_sector_ms: 35000 });
    expect(at(1, 0.01, 500)).toMatchObject({ sector: 0 });
  });
});

import { parseFastLane } from "../src/ac-track.js";
describe("AI racing line", () => {
  test("becomes a layout with lap fractions", () => {
    const n = 200, b = Buffer.alloc(16 + 20 * n);
    b.writeInt32LE(7, 0); b.writeInt32LE(n, 4);
    for (let k = 0; k < n; k++) { const o = 16 + 20 * k; b.writeFloatLE(k, o); b.writeFloatLE(2 * k, o + 8); b.writeFloatLE(10 * k, o + 12); }
    const lay = parseFastLane(b)!;
    expect(lay.line).toHaveLength(n);
    expect(lay.line[0]).toEqual([0, 0, 0]);
    expect(lay.line[n - 1]).toEqual([n - 1, 2 * (n - 1), 1]);
    expect(parseFastLane(Buffer.alloc(10))).toBeNull();
  });
});

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateSections } from "../src/ac-track.js";
describe("timing gates", () => {
  test("are read from the layout's models and placed on the line", () => {
    const root = mkdtempSync(join(tmpdir(), "ac-"));
    const dir = join(root, "content", "tracks", "t");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "models_lay.ini"), "[MODEL_0]\nFILE=a.kn5\n");
    const node = (name: string, x: number, z: number) => {
      const b = Buffer.alloc(4 + name.length + 5 + 64);
      b.writeInt32LE(name.length, 0); b.write(name, 4, "latin1"); b.writeInt32LE(1, 4 + name.length); b.writeFloatLE(x, 4 + name.length + 5 + 48); b.writeFloatLE(z, 4 + name.length + 5 + 56);
      return b;
    };
    writeFileSync(join(dir, "a.kn5"), Buffer.concat([Buffer.alloc(100), node("AC_TIME_0_L", 0, 0), node("AC_TIME_1_L", 90, 10), node("AC_TIME_1_R", 110, 10), Buffer.alloc(50)]));
    const line = Array.from({ length: 200 }, (_, k) => [k, 0, k / 199]);
    expect(gateSections(root, "t", "lay", line)).toEqual([line[100]![2]]);
  });
});
