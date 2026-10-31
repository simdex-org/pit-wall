// Canvas drawing for the chart modules, one call per canvas: live channels, lap-comparison traces and G-G.
import { clamp, fmtDelta, MINUS } from "../lib/format";
import { fv, unit, UnitChoice } from "../lib/units";
import { LapData, NB, Ring, recorder, RecLap, TRACE_N, TraceKey } from "../state/recorder";
import { CORNERS } from "../state/plan";
import { chCursor, chGrid, chLabel, chTag, chY, fitCanvas, Tokens, tokens } from "./canvas";

interface Series {
  k: TraceKey; name: string | (() => string); c: keyof Tokens; min?: number; max?: () => number; sym?: boolean; fmt: (v: number) => string;
}
export interface RowDef { label: string; series: Series[] }

/** The live rows; the unit choices are read when drawn. */
export function rowDefs(u: UnitChoice): Record<string, RowDef> {
  return {
    speed: { label: "Speed", series: [{ k: "speed", name: () => unit("speed", u).u, c: "chSpeed", min: 0, max: () => 320, fmt: (v) => fv("speed", v, u) }] },
    pedals: { label: "Throttle & brake", series: [
      { k: "thr", name: "thr", c: "chThr", min: 0, max: () => 1, fmt: (v) => (100 * v).toFixed(0) + "%" },
      { k: "brk", name: "brk", c: "chBrk", min: 0, max: () => 1, fmt: (v) => (100 * v).toFixed(0) + "%" },
    ] },
    steer: { label: "Steering", series: [{ k: "steer", name: "angle", c: "chSteer", sym: true, fmt: (v) => v.toFixed(2) }] },
    gearrpm: { label: "Gear & RPM", series: [
      { k: "rpm", name: "rpm", c: "chRpm", min: 0, max: () => recorder.maxRpm || 8000, fmt: (v) => v.toFixed(0) },
      { k: "gear", name: "gear", c: "chGear", min: 0, max: () => 8, fmt: (v) => (v < 0 ? "R" : v === 0 ? "N" : v.toFixed(0)) },
    ] },
    gforce: { label: "G-force", series: [
      { k: "gLat", name: "lat", c: "chSteer", sym: true, fmt: (v) => v.toFixed(2) },
      { k: "gLon", name: "long", c: "chRpm", sym: true, fmt: (v) => v.toFixed(2) },
    ] },
    tyretemp: { label: "Tyre core", series: CORNERS.map((n) => ({ k: ("t" + n) as TraceKey, name: n, c: ("ch" + n) as keyof Tokens, min: 20, max: () => 140, fmt: (v: number) => fv("temp", v, u) })) },
    tyrepsi: { label: "Tyre pressure", series: CORNERS.map((n) => ({ k: ("p" + n) as TraceKey, name: n, c: ("ch" + n) as keyof Tokens, min: 20, max: () => 36, fmt: (v: number) => fv("press", v, u) })) },
    fuel: { label: "Fuel", series: [{ k: "fuel", name: "L", c: "chSpeed", min: 0, max: () => recorder.fuelMax || 100, fmt: (v) => v.toFixed(1) }] },
  };
}

export const ROW_CHOICES: [string, string][] = [["speed", "Speed"], ["pedals", "Throttle & brake"], ["steer", "Steering"], ["gearrpm", "Gear & RPM"], ["gforce", "G-force"], ["tyretemp", "Tyre core"], ["tyrepsi", "Tyre pressure"], ["fuel", "Fuel"]];

export interface LiveRange { lo: number; hi: number; s: Series }

/**
 * Rows of the ring on a time axis, newest at the right. `hover` is the number of samples back from the newest, or null.
 * Returns the first series' min and max over the window, for the module header.
 */
