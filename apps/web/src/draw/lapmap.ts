// The lap map: the REF racing line coloured by what the driver did, or by where CMP gains and loses, with the brake points,
// the slowest points, the lap cut into parts, and the cursor shared with the traces.
import { fmtDelta, MINUS } from "../lib/format";
import type { Report } from "../lib/coach/report";
import { LapData, NB, RecLap } from "../state/recorder";
import { Ctx2D, fitCanvas, Tokens, tokens } from "./canvas";
import type { MapView } from "./map";

type Line = ArrayLike<number[]>;
export type LapMapMode = "delta" | "speedd" | "speed" | "pedals" | "steer" | "gear" | "rpm";
export type LapMapShow = "all" | "loss" | "gain";
export const MODES: [LapMapMode, string, boolean][] = [["delta", "Time Δ", true], ["speedd", "Speed Δ", true], ["speed", "Speed", false], ["pedals", "Pedals", false], ["steer", "Steering", false], ["gear", "Gear", false], ["rpm", "RPM", false]];

export interface LapMapIn {
  ref: RecLap; cmp: RecLap | null;
  /** The line the colours are drawn on: REF's own, or the layout when REF has none (an import). */
  base: Line;
  /** CMP's own racing line, when it has one. */
  cmpLine: Line | null;
  mode: LapMapMode; show: LapMapShow; width: number;
  brakes: boolean; slowest: boolean; corners: boolean; cmpDraw: boolean;
  /** The coach's corners, and the one the view is centred on. */
  report: Report | null; focus: number | null;
  cursor: number | null; len: number;
  speed: (v: number) => number; unit: string;
}

const FR = new WeakMap<object, { n: number; f: Float64Array }>();
/** The lap fraction of each point: the game's own where the line carries it, else by distance. */
function fracs(pts: Line): Float64Array {
  const had = FR.get(pts);
  if (had && had.n === pts.length) return had.f;
  const n = pts.length, f = new Float64Array(n);
  if (n && pts[0]!.length > 2) for (let i = 0; i < n; i++) f[i] = pts[i]![2] ?? f[i - 1] ?? 0;
  else {
    for (let i = 1; i < n; i++) f[i] = f[i - 1]! + Math.hypot(pts[i]![0]! - pts[i - 1]![0]!, pts[i]![1]! - pts[i - 1]![1]!);
    const tot = f[n - 1] || 1;
    for (let i = 0; i < n; i++) f[i] = f[i]! / tot;
  }
  FR.set(pts, { n, f });
  return f;
}

function idxAt(f: Float64Array, v: number): number {
  let lo = 0, hi = f.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f[m]! < v) lo = m; else hi = m; }
  return hi;
}

/** Brake points (a press after 10 bins off the pedal) and the slowest point of each corner (25 km/h under the speed before it). */
function events(d: LapData): { brakes: number[]; apexes: number[] } {
  const brakes: number[] = [], apexes: number[] = [];
  let off = 99;
  for (let i = 0; i < NB; i++) {
    if (d.brk[i]! > 0.1) { if (off >= 10) brakes.push(i); off = 0; } else off++;
    const lo = Math.max(0, i - 10), hi = Math.min(NB - 1, i + 10);
    let mn = Infinity, pre = 0;
    for (let k = lo; k <= hi; k++) mn = Math.min(mn, d.speed[k]!);
    for (let k = Math.max(0, i - 40); k < i; k++) pre = Math.max(pre, d.speed[k]!);
    if (d.speed[i] === mn && pre - mn >= 25 && i - (apexes[apexes.length - 1] ?? -99) > 10) apexes.push(i);
  }
  return { brakes, apexes };
}

const ramp = (v: number) => `hsl(${Math.round(220 * (1 - Math.min(1, Math.max(0, v))))} 70% 55%)`;

/** Slope of a difference between the two laps, smoothed over 9 bins; positive is CMP behind. */
function slope(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(NB);
  for (let i = 0; i < NB; i++) { const lo = Math.max(0, i - 4), hi = Math.min(NB - 1, i + 4); o[i] = (a[hi]! - b[hi]! - (a[lo]! - b[lo]!)) / (hi - lo); }
  return o;
}
const smooth = (a: Float32Array): Float32Array => {
  const o = new Float32Array(NB);
  for (let i = 0; i < NB; i++) { let s = 0, k = 0; for (let j = Math.max(0, i - 4); j <= Math.min(NB - 1, i + 4); j++) { s += a[j]!; k++; } o[i] = s / k; }
  return o;
};

