// What the page keeps between readings. The bridge is the source of whole-lap traces and racing lines (GET /lap?n=N, fetched
// once each); the page itself records only the lap in progress, the 60 s live trace and the G peaks.
import { aux } from "../engine/versions";
import { Ctx, feed } from "../feed/store";
import type { Json } from "../feed/types";
import { download } from "../lib/files";
import { okMs } from "../lib/format";
import { lsRaw } from "../lib/storage";
import { cleanText, isObj } from "../lib/text";
import { get } from "./bridge";
import { selection } from "./selection";

/** Bins per lap, and the channels the bridge sends for each. */
export const NB = 400;
export const LCH = ["t", "speed", "thr", "brk", "steer", "gear", "rpm"] as const;
export type LapChannel = (typeof LCH)[number];
export type LapData = Record<LapChannel, Float32Array>;

export const TRACE_N = 3600; // 60 s at 60 Hz
export const TRACE_KEYS = ["speed", "thr", "brk", "clu", "steer", "rpm", "gear", "fuel", "gLat", "gLon", "tFL", "tFR", "tRL", "tRR", "pFL", "pFR", "pRL", "pRR"] as const;
export type TraceKey = (typeof TRACE_KEYS)[number];
export interface Ring { i: number; n: number; data: Record<TraceKey, Float32Array> }

export interface RecLap { id: string; n: number; ms: number; valid: boolean; src: "live" | "bridge" | "import"; label: string; data: LapData | null }
export type LinePoint = [x: number, z: number, spl?: number];
export interface RecLine { n: number; valid: boolean; ms: number; pts: LinePoint[] }
export interface Layout { track: string; pts: [number, number, number][]; sec: number[] }
interface Sample { p: number; t: number; speed: number; thr: number; brk: number; steer: number; gear: number; rpm: number }

const CORNER_KEYS = ["FL", "FR", "RL", "RR"] as const;
const coreT = (c: Json, i: number, cap: Json) => (cap?.tyre_edge_temps ? (c.tyre_temp_inner_c[i] + c.tyre_temp_middle_c[i] + c.tyre_temp_outer_c[i]) / 3 : c.tyre_core_temp_c[i]);

const newRing = (): Ring => ({ i: 0, n: 0, data: Object.fromEntries(TRACE_KEYS.map((k) => [k, new Float32Array(TRACE_N)])) as Record<TraceKey, Float32Array> });

export const lapNo = (id: string | null | undefined): number => {
  const m = /^lap-(\d+)$/.exec(id ?? "");
  return m ? +m[1]! : 0;
};

class Recorder {
  ver = 0;
  trace = newRing();
  /** A copy of the ring while the live channels are paused. */
  frozen: Ring | null = null;
  /** Own laps newest first, imports last. */
  laps: RecLap[] = [];
  /** Racing lines, newest first (a point every 1.5 m). */
  lines: RecLine[] = [];
  curLine: LinePoint[] = [];
  cur: Sample[] = [];
  /** How far, on average, the last line was from the best line. */
  spread: { m: number; last: number; best: number } | null = null;
  maxRpm = 0;
  fuelMax = 0;
  gHist = { maxLat: 0, maxLon: 0 };
  layout: Layout | null = null;
  pending = new Set<number>();
  failed = new Set<number>();
  private layoutTried = "";
  private imp = 0;
  private prevLaps: number | null = null;
  private prevValid = true;
  private posT = 0;
  private lastR: Json | null = null;
  private lastLaps: Json[] | null = null;
  private lastSel = "";

  private bump(): void { this.ver++; aux.bump("rec"); }

  /** Called on every feed update; acts when a new reading or a new lap list arrived. */
  onFeed(c: Ctx): void {
    if (c.r && c.r !== this.lastR) { this.lastR = c.r; this.onReading(c.r); }
    if (c.laps !== this.lastLaps) { this.lastLaps = c.laps; this.wantLaps(c); void this.ensureLayout(c.r); }
    const sel = `${selection.get().ref}|${selection.get().cmp}`;
    if (sel !== this.lastSel) { this.lastSel = sel; this.wantLaps(c); }
  }