export function drawLive(cv: HTMLCanvasElement, defs: Record<string, RowDef>, rows: string[], T: Ring, hover: number | null, win: number): LiveRange | null {
  const [g, w, h] = fitCanvas(cv), tk = tokens(), n = Math.min(T.n, win), lh = h / Math.max(1, rows.length);
  const at = (arr: Float32Array, k: number) => arr[(T.i - n + k + TRACE_N) % TRACE_N]!;
  const xOf = (k: number) => w - ((n - 1 - k) * w) / Math.max(1, win - 1);
  const hk = hover == null ? n - 1 : Math.max(0, n - 1 - hover);
  let range: LiveRange | null = null;
  rows.forEach((id, r) => {
    const def = defs[id];
    if (!def) return;
    const top = r * lh, tb = 16; // a title band per lane: the plot starts under it, so the title never covers a trace
    g.save(); g.translate(0, top + tb); chGrid(g, w, lh - tb, tk); g.restore();
    if (r) { g.strokeStyle = tk.line; g.beginPath(); g.moveTo(0, Math.round(top) + 0.5); g.lineTo(w, Math.round(top) + 0.5); g.stroke(); }
    let sym = 0.05;
    for (const s of def.series) if (s.sym) for (let k = 0; k < n; k++) sym = Math.max(sym, Math.abs(at(T.data[s.k], k)));
    const parts: [string, string][] = [[def.label.toUpperCase(), tk.dim]];
    for (const s of def.series) {
      const arr = T.data[s.k], lo = s.sym ? -sym : s.min ?? 0, hi = s.sym ? sym : s.max!();
      if (n > 1) {
        g.beginPath();
        for (let k = 0; k < n; k++) { const y = chY(at(arr, k), lo, hi, top + tb, lh - tb); if (k) g.lineTo(xOf(k), y); else g.moveTo(xOf(k), y); }
        g.strokeStyle = tk[s.c]; g.lineWidth = 1.5; g.lineJoin = "round"; g.stroke();
      }
      if (!range && n) {
        let a = Infinity, b = -Infinity;
        for (let k = 0; k < n; k++) { const v = at(arr, k); a = Math.min(a, v); b = Math.max(b, v); }
        range = { lo: a, hi: b, s };
      }
      parts.push([`${typeof s.name === "function" ? s.name() : s.name} ${n ? s.fmt(at(arr, hk)) : "–"}`, tk[s.c]]);
    }
    chLabel(g, 6, top + 3, parts, tk);
  });
  if (hover != null && n) chCursor(g, xOf(hk), h, tk);
  return range;
}

// ---------- lap comparison traces (distance axis), MoTeC lane order ----------
interface Lane {
  label: string; ser?: [LapChannelKey, keyof Tokens | null][]; fmt?: (v: number) => string; u?: () => string; sym?: boolean; min?: number; max?: (a: Float32Array, b?: Float32Array) => number;
}
type LapChannelKey = keyof LapData;

export function lanes(u: UnitChoice): Record<string, Lane> {
  return {
    delta: { label: "Δ time · below = CMP faster" },
    speed: { label: "Speed", ser: [["speed", null]], fmt: (v) => fv("speed", v, u), u: () => unit("speed", u).u, min: 0, max: (a, b) => Math.max(100, ...a, ...(b ?? [])) },
    pedals: { label: "Throttle & brake", ser: [["thr", "chThr"], ["brk", "chBrk"]], fmt: (v) => (100 * v).toFixed(0), u: () => "%", min: 0, max: () => 1 },
    steer: { label: "Steering", ser: [["steer", null]], fmt: (v) => v.toFixed(2), sym: true },
    gear: { label: "Gear", ser: [["gear", null]], fmt: (v) => v.toFixed(0), min: 0, max: () => 7 },
    rpm: { label: "RPM", ser: [["rpm", null]], fmt: (v) => v.toFixed(0), u: () => "rpm", min: 0, max: (a, b) => Math.max(1000, ...a, ...(b ?? [])) },
  };
}
export const LANE_CHOICES: [string, string][] = [["delta", "Δ time"], ["speed", "Speed"], ["pedals", "Throttle & brake"], ["steer", "Steering"], ["gear", "Gear"], ["rpm", "RPM"]];

export interface TraceRange { label: string; lo: string; hi: string; u: string }

/**
 * Each lane: a 14 px title band, then the plot with its axis range at the right edge; 6 px and a rule between lanes.
 * `len` is the track length in metres (0: percent). Returns the first value lane's range over both laps, for the module header.
 */