/** Draws the map and returns a lookup from a canvas point to the lap fraction of the nearest point of the line. */
export function drawLapMap(cv: HTMLCanvasElement, view: MapView, a: LapMapIn): (x: number, y: number) => number | null {
  const [g, w, h] = fitCanvas(cv), tk = tokens(), P = a.base, bf = fracs(P), rd = a.ref.data!, cd = a.cmp?.data ?? null, n = P.length;
  const binM = a.len > 0 ? a.len / (NB - 1) : 0;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const l of [P, a.cmpLine]) if (l) for (let i = 0; i < l.length; i++) { const [x, z] = l[i]!; if (x! < x0) x0 = x!; if (x! > x1) x1 = x!; if (z! < z0) z0 = z!; if (z! > z1) z1 = z!; }
  const pad = 28, base = Math.min((w - 2 * pad) / Math.max(100, x1 - x0), (h - 2 * pad) / Math.max(100, z1 - z0));
  const where = (l: Line, v: number): [number, number] => { const p = l[idxAt(fracs(l), v)]!; return [p[0]!, p[1]!]; };
  const foc = a.focus != null ? a.report?.corners.find((k) => k.corner.n === a.focus) : null, fk = foc ? String(foc.corner.n) : undefined;
  if (view.fk !== fk) { // a new corner: centre on it and zoom in; none: back to the whole lap
    view.fk = fk; view.follow = false;
    if (foc) { const [fx, fz] = where(P, foc.corner.apex / (NB - 1)); view.zoom = 4; view.dx = fx - (x0 + x1) / 2; view.dy = fz - (z0 + z1) / 2; } else { view.zoom = 1; view.dx = view.dy = 0; }
  }
  const sc = base * view.zoom;
  const cp = a.cursor != null ? where(P, a.cursor) : null;
  const cx = view.follow && cp ? cp[0] : (x0 + x1) / 2 + view.dx, cz = view.follow && cp ? cp[1] : (z0 + z1) / 2 + view.dy;
  view.sc = sc; view.mid = [(x0 + x1) / 2, (z0 + z1) / 2]; view.c = [cx, cz];
  const X = (x: number) => w / 2 + (x - cx) * sc, Y = (z: number) => h / 2 + (z - cz) * sc;
  const xy = (l: Line, v: number): [number, number] => { const [x, z] = where(l, v); return [X(x), Y(z)]; };
  const bin = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * (NB - 1));

  g.lineJoin = g.lineCap = "round";
  const stroke = (l: Line, width: number, col: string, from = 0, to = 1) => {
    g.beginPath();
    for (let i = 0, pen = false; i < l.length; i++) {
      const f = fracs(l)[i]!;
      if (f < from || f > to) { pen = false; continue; }
      const [x, z] = l[i]!;
      if (pen && Math.hypot(x! - l[i - 1]![0]!, z! - l[i - 1]![1]!) < 60) g.lineTo(X(x!), Y(z!)); else g.moveTo(X(x!), Y(z!));
      pen = true;
    }
    g.strokeStyle = col; g.lineWidth = width; g.stroke();
  };
  stroke(P, a.width + 8, tk.line);

  // Each stretch of the REF line takes its colour from the bin it lies in; "loss" says which side of a difference it is on.
  let smin = Infinity, smax = -Infinity, rmax = 1, dmax = 1e-6;
  for (const v of rd.speed) { if (v < smin) smin = v; if (v > smax) smax = v; }
  for (const v of rd.rpm) rmax = Math.max(rmax, v);
  let dv: Float32Array | null = null;
  if (cd && a.mode === "delta") dv = slope(cd.t, rd.t);
  if (cd && a.mode === "speedd") dv = smooth(Float32Array.from(cd.speed, (v, i) => rd.speed[i]! - v));
  if (dv) for (const v of dv) dmax = Math.max(dmax, Math.abs(v));
  let smax2 = 0.05;
  for (const v of rd.steer) smax2 = Math.max(smax2, Math.abs(v));
  const paint = (b: number): [string, number, boolean | null] => {
    if (dv) { const s = dv[b]!; return [s > 0 ? tk.bad : tk.ok, 0.2 + 0.8 * Math.min(1, Math.abs(s) / (0.5 * dmax)), s > 0]; }
    if (a.mode === "speed") return [ramp((rd.speed[b]! - smin) / (smax - smin || 1)), 1, null];
    if (a.mode === "rpm") return [ramp(rd.rpm[b]! / rmax), 1, null];
    if (a.mode === "gear") return [`hsl(${(rd.gear[b]! * 47) % 360} 60% 55%)`, 1, null];
    if (a.mode === "steer") return [rd.steer[b]! < 0 ? tk.cold : tk.warn, 0.15 + 0.85 * Math.min(1, Math.abs(rd.steer[b]!) / smax2), null];
    return rd.brk[b]! > 0.05 ? [tk.chBrk, 0.4 + 0.6 * rd.brk[b]!, null] : rd.thr[b]! > 0.05 ? [tk.chThr, 0.4 + 0.6 * rd.thr[b]!, null] : [tk.dim, 1, null];
  };
  const step = Math.max(1, Math.floor(n / 1500));
  g.lineWidth = a.width; g.lineCap = "butt";
  for (let i = 0; i < n - 1; i += step) {
    const j = Math.min(i + step, n - 1), p = P[i]!, q = P[j]!;
    if (j === i || Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!) > 60) continue;
    let [col, al, loss] = paint(bin(bf[i]!));
    if (loss != null && a.show !== "all" && loss !== (a.show === "loss")) { col = tk.dim; al = 0.25; }
    g.strokeStyle = col; g.globalAlpha = al; g.beginPath(); g.moveTo(X(p[0]!), Y(p[1]!)); g.lineTo(X(q[0]!), Y(q[1]!)); g.stroke();
  }
  g.globalAlpha = 1; g.lineCap = "round";
  const cl = a.cmpLine ?? P;
  if (a.cmpDraw && a.cmpLine) stroke(a.cmpLine, 1.5, tk.chCmp);

  // The corners of the lap: a tick across the road where each zone starts, and the time CMP gained or lost in it.
  const text = (t: string, x: number, y: number, col: string) => { g.strokeText(t, x, y); g.fillStyle = col; g.fillText(t, x, y); };
  g.font = `600 10px ${tk.num}`; g.textBaseline = "middle"; g.textAlign = "left"; g.lineWidth = 3; g.strokeStyle = tk.bg;
  if (a.corners && a.report) {
    const last = NB - 1;
    for (const k of a.report.corners) {
      const c = k.corner, f0 = c.start / last, f1 = c.end / last;
      if (c.n === a.focus) { g.globalAlpha = 0.35; if (f1 > 1) { stroke(P, a.width + 4, tk.text, f0, 1); stroke(P, a.width + 4, tk.text, 0, f1 - 1); } else stroke(P, a.width + 4, tk.text, f0, f1); g.globalAlpha = 1; }
      const side = (f: number, r: number): [number, number, number, number] => { // the point at f and the left-hand normal r pixels long
        const [ax, ay] = xy(P, Math.max(0, f - 0.002)), [bx, by] = xy(P, Math.min(1, f + 0.002)), m = Math.hypot(bx - ax, by - ay) || 1, [px, py] = xy(P, f % 1);
        return [px, py, (-(by - ay) / m) * r, ((bx - ax) / m) * r];
      };
      const [px, py, nx, ny] = side(f0, a.width / 2 + 7);
      g.strokeStyle = tk.dim; g.lineWidth = 1; g.beginPath(); g.moveTo(px - nx, py - ny); g.lineTo(px + nx, py + ny); g.stroke();
      const [mx, my, ox, oy] = side(c.apex / last, a.width / 2 + 12);
      g.lineWidth = 3; g.strokeStyle = tk.bg;
      text(k.name.split(" ")[0]! + (k.kind === "even" ? "" : " " + fmtDelta(k.delta)), mx + ox - 6, my + oy, k.kind === "loss" ? tk.bad : k.kind === "gain" ? tk.ok : tk.dim);
    }
  }

  const mark = (l: Line, i: number) => xy(l, i / (NB - 1));
  if (a.brakes || a.slowest) {
    const re = events(rd), ce = cd ? events(cd) : null;
    if (a.brakes) {
      for (const i of re.brakes) { const [x, y] = mark(P, i); g.fillStyle = tk.chBrk; g.strokeStyle = tk.bg; g.lineWidth = 1.5; g.fillRect(x - 3.5, y - 3.5, 7, 7); g.strokeRect(x - 3.5, y - 3.5, 7, 7); }
      if (ce) for (const i of ce.brakes) { const [x, y] = mark(cl, i); g.strokeStyle = tk.chCmp; g.lineWidth = 1.5; g.strokeRect(x - 3.5, y - 3.5, 7, 7); }
      if (ce && binM && view.zoom >= 2) { // where CMP brakes against REF: minus is earlier
        g.lineWidth = 3; g.strokeStyle = tk.bg;
        for (const i of re.brakes) {
          const j = ce.brakes.find((k) => Math.abs(k - i) <= 15);
          if (j == null || j === i) continue;
          const [x, y] = mark(P, i);
          text(`${j < i ? MINUS : "+"}${Math.round(Math.abs(j - i) * binM)} m`, x + 7, y + 8, tk.chBrk);
        }
      }
    }
    if (a.slowest) {
      g.lineWidth = 3; g.strokeStyle = tk.bg;
      for (const i of re.apexes) {
        const [x, y] = mark(P, i), j = ce?.apexes.find((k) => Math.abs(k - i) <= 12);
        g.beginPath(); g.arc(x, y, 3, 0, 7); g.fillStyle = tk.text; g.fill();
        const dv2 = j != null ? Math.round(a.speed(cd!.speed[j]!) - a.speed(rd.speed[i]!)) : null;
        text(`${Math.round(a.speed(rd.speed[i]!))}${dv2 ? ` ${dv2 > 0 ? "+" : MINUS}${Math.abs(dv2)}` : ""}`, x + 7, y - 7, tk.text);
      }
    }
  }
  const [sx, sy] = xy(P, 0);
  { // start/finish: a two-row chequered strip across the line, turned to the direction of travel
    const [nx, ny] = xy(P, 4), ang = Math.atan2(ny - sy, nx - sx), sq = 2.5, n = 7;
    g.save(); g.translate(sx, sy); g.rotate(ang);
    for (let r = 0; r < 2; r++) for (let k = 0; k < n; k++) { g.fillStyle = (r + k) % 2 ? "#000" : "#fff"; g.fillRect(-sq + r * sq, (k - n / 2) * sq, sq, sq); }
    g.restore();
  }

  if (a.cursor != null) {
    for (const [l, d, col] of [[P, rd, tk.chRef], [cl, cd, tk.chCmp]] as const) {
      if (!d) continue;
      const [x, y] = xy(l, a.cursor);
      g.beginPath(); g.arc(x, y, 6, 0, 7); g.fillStyle = col; g.fill(); g.strokeStyle = tk.bg; g.lineWidth = 2; g.stroke();
    }
    readout(g, tk, a, bin(a.cursor));
  }
  legend(g, tk, a, h, smin, smax, rmax, dmax, binM);

  return (x, y) => {
    let best: number | null = null, d = 30 * 30;
    for (let i = 0; i < n; i += step) { const e = (X(P[i]![0]!) - x) ** 2 + (Y(P[i]![1]!) - y) ** 2; if (e < d) { d = e; best = bf[i]!; } }
    return best;
  };
}