  private pushTrace(c: Json, cap: Json): void {
    const T = this.trace, v: Record<string, number> = {
      speed: c.speed_kmh, thr: c.throttle, brk: c.brake, clu: c.clutch, steer: c.steer_angle, rpm: c.rpm, gear: c.gear, fuel: c.fuel_litres, gLat: c.acc_g[0], gLon: c.acc_g[2],
    };
    for (let i = 0; i < 4; i++) { v["t" + CORNER_KEYS[i]] = coreT(c, i, cap); v["p" + CORNER_KEYS[i]] = c.tyre_pressure_psi[i]; }
    for (const k of TRACE_KEYS) T.data[k][T.i] = isFinite(v[k]!) ? v[k]! : 0;
    T.i = (T.i + 1) % TRACE_N;
    T.n = Math.min(T.n + 1, TRACE_N);
    this.fuelMax = Math.max(this.fuelMax, c.fuel_litres || 0);
    const gl = Math.abs(v.gLat!), gn = Math.abs(v.gLon!);
    // A kerb spike over 5 g is noise, not a peak.
    if (gl < 5 && gl > this.gHist.maxLat) this.gHist.maxLat = gl;
    if (gn < 5 && gn > this.gHist.maxLon) this.gHist.maxLon = gn;
  }

  setPaused(on: boolean): void {
    this.frozen = on ? { i: this.trace.i, n: this.trace.n, data: Object.fromEntries(TRACE_KEYS.map((k) => [k, this.trace.data[k].slice()])) as Record<TraceKey, Float32Array> } : null;
    this.bump();
  }

  private sample(s: Json, c: Json): void {
    const p = s.track_position, l = this.cur[this.cur.length - 1];
    if (l && p <= l.p) return; // position must advance; drops jitter and the wrap after the line
    this.cur.push({ p, t: s.current_lap_ms, speed: c.speed_kmh, thr: c.throttle, brk: c.brake, steer: c.steer_angle, gear: c.gear, rpm: c.rpm });
  }

  /** The same algorithm as the bridge's, so live and bridge laps compare bin for bin. */
  private resample(smp: Sample[], ms: number): LapData {
    const d = Object.fromEntries(LCH.map((k) => [k, new Float32Array(NB)])) as LapData;
    let j = 0;
    for (let i = 0; i < NB; i++) {
      const p = i / (NB - 1);
      while (j < smp.length - 2 && smp[j + 1]!.p < p) j++;
      const a = smp[j]!, b = smp[j + 1]!, f = b.p > a.p ? Math.max(0, Math.min(1, (p - a.p) / (b.p - a.p))) : 0;
      for (const k of LCH) d[k][i] = a[k] + (b[k] - a[k]) * f;
    }
    for (let i = 0; i < NB; i++) d.gear[i] = Math.round(d.gear[i]!);
    const end = d.t[NB - 1]!;
    if (end > 0 && ms > 0) { const sc = ms / end; for (let i = 0; i < NB; i++) d.t[i] = d.t[i]! * sc; } // the last point is the official lap time
    return d;
  }

  private finishLap(n: number, ms: number, valid: boolean): void {
    const cur = this.cur, curLine = this.curLine;
    const whole = cur.length > 60 && cur[0]!.p < 0.1 && cur[cur.length - 1]!.p > 0.9;
    // Only whole laps: a part lap cannot be compared. The bridge copy replaces this one.
    if (whole && curLine.length > 50) {
      if (!this.laps.some((l) => l.id === "lap-" + n && l.src === "bridge")) this.putLap({ id: "lap-" + n, n, ms, valid, src: "live", label: "", data: this.resample(cur, ms) });
      if (!this.lines.some((l) => l.n === n)) this.putLine({ n, valid, ms, pts: curLine });
    }
    this.cur = []; this.curLine = [];
    this.bump();
  }

  private putLap(l: RecLap): void {
    const i = this.laps.findIndex((x) => x.id === l.id);
    if (i >= 0) this.laps[i] = l; else this.laps.push(l);
    const own = this.laps.filter((x) => x.src !== "import").sort((a, b) => b.n - a.n), imp = this.laps.filter((x) => x.src === "import");
    const sel = [selection.get().ref, selection.get().cmp];
    while (own.length > 40) { // the cap applies to live and bridge laps; imports are never evicted
      let k = own.length - 1;
      while (k > 0 && sel.includes(own[k]!.id)) k--;
      own.splice(k, 1);
    }
    this.laps = own.concat(imp);
  }

  bestLine(): RecLine | null {
    const ok = this.lines.filter((l) => l.valid);
    return ok.length ? ok.reduce((a, b) => (b.ms < a.ms ? b : a)) : null;
  }

