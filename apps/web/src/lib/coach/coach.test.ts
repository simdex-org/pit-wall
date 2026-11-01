import { describe, expect, it } from "vitest";
import { LapData, NB } from "../../state/recorder";
import { binMOf, findCorners, timeAt } from "./measure";
import { buildReport, CoachLap, progress, Report, snapshot } from "./report";

const LEN = 399 * 12.5, BM = binMOf(LEN), TOP = 250;
const TRACK = [{ a: 40, v: 80 }, { a: 100, v: 120 }, { a: 150, v: 70 }, { a: 210, v: 140 }, { a: 270, v: 90 }, { a: 340, v: 110 }];
/** Per corner: braking starts this many bins earlier, the slowest point is this many km/h faster, the throttle comes this many bins later. */
interface Fault { onset?: number; min?: number; pick?: number }

function synth(faults: Record<number, Fault> = {}): LapData {
  const d = Object.fromEntries(["t", "speed", "thr", "brk", "steer", "gear", "rpm", "glat", "glon", "tc", "abs"].map((k) => [k, new Float32Array(NB)])) as unknown as LapData;
  TRACK.forEach((c, k) => {
    const f = faults[k + 1] ?? {}, on = c.a - 11 - (f.onset ?? 0), vm = c.v + (f.min ?? 0), pick = c.a + 1 + (f.pick ?? 0), acc = 14 + (f.pick ?? 0);
    for (let i = 0; i < NB; i++) {
      const sp = i >= on && i <= c.a ? TOP + ((vm - TOP) * (i - on)) / (c.a - on) : i > c.a && i <= c.a + acc ? vm + ((TOP - vm) * (i - c.a)) / acc : TOP;
      d.speed[i] = k === 0 || d.speed[i] === 0 ? sp : Math.min(d.speed[i]!, sp);
      if (i >= on && i <= c.a - 4) d.brk[i] = 1; else if (i > c.a - 4 && i < c.a) d.brk[i] = 0.3 * (c.a - i) / 4;
      d.thr[i] = i >= on && i < pick ? 0 : i >= pick && i < pick + 4 ? (i - pick + 1) / 4 : d.thr[i] === 0 && i > c.a ? 1 : d.thr[i] ?? 1;
      d.steer[i] = d.steer[i]! + (k % 2 ? -1 : 1) * 0.5 * Math.exp(-(((i - c.a) / 6) ** 2));
    }
  });
  for (let i = 0; i < NB; i++) {
    if (d.thr[i] === 0 && d.brk[i] === 0 && !TRACK.some((c) => d.speed[i]! < TOP && i >= c.a - 12 && i <= c.a + 30)) d.thr[i] = 1;
    d.glat![i] = Math.abs(d.steer[i]!) * 2.4; d.gear[i] = Math.min(6, 1 + Math.floor(d.speed[i]! / 45)); d.rpm[i] = d.speed[i]! * 30;
    if (i) d.t[i] = d.t[i - 1]! + (BM / (d.speed[i]! / 3.6)) * 1000;
  }
  return d;
}

const lap = (id: string, n: number, faults?: Record<number, Fault>): CoachLap => { const data = synth(faults); return { id, n, ms: data.t[NB - 1]!, valid: true, src: "bridge", label: "", data }; };
const ok = (r: ReturnType<typeof buildReport>): Report => { if ("msg" in r) throw new Error(r.msg); return r; };
const run = (subject: CoachLap, bench: CoachLap | null, more: CoachLap[] = []) => ok(buildReport({ laps: [subject, ...(bench ? [bench] : []), ...more], subject: subject.id, bench: bench ? bench.id : null, len: LEN }));
const pool = [lap("p1", 1), lap("p2", 2, { 1: { onset: 0.4 } }), lap("p3", 3, { 2: { min: -0.5 } }), lap("p4", 4, { 3: { pick: 0.6 } })];

describe("corners", () => {
  it("finds every corner and the zones tile the lap exactly", () => {
    const cs = findCorners(pool.map((l) => l.data), BM);
    expect(cs).toHaveLength(TRACK.length);
    cs.forEach((c, k) => expect(Math.abs(c.apex - TRACK[k]!.a)).toBeLessThanOrEqual(1));
    for (let k = 0; k + 1 < cs.length; k++) { expect(cs[k]!.end).toBe(cs[k + 1]!.start); expect(cs[k]!.start).toBeLessThan(cs[k]!.apex); }
    const d = pool[0]!.data, sum = cs.reduce((a, c) => a + timeAt(d, c.end) - timeAt(d, c.start), 0);
    expect(Math.abs(sum - d.t[NB - 1]!)).toBeLessThan(0.5);
  });
});