/** The figures at the cursor for both laps, in a box at the top left. */
function readout(g: Ctx2D, tk: Tokens, a: LapMapIn, b: number): void {
  const rd = a.ref.data!, cd = a.cmp?.data ?? null, sp = (d: LapData) => `${Math.round(a.speed(d.speed[b]!))}`;
  const row = (tag: string, d: LapData) => [tag, sp(d), `${Math.round(d.thr[b]! * 100)}`, `${Math.round(d.brk[b]! * 100)}`, `${Math.round(d.gear[b]!)}`];
  const rows: string[][] = [["", a.unit, "thr", "brk", "gear"], row("R", rd)];
  if (cd) rows.push(row("C", cd));
  const head = a.len > 0 ? `${Math.round((b / (NB - 1)) * a.len)} m` : `${((b / (NB - 1)) * 100).toFixed(1)} %`;
  const foot = cd ? `${fmtDelta(cd.t[b]! - rd.t[b]!)}  ${a.unit === "" ? "" : `${Math.round(a.speed(cd.speed[b]!) - a.speed(rd.speed[b]!)) >= 0 ? "+" : MINUS}${Math.abs(Math.round(a.speed(cd.speed[b]!) - a.speed(rd.speed[b]!)))} ${a.unit}`}` : "";
  const cw = 38, W = 8 + 12 + cw * 4 + 8, H = 10 + 14 * (rows.length + 1 + (foot ? 1 : 0)) + 4;
  g.fillStyle = tk.bg; g.globalAlpha = 0.9; g.fillRect(8, 8, W, H); g.globalAlpha = 1; g.strokeStyle = tk.line; g.lineWidth = 1; g.strokeRect(8.5, 8.5, W - 1, H - 1);
  g.font = `500 10px ${tk.num}`; g.textBaseline = "top"; g.textAlign = "left"; g.fillStyle = tk.text; g.fillText(head, 14, 13);
  rows.forEach((r, i) => r.forEach((t, k) => {
    g.textAlign = k ? "right" : "left"; g.fillStyle = i === 0 ? tk.dim : r[0] === "C" ? tk.chCmp : tk.chRef;
    g.fillText(t, k ? 14 + 12 + cw * k : 14, 13 + 14 * (i + 1));
  }));
  if (foot) { g.textAlign = "left"; g.fillStyle = tk.text; g.fillText(foot, 14, 13 + 14 * (rows.length + 1)); }
}