  private putLine(l: RecLine): void {
    this.lines = this.lines.filter((x) => x.n !== l.n).concat([l]).sort((a, b) => b.n - a.n);
    const keep = this.bestLine(); // the best line stays: the field is placed on it
    while (this.lines.length > 12) { const k = this.lines.length - 1 - (this.lines[this.lines.length - 1] === keep ? 1 : 0); this.lines.splice(k, 1); }
    this.lineSpread();
  }

  private lineSpread(): void {
    const last = this.lines[0], best = this.bestLine();
    if (!best || !last || best === last) { this.spread = null; return; }
    let sum = 0, k = 0;
    for (let i = 0; i < last.pts.length; i += Math.max(1, Math.floor(last.pts.length / 200))) { // 200 samples against the whole best line
      const [x, z] = last.pts[i]!;
      let d = Infinity;
      for (const [bx, bz] of best.pts) d = Math.min(d, (bx - x) ** 2 + (bz - z) ** 2);
      sum += Math.sqrt(d); k++;
    }
    this.spread = { m: sum / k, last: last.n, best: best.n };
  }

  /** A new session: own laps and lines belong to the old one. */
  private resetSession(): void {
    this.laps = this.laps.filter((l) => l.src === "import"); this.lines = []; this.curLine = []; this.cur = []; this.spread = null;
    this.failed.clear(); this.gHist = { maxLat: 0, maxLon: 0 };
    this.bump();
  }

  private onReading(r: Json): void {
    const c = r.car, s = r.session, cap = r.capabilities ?? {};
    this.maxRpm = r.fixed.max_rpm || this.maxRpm;
    if (this.prevLaps != null && s.completed_laps < this.prevLaps) this.resetSession();
    if (this.prevLaps != null && s.completed_laps > this.prevLaps) {
      if (s.last_lap_ms > 0) this.finishLap(s.completed_laps, s.last_lap_ms, this.prevValid); else { this.cur = []; this.curLine = []; }
    }
    this.prevLaps = s.completed_laps; this.prevValid = s.lap_is_valid;
    this.pushTrace(c, cap); this.sample(s, c);
    void this.ensureLayout(r);
    const p = s.car_position_m;
    if (p && (p[0] || p[2])) {
      const l = this.curLine[this.curLine.length - 1], d = l ? Math.hypot(l[0] - p[0], l[1] - p[2]) : 0, now = performance.now();
      const dt = this.posT ? Math.max(1 / 30, (now - this.posT) / 1000) : 1 / 30; // a stalled feed lets the car go further between readings
      this.posT = now;
      // A jump (out of the garage, a reset): start the line again rather than draw a straight across; the lap is no longer whole.
      if (d > 60 && d > (c.speed_kmh / 3.6) * dt * 1.5 + 20) { this.curLine = [[p[0], p[2], s.track_position]]; this.cur = []; }
      else if (!l || d > 1.5) this.curLine.push([p[0], p[2], s.track_position]);
    }
  }

  // ---------- laps from the bridge: fetched once each, so a reload or a late joiner sees them too ----------

  /** Once per track, and again after the first whole lap, when the bridge has saved one. */
  async ensureLayout(r: Json | null): Promise<void> {
    const t = r?.fixed.track as string | undefined;
    if (!t || this.layout?.track === t) return;
    const k = t + "|" + this.lines.length;
    if (this.layoutTried === k) return;
    this.layoutTried = k;
    const j = await get<Json>("/track");
    if (!j || !Array.isArray(j.line) || j.line.length < 100) return;
    this.layout = {
      track: t,
      pts: (j.line as unknown[]).filter((q): q is number[] => Array.isArray(q) && q.length > 2 && q.every((v) => typeof v === "number" && isFinite(v))).map((q) => [q[0]!, q[1]!, q[2]!]),
      sec: (Array.isArray(j.sec) ? (j.sec as number[]) : []).filter(isFinite).sort((a, b) => a - b),
    };
    this.bump();
  }

  layoutFor(track: string): Layout | null { return this.layout && this.layout.track === track ? this.layout : null; }

  lapById(id: string | null | undefined): RecLap | null { return id == null ? null : this.laps.find((l) => l.id === id) ?? null; }