describe("the report", () => {
  it("finds nothing between two identical laps", () => {
    const r = run(lap("s", 9), lap("b", 5), pool);
    expect(r.corners.every((c) => c.kind === "even")).toBe(true);
    expect(r.focus).toHaveLength(0);
  });

  it("names early braking in the right corner and nowhere else", () => {
    const r = run(lap("s", 9, { 3: { onset: 3 } }), lap("b", 5), pool);
    const hit = r.corners.filter((c) => c.kind === "loss");
    expect(hit.map((c) => c.corner.n)).toEqual([3]);
    expect(hit[0]!.causes[0]!.id).toBe("brake-early");
    expect(hit[0]!.causes[0]!.text).toMatch(/Braked 3\d m earlier/);
    expect(r.focus[0]!.n).toBe(3);
    expect(r.focus[0]!.short).toMatch(/brake \d+ m later/);
  });

  it("the corner differences add up to the lap difference", () => {
    const s = lap("s", 9, { 2: { min: -12 }, 5: { onset: 2 } }), b = lap("b", 5), r = run(s, b, pool);
    expect(Math.abs(r.total - (s.ms - b.ms))).toBeLessThan(1);
  });

  it("explains a low slowest point and a late throttle", () => {
    const r = run(lap("s", 9, { 2: { min: -10 }, 5: { pick: 4 } }), lap("b", 5), pool);
    expect(r.corners[1]!.causes.map((c) => c.id)).toContain("low-min");
    expect(r.corners[4]!.causes.map((c) => c.id)).toContain("late-throttle");
    expect(r.corners[4]!.causes.find((c) => c.id === "late-throttle")!.ms).toBeGreaterThan(0);
  });

  it("calls a slower lap in the same corner a gain the other way round", () => {
    const r = run(lap("s", 9), lap("b", 5, { 4: { onset: 3 } }), pool);
    expect(r.corners[3]!.kind).toBe("gain");
    expect(r.corners[3]!.causes).toHaveLength(0);
  });

  it("sees a habit across corners", () => {
    const r = run(lap("s", 9, { 1: { onset: 3 }, 2: { onset: 3 }, 4: { onset: 3 }, 5: { onset: 3 } }), lap("b", 5), pool);
    expect(r.patterns[0]!.id).toBe("brake-early");
    expect(r.patterns[0]!.text).toMatch(/4 of 6 corners/);
  });

  it("with no benchmark, compares each corner with the best of the session", () => {
    const r = run(lap("s", 9, { 3: { onset: 3 } }), null, [lap("g", 1), lap("h", 2, { 1: { onset: 1 } })]);
    expect(r.corners.filter((c) => c.kind === "loss").map((c) => c.corner.n)).toEqual([3]);
    expect(r.corners[2]!.bench).not.toBe("s");
    expect(r.corners[2]!.potential).toBeGreaterThan(30);
  });

  it("warns on a lap far behind the best and does not trust its causes", () => {
    const r = run(lap("s", 9, { 1: { onset: 6, min: -30 }, 2: { onset: 6, min: -30 }, 3: { onset: 6, min: -30 }, 4: { onset: 6, min: -30 }, 5: { onset: 6, min: -30 }, 6: { onset: 6, min: -30 } }), lap("b", 5), pool);
    expect(r.notes.join(" ")).toMatch(/slower than your best/);
    expect(r.corners.filter((c) => c.kind === "loss").every((c) => c.conf === "low")).toBe(true);
  });

  it("skips what needs missing channels and says so", () => {
    const s = lap("s", 9, { 3: { onset: 3 } }), b = lap("b", 5);
    delete s.data.glat; delete s.data.tc; delete s.data.abs;
    const r = run(s, b, pool);
    expect(r.notes.join(" ")).toMatch(/no cornering force/);
    expect(r.corners[2]!.causes[0]!.id).toBe("brake-early");
  });

  it("checks on the next lap whether a tip was followed", () => {
    const b = lap("b", 5), first = run(lap("s1", 9, { 3: { onset: 3 } }), b, pool), snap = snapshot(first);
    const next = run(lap("s2", 10, { 3: { onset: 1 } }), b, pool), lines = progress(snap, next);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/T3.*closer.*better/);
    expect(progress(snap, first)).toEqual([]);
  });
});