/** What the colours mean, along the bottom edge. */
function legend(g: Ctx2D, tk: Tokens, a: LapMapIn, h: number, smin: number, smax: number, rmax: number, dmax: number, binM: number): void {
  g.font = `500 10px ${tk.num}`; g.textBaseline = "middle"; g.textAlign = "left";
  const y = h - 14, bar = (x: number, stops: [number, string][], lo: string, hi: string) => {
    const gr = g.createLinearGradient(x, 0, x + 110, 0);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr; g.fillRect(x, y - 3, 110, 6);
    g.fillStyle = tk.dim; g.textAlign = "right"; g.fillText(lo, x - 4, y); g.textAlign = "left"; g.fillText(hi, x + 114, y);
  };
  const m = (v: number) => `${Math.round(a.speed(v))} ${a.unit}`;
  if (a.mode === "speed") bar(48, [[0, ramp(0)], [0.5, ramp(0.5)], [1, ramp(1)]], m(smin), m(smax));
  else if (a.mode === "rpm") bar(48, [[0, ramp(0)], [1, ramp(1)]], "0", `${Math.round(rmax)}`);
  else if (a.mode === "steer") bar(48, [[0, tk.cold], [0.5, tk.bg], [1, tk.warn]], "left", "right");
  else if (a.mode === "delta" || a.mode === "speedd") {
    const full = a.mode === "delta" ? (binM ? `${Math.round(0.5 * dmax * (100 / binM))} ms per 100 m` : "") : `${Math.round(a.speed(0.5 * dmax))} ${a.unit}`;
    g.fillStyle = tk.bad; g.fillRect(10, y - 3, 8, 6); g.fillStyle = tk.dim; g.fillText("CMP behind", 22, y);
    g.fillStyle = tk.ok; g.fillRect(100, y - 3, 8, 6); g.fillStyle = tk.dim; g.fillText("CMP ahead", 112, y);
    if (full) g.fillText(`full colour at ${full}`, 190, y);
  } else if (a.mode === "pedals") {
    for (const [t, c, x] of [["brake", tk.chBrk, 10], ["throttle", tk.chThr, 70], ["coast", tk.dim, 140]] as const) { g.fillStyle = c; g.fillRect(x, y - 3, 8, 6); g.fillStyle = tk.dim; g.fillText(t, x + 12, y); }
  } else { g.fillStyle = tk.dim; g.fillText("each gear its own colour", 10, y); }
}