export function drawTraces(cv: HTMLCanvasElement, defs: Record<string, Lane>, laneIds: string[], ref: RecLap, cmp: RecLap | null, cursor: number | null, len: number): TraceRange | null {
  const [g, w, h] = fitCanvas(cv), tk = tokens(), axis = 16, TB = 14, GAP = 6, n = Math.max(1, laneIds.length), lh = (h - axis - GAP * (n - 1)) / n;
  const xOf = (i: number) => (i / (NB - 1)) * w;
  const ci = cursor == null ? null : Math.round(cursor * (NB - 1));
  const tags: [number, number, string, string][] = [];
  let range: TraceRange | null = null;
  const rd = ref.data!, cd = cmp?.data ?? null;
  // An axis figure at the lane's right edge, on a --bg strip so a trace under it stays readable.
  const edge = (y: number, t: string, base: CanvasTextBaseline) => {
    g.font = `500 10px ${tk.num}`; g.textAlign = "right"; g.textBaseline = base;
    const tw = g.measureText(t).width + 6, y0 = base === "top" ? y - 1 : y - 12;
    g.fillStyle = tk.bg; g.globalAlpha = 0.85; g.fillRect(w - tw - 2, y0, tw + 2, 13); g.globalAlpha = 1; g.fillStyle = tk.dim; g.fillText(t, w - 4, y);
  };
  laneIds.forEach((id, r) => {
    const L = defs[id];
    if (!L) return;
    const top = r * (lh + GAP), pt = top + TB, ph = lh - TB;
    if (r) { g.strokeStyle = tk.line; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Math.round(top - GAP / 2) + 0.5); g.lineTo(w, Math.round(top - GAP / 2) + 0.5); g.stroke(); }
    g.save(); g.translate(0, pt); chGrid(g, w, ph, tk); g.restore();
    const parts: [string, string][] = [[L.label.toUpperCase(), tk.dim]];
    if (id === "delta") {
      if (cd) {
        const d = new Float32Array(NB);
        let m = 50;
        for (let i = 0; i < NB; i++) { d[i] = cd.t[i]! - rd.t[i]!; m = Math.max(m, Math.abs(d[i]!)); }
        const y0 = pt + ph / 2, yv = (v: number) => y0 - (v / m) * (ph / 2 - 3);
        for (const [sign, col] of [[1, tk.bad], [-1, tk.ok]] as const) { // above zero: CMP losing; below: gaining
          g.beginPath(); g.moveTo(0, y0);
          for (let i = 0; i < NB; i++) g.lineTo(xOf(i), yv(sign > 0 ? Math.max(0, d[i]!) : Math.min(0, d[i]!)));
          g.lineTo(w, y0); g.closePath();
          g.fillStyle = col; g.globalAlpha = 0.3; g.fill(); g.globalAlpha = 1;
        }
        g.strokeStyle = tk.line; g.beginPath(); g.moveTo(0, Math.round(y0) + 0.5); g.lineTo(w, Math.round(y0) + 0.5); g.stroke();
        g.beginPath();
        for (let i = 0; i < NB; i++) { if (i) g.lineTo(xOf(i), yv(d[i]!)); else g.moveTo(0, yv(d[i]!)); }
        g.strokeStyle = tk.text; g.lineWidth = 1.5; g.stroke();
        edge(pt + 1, `+${(m / 1000).toFixed(2)} s`, "top"); edge(pt + ph - 1, `${MINUS}${(m / 1000).toFixed(2)} s`, "bottom");
        if (ci != null) tags.push([xOf(ci), yv(d[ci]!), fmtDelta(d[ci]!), tk.text]);
      } else parts.push(["needs a CMP lap", tk.dim]);
    } else {
      const first = L.ser![0]![0];
      let lo = L.min ?? 0, hi = L.max ? L.max(rd[first], cd?.[first]) : 1;
      if (L.sym) {
        let m = 0.05;
        for (const l of [rd, cd]) if (l) for (const v of l.steer) m = Math.max(m, Math.abs(v));
        lo = -m; hi = m;
      }
      for (const [lap, dash, base] of [[rd, false, tk.chRef], [cd, true, tk.chCmp]] as const) {
        if (!lap) continue;
        for (const [k, cc] of L.ser!) {
          const a = lap[k], col = cc ? tk[cc] : base;
          g.beginPath();
          for (let i = 0; i < NB; i++) { const y = chY(a[i]!, lo, hi, pt, ph); if (i) g.lineTo(xOf(i), y); else g.moveTo(0, y); }
          g.strokeStyle = col; g.lineWidth = dash ? 1.25 : 1.5; g.setLineDash(dash ? [4, 3] : []); g.lineJoin = "round"; g.stroke(); g.setLineDash([]);
          if (ci != null) tags.push([xOf(ci), chY(a[ci]!, lo, hi, pt, ph), (dash ? "C " : "R ") + L.fmt!(a[ci]!), col]);
        }
      }
      const unitText = L.u ? " " + L.u() : "";
      edge(pt + 1, L.fmt!(hi) + unitText, "top"); edge(pt + ph - 1, L.fmt!(lo) + unitText, "bottom");
      if (!range) {
        let a = Infinity, b = -Infinity;
        for (const l of [rd, cd]) if (l) for (const v of l[first]) { if (v < a) a = v; if (v > b) b = v; }
        if (a <= b) range = { label: L.label, lo: L.fmt!(a), hi: L.fmt!(b), u: L.u ? L.u() : "" };
      }
    }
    chLabel(g, 6, top + 1, parts, tk);
  });
  // distance axis
  g.font = `500 10px ${tk.num}`; g.fillStyle = tk.dim; g.textBaseline = "bottom";
  const total = len > 0 ? len : 100, step = [100, 200, 250, 500, 1000, 2000].find((s) => (total / s) * 56 < w) ?? 5000;
  for (let x = 0; x <= total; x += len > 0 ? step : 10) {
    const px = (x / total) * w;
    g.textAlign = px < 20 ? "left" : px > w - 30 ? "right" : "center";
    g.fillText(len > 0 ? x + " m" : x + " %", px, h - 2);
  }
  if (ci != null) { chCursor(g, xOf(ci), h - axis, tk); for (const [x, y, t, c] of tags) chTag(g, x, y, t, c, tk, w); }
  return range;
}