  async ensureLap(n: number): Promise<void> {
    n = n | 0;
    if (!(n > 0) || this.pending.has(n) || this.failed.has(n) || this.laps.some((l) => l.id === "lap-" + n && l.src === "bridge")) return;
    this.pending.add(n);
    this.bump();
    const j = await get<Json>("/lap?n=" + n);
    this.pending.delete(n);
    if (!j || !isObj(j.ch) || !LCH.every((k) => Array.isArray(j.ch[k]) && j.ch[k].length === NB)) { this.failed.add(n); this.bump(); return; }
    const valid = j.valid !== false;
    this.putLap({ id: "lap-" + n, n, ms: +j.ms, valid, src: "bridge", label: "", data: Object.fromEntries(LCH.map((k) => [k, Float32Array.from(j.ch[k] as number[], (v) => (isFinite(v) ? v : 0))])) as LapData });
    if (Array.isArray(j.line) && j.line.length > 50) {
      this.putLine({
        n, valid, ms: +j.ms,
        pts: (j.line as unknown[]).filter((q): q is number[] => Array.isArray(q) && isFinite(q[0] as number) && isFinite(q[1] as number)).map((q) => (isFinite(q[2]!) ? [q[0]!, q[1]!, q[2]!] : [q[0]!, q[1]!]) as LinePoint),
      });
    }
    this.bump();
  }

  /** Map lines (the newest 12 traced), the best valid lap, and whatever is REF or CMP. */
  private wantLaps(c: Ctx): void {
    const tr = c.laps.filter((l) => l.trace), ok = tr.filter((l) => l.valid);
    const want = tr.slice(-12).map((l) => l.n as number);
    if (ok.length) want.push(ok.reduce((a, b) => (b.ms < a.ms ? b : a)).n);
    want.push(lapNo(selection.get().ref), lapNo(selection.get().cmp));
    for (const n of new Set(want)) if (n) void this.ensureLap(n);
  }

  // ---------- export and import ----------
  private pack = (l: RecLap) => ({ n: l.n, ms: l.ms, valid: l.valid, label: l.label || "", data: Object.fromEntries(LCH.map((k) => [k, Array.from(l.data![k], (v) => +v.toFixed(3))])) });

  exportLaps(): void {
    download("pitwall-laps.json", { format: "pitwall-laps", version: 1, laps: this.laps.filter((l) => l.data).map(this.pack) });
  }

  exportSession(): void {
    const c = feed.get(), f = c.r ? c.r.fixed : {};
    download("pitwall-session.json", {
      format: "pitwall-session", version: 1, car: f.car_model, track: f.track, driver: c.from || "", laps: c.laps, stints: c.s ? c.s.stints : [], stops: c.s ? c.s.stops : [],
      traces: this.laps.filter((l) => l.data).map(this.pack),
      log: c.log.map((e) => ({ time: new Date(e.t * 1000).toISOString(), lap: e.lap, severity: e.sev, cat: e.cat, text: e.text })), pit_log: c.pitLog, notes: lsRaw("pitwall.notes") ?? "",
    });
  }

  /** Accepts this page's and the old page's laps files; returns a status line. */
  async importLaps(file: File): Promise<string> {
    if (file.size > 20e6) return "File too large.";
    let j: Json;
    try { j = JSON.parse(await file.text()); } catch { return "Not a valid JSON file."; }
    if (!j || !["pitwall-laps", "engineer-laps"].includes(j.format) || !Array.isArray(j.laps)) return "Not a Pit Wall laps file.";
    let added = 0;
    const label = cleanText(String(file.name).replace(/\.json$/i, ""), 32) || "import";
    for (const l of (j.laps as Json[]).slice(0, 200)) {
      if (!isObj(l) || !isObj(l.data) || !LCH.every((k) => Array.isArray(l.data[k]) && l.data[k].length === NB)) continue;
      const n = Math.max(0, +l.n | 0), ms = +l.ms;
      if (!okMs(ms)) continue;
      const lb = cleanText(typeof l.label === "string" && l.label ? l.label : label, 32);
      if (this.laps.some((x) => x.src === "import" && x.n === n && x.ms === ms && x.label === lb)) continue;
      this.laps.push({ id: "imp-" + ++this.imp, n, ms, valid: l.valid !== false, src: "import", label: lb, data: Object.fromEntries(LCH.map((k) => [k, Float32Array.from(l.data[k] as number[], (v) => (isFinite(+v) ? +v : 0))])) as LapData });
      added++;
    }
    this.bump();
    return added ? `Imported ${added} lap${added > 1 ? "s" : ""}.` : "No new laps in that file.";
  }
}

export const recorder = new Recorder();