// ---------- G-G (friction circle) from the live ring ----------
export function drawGG(cv: HTMLCanvasElement, T: Ring, trail: number): void {
  const [g, w, h] = fitCanvas(cv), tk = tokens(), n = T.n;
  const at = (a: Float32Array, k: number) => a[(T.i - n + k + TRACE_N) % TRACE_N]!;
  const R = Math.min(w, h) / 2 - 16, cx = w / 2, cy = h / 2;
  const m = clamp(Math.max(recorder.gHist.maxLat, recorder.gHist.maxLon) * 1.15, 1.5, 3);
  const px = (v: number) => cx + (v / m) * R, py = (v: number) => cy - (v / m) * R;
  g.strokeStyle = tk.line; g.lineWidth = 1; g.font = `500 10px ${tk.num}`; g.fillStyle = tk.dim; g.textAlign = "left"; g.textBaseline = "bottom";
  for (const r of [1, 2, 3].filter((x) => x < m)) {
    const rr = (r / m) * R;
    g.beginPath(); g.arc(cx, cy, rr, 0, 7); g.stroke();
    g.fillText(r + " g", cx + rr * 0.707 + 3, cy - rr * 0.707 - 3);
  }
  g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
  if (!n) return;
  const from = Math.max(0, n - (trail || 150)); // the last few seconds as a trail
  g.fillStyle = tk.chLap; g.globalAlpha = 0.35;
  for (let k = from; k < n; k++) { g.beginPath(); g.arc(px(at(T.data.gLat, k)), py(at(T.data.gLon, k)), 2, 0, 7); g.fill(); }
  g.globalAlpha = 1;
  g.beginPath(); g.arc(px(at(T.data.gLat, n - 1)), py(at(T.data.gLon, n - 1)), 5, 0, 7); g.fillStyle = tk.accent; g.fill(); g.strokeStyle = tk.bg; g.lineWidth = 1.5; g.stroke();
}
