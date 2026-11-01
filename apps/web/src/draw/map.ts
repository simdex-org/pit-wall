// The track map: the track, your car and the field; zoom, pan, follow.
import type { Ctx } from "../feed/store";
import type { Car } from "../feed/types";
import { carName } from "../lib/cars";
import { IN_LANE } from "../lib/enums";
import { clamp, fmtRel } from "../lib/format";
import { recorder } from "../state/recorder";
import { Ctx2D, fitCanvas, Tokens, tokens } from "./canvas";

type Pt = [number, number];
export interface TrackDrawing { box: number[]; loop: Pt[]; pit: Pt[]; labels: [number, number, string][] }
let TRACKS: Record<string, TrackDrawing> | null = null;

/** The track drawings are a large file, so they load the first time a map is shown. */
export async function loadTracks(): Promise<void> {
  if (TRACKS) return;
  TRACKS = ((await import("@pitwall/tracks")).default as unknown) as Record<string, TrackDrawing>;
}
export const tracksLoaded = (): boolean => TRACKS != null;

function trackFor(name: string | undefined): TrackDrawing | null {
  if (!name || !TRACKS) return null;
  const n = name.toLowerCase();
  return Object.hasOwn(TRACKS, n) ? TRACKS[n]! : /nurburgring_24h|nordschleife/.test(n) ? TRACKS.nurburgring_24h ?? null : null;
}

const cums = new WeakMap<object, Float64Array>();
/** Cumulative distance along a line, cached on the array. */
function cumOf(pts: ArrayLike<number[]>): Float64Array {
  let c = cums.get(pts);
  if (c) return c;
  c = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) c[i] = c[i - 1]! + Math.hypot(pts[i]![0]! - pts[i - 1]![0]!, pts[i]![1]! - pts[i - 1]![1]!);
  cums.set(pts, c);
  return c;
}

/** The point a fraction f of the way along the line, by distance. */
function atFrac(pts: Pt[], f: number): Pt {
  const c = cumOf(pts), d = (((f % 1) + 1) % 1) * c[c.length - 1]!;
  let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m]! < d) lo = m; else hi = m; }
  const a = pts[lo]!, b = pts[hi]!, t = c[hi]! > c[lo]! ? (d - c[lo]!) / (c[hi]! - c[lo]!) : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * The field comes every 250 ms or so: each dot travels in a straight line from where it is drawn to its newest position, taking as
 * long as the last update took to arrive, so it moves steadily and is one update behind. A jump of 100 m or more (a reset or a pit
 * teleport) snaps.
 */
interface Glide { a: Pt; b: Pt; t: number; dt: number }
const GLIDE = new Map<string | number, Glide>();
function glide(key: string | number, q: Pt, now: number): Pt {
  let m = GLIDE.get(key);
  if (!m || Math.hypot(q[0] - m.b[0], q[1] - m.b[1]) > 100 || now - m.t > 2000) { GLIDE.set(key, (m = { a: q, b: q, t: now, dt: 250 })); return q; }
  const f = (): Pt => { const u = Math.min(1, (now - m!.t) / m!.dt); return [m!.a[0] + (m!.b[0] - m!.a[0]) * u, m!.a[1] + (m!.b[1] - m!.a[1]) * u]; };
  if (q[0] !== m.b[0] || q[1] !== m.b[1]) { const at = f(); m.dt = Math.min(600, Math.max(30, now - m.t)); m.a = at; m.b = q; m.t = now; }
  return f();
}

/**
 * The drawn layouts have their own frame and ACC's x/z another. A line whose points carry the lap fraction (a third of a lap is
 * enough) fixes the similarity between them: rotation, scale, shift, mirrored or not, and a start line up to 5 % off.
 * A growing line refits every 50 points; a later bad fit never throws away a good one.
 */
interface Aligned { loop: Pt[]; pit: Pt[]; labels: [number, number, string][]; inv?: (p: Pt) => Pt }
const ALIGN = new Map<string, { key: string; B: Aligned | null }>();

function alignLayout(name: string, t: TrackDrawing, pts: ArrayLike<number[]>): Aligned | null {
  const had = ALIGN.get(name);
  if (!pts || pts.length < 30 || pts[0]!.length < 3) return had ? had.B : null;
  let q0 = 1, q1 = 0;
  for (let i = 0; i < pts.length; i++) { const q = pts[i]![2]!; if (q < q0) q0 = q; if (q > q1) q1 = q; }
  if (q1 - q0 < 0.3) return had ? had.B : null;
  const key = `${Math.floor(pts.length / 50)}:${pts[0]![0]}`;
  if (had && had.key === key) return had.B;
  const N = Math.min(200, pts.length), S: number[][] = [];
  for (let k = 0; k < N; k++) S.push(pts[Math.floor((k * pts.length) / N)]!);
  let fit: { e: number; sc: number; map: (p: Pt) => Pt; inv: (p: Pt) => Pt } | null = null;
  let bestD = 0;
  const tryD = (d: number) => {
    for (const f of [1, -1]) {
      const a = S.map((q) => { const [x, y] = atFrac(t.loop, q[2]! + d); return [x, f * y] as Pt; });
      let ax = 0, ay = 0, bx = 0, bz = 0;
      a.forEach(([x, y], i) => { ax += x; ay += y; bx += S[i]![0]!; bz += S[i]![1]!; });
      ax /= N; ay /= N; bx /= N; bz /= N;
      let sxx = 0, sxy = 0, saa = 0;
      a.forEach(([x, y], i) => { const u = x - ax, v = y - ay, P = S[i]![0]! - bx, Q = S[i]![1]! - bz; sxx += u * P + v * Q; sxy += u * Q - v * P; saa += u * u + v * v; });
      const th = Math.atan2(sxy, sxx), sc = Math.hypot(sxx, sxy) / saa, co = sc * Math.cos(th), si = sc * Math.sin(th);
      let e = 0;
      a.forEach(([x, y], i) => { const u = x - ax, v = y - ay; e += (bx + co * u - si * v - S[i]![0]!) ** 2 + (bz + si * u + co * v - S[i]![1]!) ** 2; });
      const k2 = co * co + si * si;
      if (!fit || e < fit.e) { bestD = d; fit = { e, sc, map: ([x, y]) => { const u = x - ax, v = f * y - ay; return [bx + co * u - si * v, bz + si * u + co * v]; },
        inv: ([x, z]) => { const dx = x - bx, dz = z - bz; return [(co * dx + si * dz) / k2 + ax, f * ((co * dz - si * dx) / k2 + ay)]; } }; }
    }
  };
  // The drawings start wherever the source way did, so the real start line can be anywhere on them: coarse over the whole loop, then fine.
  for (let d = -0.5; d < 0.5; d += 0.01) tryD(d);
  const d0 = bestD;
  for (let d = d0 - 0.01; d <= d0 + 0.0101; d += 0.0025) tryD(d);
  const len = fit!.sc * cumOf(t.loop)[t.loop.length - 1]!, ok = Math.sqrt(fit!.e / N) < Math.max(40, 0.03 * len); // a wrong layout or config: no drawing under the line
  const map = fit!.map;
  // Turn the loop so it starts at the fitted start line.
  const open = t.loop, cum = cumOf(t.loop), tot = cum[cum.length - 1]!, s = (((bestD % 1) + 1) % 1) * tot;
  const k = open.findIndex((_, i) => cum[i]! >= s);
  const turned: Pt[] = k < 0 ? open : [atFrac(t.loop, bestD), ...open.slice(k), ...open.slice(0, k)];
  const B: Aligned | null = ok ? { loop: [...turned, turned[0]!].map(map), pit: t.pit.map(map), labels: t.labels.map(([x, y, n]) => [...map([x, y]), n] as [number, number, string]), inv: fit!.inv } : null;
  if (B || !had || !had.B) ALIGN.set(name, { key, B }); else had.key = key;
  return B || (had?.B ?? null);
}

/** A recorded line from the start line round to the finish, in ACC's own frame, with the lap fraction of each point. */
const WHOLE = new WeakMap<object, { n: number; road: number[][] | null }>();
export function wholeLine(pts: ArrayLike<number[]> | null | undefined): number[][] | null {
  if (!pts) return null;
  const n = pts.length, had = WHOLE.get(pts);
  if (had && had.n === n) return had.road;
  const road = n < 100 || !(pts[0]![2]! < 0.05) || !(pts[n - 1]![2]! > 0.95) ? null : Array.from(pts);
  WHOLE.set(pts, { n, road });
  return road;
}

const WARP_REACH = 100, WARP_MAX = 150; // metres: the stretch whose offsets are averaged; the largest offset believed
const WARPED = new WeakMap<Aligned, { road: number[][]; out: Aligned }>();

/**
 * The drawing keeps its shape and detail but is pulled onto the track where the cars are. Each vertex is matched to the nearest
 * recorded point of about the same lap fraction; the offsets are averaged over WARP_REACH metres, so the drawing follows the slow
 * error of the fit and not the driver's wobble, and the pit ways and corner names move with the vertex nearest to them.
 */
export function warp(B: Aligned, road: number[][]): Aligned {
  const had = WARPED.get(B);
  if (had && had.road === road) return had.out;
  const L = B.loop, c = cumOf(L), tot = c[c.length - 1]!, n = L.length;
  const off = L.map((v, i): Pt | null => {
    const f = c[i]! / tot;
    let best: number[] | null = null, bd = WARP_MAX ** 2;
    for (const r of road) {
      const df = Math.abs(r[2]! - f);
      if (Math.min(df, 1 - df) > 0.1) continue;
      const e = (r[0]! - v[0]) ** 2 + (r[1]! - v[1]) ** 2;
      if (e < bd) { bd = e; best = r; }
    }
    return best ? [best[0]! - v[0], best[1]! - v[1]] : null;
  });
  const sm: Pt[] = L.map((_, i) => {
    let sx = 0, sy = 0, k = 0;
    for (let j = 0; j < n; j++) {
      const o = off[j], d = Math.abs(c[j]! - c[i]!);
      if (o && Math.min(d, tot - d) <= WARP_REACH) { sx += o[0]; sy += o[1]; k++; }
    }
    return k ? [sx / k, sy / k] : [0, 0];
  });
  sm[n - 1] = sm[0]!; // the loop stays closed
  const at = (p: Pt): Pt => {
    let j = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = (L[i]![0] - p[0]) ** 2 + (L[i]![1] - p[1]) ** 2; if (d < bd) { bd = d; j = i; } }
    return [p[0] + sm[j]![0], p[1] + sm[j]![1]];
  };
  const out: Aligned = { loop: L.map((v, i) => [v[0] + sm[i]![0], v[1] + sm[i]![1]] as Pt), pit: B.pit.map(at), labels: B.labels.map(([x, y, nm]) => [...at([x, y]), nm] as [number, number, string]), inv: B.inv };
  WARPED.set(B, { road, out });
  return out;
}

export interface MapView { zoom: number; follow: boolean; dx: number; dy: number; sc?: number; mid?: Pt; c?: Pt; /** The corner the view was last centred on (the lap map). */ fk?: string }

/** The drawn layout's corner names in ACC's own frame, once the layout fits a recorded line. */
export function cornerNames(track: string): [number, number, string][] | null {
  const t = trackFor(track), L = recorder.layoutFor(track);
  const lines: ArrayLike<number[]>[] = [recorder.curLine as number[][], ...recorder.lines.map((l) => l.pts as number[][])];
  const src: ArrayLike<number[]> = L ? L.pts : lines.reduce((a, b) => (b.length > a.length ? b : a), [] as number[][]);
  const B = t ? alignLayout(track, t, src) : null;
  if (!B) return null;
  const road = wholeLine(L?.pts) ?? wholeLine(recorder.bestLine()?.pts as number[][] | undefined);
  return (road ? warp(B, road) : B).labels;
}

/** One colour per label field when the map colours them. */
export const FIELD_COLOUR: Record<string, string> = { pos: "#f5b942", num: "#6cb6ff", code: "#e8ecf1", name: "#c3a6ff", gap: "#5fd38d" };

export interface MapOpts { field: boolean; fields: string[]; which: string; dim: boolean; colours: boolean; size: string; corners: boolean; sectors: boolean; road: string }
export interface MapHit { i: number; x: number; y: number }
export interface MapOut { hits: MapHit[]; info: string; empty: boolean }

export const mapScale = (o: { size?: string }): number => ({ s: 0.75, l: 1.4 } as Record<string, number>)[o.size ?? "m"] ?? 1;
/** A car is "near" when it is within this many ms of you on track. */
const NEAR_MS = 30000;
const fieldOn = (c: Ctx) => !!(c.field && c.bc?.state === "live");

/** Only positions: the track drawing or the layout the bridge saved, your car and the field. */
export function drawMap(cv: HTMLCanvasElement, view: MapView, c: Ctx, o: MapOpts): MapOut {
  const [g, w, h] = fitCanvas(cv), tk = tokens(), r = c.r, out: MapOut = { hits: [], info: "", empty: false };
  if (!r) return out;
  const p = r.session.car_position_m as number[] | undefined, own = !!(p && (p[0] || p[2]));
  const t = trackFor(r.fixed.track), L = recorder.layoutFor(r.fixed.track);
  const F = o.field && fieldOn(c) ? c.field : null;
  const lines: ArrayLike<number[]>[] = [recorder.curLine as number[][], ...recorder.lines.map((l) => l.pts as number[][])];
  const src: ArrayLike<number[]> = L ? L.pts : lines.reduce((a, b) => (b.length > a.length ? b : a), [] as number[][]);
  const B = t && (own || ALIGN.get(r.fixed.track)?.B) ? alignLayout(r.fixed.track, t, src) : null; // once aligned the frame stays, so the track never turns when the position reads 0 for a moment
  // One rotation and scale only puts the drawing roughly on the track; a whole recorded line (ACC's own frame, where the cars are)
  // lets warp() pull each stretch of the drawing onto where the track really is.
  const road = own && B ? wholeLine(L?.pts) ?? wholeLine(recorder.bestLine()?.pts as number[][] | undefined) : null;
  const world = (own || !!B) && (B || (!t && L));
  const W: Aligned | null = world ? (B ? (road ? warp(B, road) : B) : { loop: L!.pts.map((q) => [q[0], q[1]] as Pt), pit: [], labels: [] }) : null;
  // The drawing is always shown in its own orientation, so the track never turns whatever the fit does: the fit only carries ACC's
  // positions into it.
  const inv = W?.inv, T = (q: Pt): Pt => (inv ? inv(q) : q);
  const D: Aligned | null = W ? (inv ? { loop: W.loop.map(T), pit: W.pit.map(T), labels: W.labels.map(([x, y, n]) => [...T([x, y]), n] as [number, number, string]) } : W) : t ? { loop: [...t.loop, t.loop[0]!], pit: t.pit, labels: t.labels } : null;
  if (!D) { out.empty = true; return out; }
  const now = performance.now(), cars: [Car, Pt][] = [], xz = new Map<number, Pt>();
  const rxz = (r.xz as number[] | undefined) ?? [];
  for (let k = 0; k + 2 < rxz.length; k += 3) xz.set(rxz[k]!, [rxz[k + 1]!, rxz[k + 2]!]); // 30 Hz positions beat the field's 4 Hz ones
  const sp = r.session;
  const me: Pt = world && own ? T(glide("me", [p![0]!, p![2]!], now)) : atFrac(world ? D.loop : t!.loop, sp.track_position);
  if (F) {
    for (const car of c.cars.values()) {
      if (car.i === c.me) continue;
      if (IN_LANE.includes(car.loc)) continue; // cars in the pit lane are not drawn
      const q: Pt | null = (world && F.xz_ok ? xz.get(car.i) ?? (Array.isArray(car.xz) ? car.xz : null) : null) ?? (car.spl != null ? atFrac(world ? D.loop : t!.loop, car.spl) : null);
      if (!q) continue;
      const wq = world && F.xz_ok && (xz.has(car.i) || Array.isArray(car.xz)); // ACC's own frame, to be carried into the drawing
      const gq = glide(car.i, q, now);
      cars.push([car, wq ? T(gq) : gq]);
    }
  }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of D.loop) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const foc = c.focus !== "self" ? cars.find(([car]) => car.i === c.focus) : null;
  const pad = 20, base = Math.min((w - 2 * pad) / Math.max(400, x1 - x0), (h - 2 * pad) / Math.max(400, z1 - z0)), sc = base * view.zoom;
  const tgt = foc ? foc[1] : me, cx = view.follow ? tgt[0] : (x0 + x1) / 2 + view.dx, cz = view.follow ? tgt[1] : (z0 + z1) / 2 + view.dy;
  const X = (x: number) => w / 2 + (x - cx) * sc, Y = (z: number) => h / 2 + (z - cz) * sc;
  view.sc = sc; view.mid = [(x0 + x1) / 2, (z0 + z1) / 2]; view.c = [cx, cz]; // for panning out of follow
  const path = (pts: ArrayLike<number[]>, width: number, color: string) => {
    if (pts.length < 2) return;
    g.strokeStyle = color; g.lineWidth = width; g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i] as number[];
      if (i && Math.hypot(x! - pts[i - 1]![0]!, z! - pts[i - 1]![1]!) < 60) g.lineTo(X(x!), Y(z!)); else g.moveTo(X(x!), Y(z!));
    }
    g.stroke();
  };
  g.lineJoin = g.lineCap = "round";
  const rw = (({ s: 8, l: 20 } as Record<string, number>)[o.road] ?? 13) + Math.min(view.zoom - 1, 3) * 3; // the road grows a little as you zoom in
  path(D.loop, rw, tk.dim); path(D.loop, rw - 2, tk.bg); // an outline on each edge, empty between
  const ends = (c.s?.sector_pos as number[] | undefined) ?? [];
  if (o.sectors && ends.length && D.loop.length > 3) drawSectors(g, tk, o, D.loop, ends, X, Y, path, rw - 2);
  const avoid: number[][] = [];
  if (o.corners) { // corner names; car labels keep clear of them
    const fz = Math.round(10 * mapScale(o));
    g.font = `500 ${fz}px ${tk.font}`; g.fillStyle = tk.dim; g.textBaseline = "middle"; g.textAlign = "left";
    for (const [x, z, n] of D.labels) { g.fillText(n, X(x), Y(z)); avoid.push([X(x), Y(z) - fz / 2, g.measureText(n).width, fz]); }
  }
  const sf = D.loop[0]!;
  { // start/finish: a two-row chequered strip across the road, turned to the direction of travel
    const q = atFrac(D.loop, 0.002), ang = Math.atan2(Y(q[1]) - Y(sf[1]), X(q[0]) - X(sf[0])), sq = 2.5, n = Math.max(3, Math.round((rw + 4) / sq));
    g.save(); g.translate(X(sf[0]), Y(sf[1])); g.rotate(ang);
    for (let r = 0; r < 2; r++) for (let k = 0; k < n; k++) { g.fillStyle = (r + k) % 2 ? "#000" : "#fff"; g.fillRect(-sq + r * sq, (k - n / 2) * sq, sq, sq); }
    g.restore();
  }
  const mx = X(me[0]), my = Y(me[1]);
  drawField(g, tk, c, o, cars.map(([car, [x, z]]) => ({ car, sx: X(x), sy: Y(z) })), mx, my, foc ? foc[0] : null, r.session.in_pit_lane, w, h, out, avoid);
  if (c.me != null && !r.session.in_pit_lane) out.hits.push({ i: c.me, x: mx, y: my });
  out.info = [`${(r.session.track_position * 100).toFixed(1)} % of lap`, cars.length ? `${cars.length + 1} cars` : "", view.zoom > 1.01 ? `×${view.zoom.toFixed(1)}` : ""].filter(Boolean).join(" · ");
  return out;
}

/** Each sector's stretch of the road drawn in its own colour (S1 blue, S2 green, S3 red), named where it starts. */
function drawSectors(g: Ctx2D, tk: Tokens, o: MapOpts, loop: Pt[], ends: number[], X: (x: number) => number, Y: (z: number) => number, path: (pts: ArrayLike<number[]>, width: number, color: string) => void, width: number): void {
  const marks = [0, ...ends], n = marks.length, cum = cumOf(loop), tot = cum[cum.length - 1]!;
  const colour = [tk.cold, tk.ok, tk.bad];
  const fz = Math.round(10 * mapScale(o));
  g.font = `600 ${fz}px ${tk.num}`; g.textBaseline = "middle"; g.textAlign = "center"; g.lineJoin = "round";
  for (let i = 0; i < n; i++) {
    const a = marks[i]!, b = i + 1 < n ? marks[i + 1]! : 1, col = colour[i % 3]!;
    g.lineCap = "butt";
    path([atFrac(loop, a), ...loop.filter((_, j) => cum[j]! > a * tot && cum[j]! < b * tot), atFrac(loop, b === 1 ? 0.99999 : b)], width, col);
    const p = atFrac(loop, a), q = atFrac(loop, a + 0.004), px = X(q[0]) - X(p[0]), py = Y(q[1]) - Y(p[1]), len = Math.hypot(px, py) || 1;
    const lx = X(p[0]) - (py / len) * 18, ly = Y(p[1]) + (px / len) * 18, t = "S" + (i + 1);
    g.strokeStyle = tk.bg; g.lineWidth = 3.5; g.strokeText(t, lx, ly); g.fillStyle = col; g.fillText(t, lx, ly);
  }
  g.textAlign = "left"; g.lineCap = "round";
}

// ACC cup categories: Overall, Pro-Am, Am, Silver, National. Overall keeps the plain dot.
const CUP_COLOUR = [null, "#f5b942", "#5fd38d", "#c3a6ff", "#6cb6ff"];

// Shape by class: GT3 circle, GT4 square, GT2 diamond, TCX triangle.
function classShape(g: Ctx2D, cls: string | undefined, x: number, y: number, r: number): void {
  g.beginPath();
  if (cls === "GT4") g.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
  else if (cls === "GT2") { g.moveTo(x, y - r * 1.25); g.lineTo(x + r * 1.25, y); g.lineTo(x, y + r * 1.25); g.lineTo(x - r * 1.25, y); g.closePath(); }
  else if (cls === "TCX") { g.moveTo(x, y - r * 1.2); g.lineTo(x + r * 1.1, y + r * 0.85); g.lineTo(x - r * 1.1, y + r * 0.85); g.closePath(); }
  else g.arc(x, y, r, 0, 7);
}

const FIELD_ORDER = ["pos", "num", "code", "name", "gap"];

interface Dot { car: Car; sx: number; sy: number }

/** The field's dots (and your own disc) with their labels, over a map already drawn. `avoid` are boxes no label may cover. */
function drawField(g: Ctx2D, tk: Tokens, c: Ctx, o: MapOpts, dots: Dot[], mx: number, my: number, foc: Car | null, inPit: boolean, w: number, h: number, out: MapOut, avoid: number[][]): void {
  const k = mapScale(o), blink = Math.floor(performance.now() / 600) % 2 === 0; // blue flags blink slowly: 0.6 s on, 0.6 s off
  const meCar0 = c.me != null ? c.cars.get(c.me) : undefined, race = c.mode === "race";
  // ACC publishes no flag for other cars: a car is marked blue when it is a lap or more down and just ahead of you in a race (about to be lapped).
  const lapped = (car: Car) => race && !!meCar0 && car.laps != null && meCar0.laps != null && car.laps < meCar0.laps && car.rel != null && car.rel > 0 && car.rel < 6000;
  const blueRing = (x: number, y: number, rad: number) => { if (!blink) return; g.beginPath(); g.arc(x, y, rad, 0, 7); g.strokeStyle = tk.cold; g.lineWidth = 3; g.stroke(); };
  // Other cars: one circle each (cars in the pit lane are not drawn); a ring on the focus car.
  for (const { car, sx, sy } of dots) {
    g.globalAlpha = o.dim && !(car.rel != null && Math.abs(car.rel) < NEAR_MS) ? 0.4 : 1;
    classShape(g, car.class, sx, sy, 5 * k);
    g.fillStyle = CUP_COLOUR[car.cup ?? 0] ?? tk.text; g.fill(); g.strokeStyle = tk.bg; g.lineWidth = 1.5; g.stroke();
    g.globalAlpha = 1;
    if (lapped(car)) blueRing(sx, sy, 10 * k);
    if (car === foc) { g.beginPath(); g.arc(sx, sy, 10 * k, 0, 7); g.strokeStyle = tk.accent; g.lineWidth = 2; g.stroke(); }
    out.hits.push({ i: car.i, x: sx, y: sy });
  }
  if (!inPit) meDisc(g, mx, my, tk, false, k); // you are not drawn in the pit lane either
  if (!inPit && c.r && c.r.session.flag === 1) blueRing(mx, my, 12 * k); // your own blue flag, from the game
  if (!o.fields.length) return;
  // Every label sits right beside its car; the focus car is drawn last so it stays on top where labels meet.
  const fs = Math.round(clamp(Math.min(w, h) / 60, 10, 14) * k);
  g.font = `600 ${fs}px ${tk.num}`; g.textBaseline = "middle"; g.textAlign = "left";
  const meCar = c.me != null ? c.cars.get(c.me) : undefined;
  const meLb = (o.fields.includes("code") && meCar && carName(meCar, "code")) || "YOU"; // your own car is named too
  g.lineJoin = "round"; g.strokeStyle = tk.bg; g.lineWidth = 3.5;
  if (!inPit) { g.strokeText(meLb, mx + 10 * k, my); g.fillStyle = tk.me; g.fillText(meLb, mx + 10 * k, my); }
  // Which labels get drawn is decided by priority, not by shoving them about: you and the focus car always, then the cars nearest you in
  // time. A label goes right of its dot, else left, never up or down, and never over a dot or a label already placed. If the full
  // label does not fit, a short one (a single field) is tried; if that does not fit either the dot stays unlabelled. Zooming in
  // makes room, so more labels appear.
  const lh = fs + 2, R = 6 * k;
  const placed: number[][] = [...dots.map((d) => [d.sx - R, d.sy - R, 2 * R, 2 * R])];
  if (!inPit) placed.push([mx + 10 * k, my - lh / 2, g.measureText(meLb).width, lh], [mx - 8 * k, my - 8 * k, 16 * k, 16 * k]);
  const hit = (x: number, y: number, bw: number, own: number[]) => placed.some((b) => b !== own && x < b[0]! + b[2]! + 2 && b[0]! < x + bw + 2 && y - lh / 2 < b[1]! + b[3]! && b[1]! < y + lh / 2);
  const SHORT = ["pos", "num", "code", "name", "gap"];
  const todo: { d: Dot; text: string; part: Record<string, string>; used: string[]; x: number }[] = [];
  const order = dots.slice().sort((a, b) => Number(b.car === foc) - Number(a.car === foc) || Math.abs(a.car.rel ?? 1e9) - Math.abs(b.car.rel ?? 1e9));
  dots.forEach((d, i) => { (d as Dot & { box?: number[] }).box = placed[i]; });
  for (const d of order) {
    const x0 = d.car;
    if (o.which === "focus" ? x0 !== foc : o.which === "near" ? !(x0.rel != null && Math.abs(x0.rel) < NEAR_MS) : o.which === "class" ? !(meCar && x0.class === meCar.class) : false) continue;
    const part: Record<string, string> = {
      pos: x0.pos ? "P" + x0.pos : "", num: x0.num != null ? String(x0.num) : "", code: carName(x0, "code"), name: carName(x0, "last"),
      gap: x0.rel != null && isFinite(x0.rel) ? fmtRel(x0.rel) : "",
    };
    const used = FIELD_ORDER.filter((f) => o.fields.includes(f) && part[f]);
    if (!used.length) continue;
    const short = SHORT.find((f) => used.includes(f))!;
    const own = (d as Dot & { box?: number[] }).box!, y = d.sy;
    let done = false;
    for (const fl of used.length > 1 ? [used, [short]] : [used]) {
      const text = fl.map((f) => part[f]).join(" "), bw = g.measureText(text).width;
      for (const x of [d.sx + 8 * k, d.sx - 8 * k - bw]) {
        if (x < 2 || x + bw > w - 2 || hit(x, y, bw, own)) continue;
        placed.push([x, y - lh / 2, bw, lh]);
        todo.push({ d, text, part, used: fl, x });
        done = true; break;
      }
      if (done) break;
    }
    if (!done && d.car === foc) { const text = used.map((f) => part[f]).join(" "); todo.push({ d, text, part, used, x: d.sx + 8 * k }); } // the focus car is always named
  }
  for (const t of todo.sort((a, b) => Number(a.d.car === foc) - Number(b.d.car === foc))) {
    const { d, x } = t, y = d.sy;
    g.strokeText(t.text, x, y);
    if (o.colours) {
      let px = x;
      for (const fl of t.used) { g.fillStyle = FIELD_COLOUR[fl] ?? tk.text; g.fillText(t.part[fl]!, px, y); px += g.measureText(t.part[fl] + " ").width; }
    } else { g.fillStyle = d.car === foc ? tk.accent : tk.text; g.fillText(t.text, x, y); }
  }
}

/** Own car: a --me disc, --bg outline and a --bg centre dot; hollow in the pit lane. */
function meDisc(g: Ctx2D, x: number, y: number, tk: Tokens, pit: boolean, k = 1): void {
  g.beginPath(); g.arc(x, y, 7 * k, 0, 7);
  if (pit) { g.strokeStyle = tk.me; g.lineWidth = 2; g.stroke(); } else { g.fillStyle = tk.me; g.fill(); g.strokeStyle = tk.bg; g.lineWidth = 1.5; g.stroke(); }
  g.beginPath(); g.arc(x, y, 2 * k, 0, 7); g.fillStyle = pit ? tk.me : tk.bg; g.fill();
}

/** Wheel to zoom, drag to pan, double-click to follow; a click without a drag goes to onClick(x, y) in canvas pixels. Returns the cleanup. */
export function bindMapControls(cv: HTMLCanvasElement, view: MapView, onChange: () => void, onClick: (x: number, y: number) => void): () => void {
  let drag: { x: number; y: number; moved: boolean } | null = null;
  const wheel = (e: WheelEvent) => { // zoom about the pointer: the point under it stays under it
    e.preventDefault();
    const z0 = view.zoom, z1 = clamp(z0 * (e.deltaY < 0 ? 1.25 : 0.8), 1, 40);
    if (z1 === z0) return;
    if (view.sc && view.c && view.mid && !view.follow) { // following: the car stays in the middle
      const b = cv.getBoundingClientRect(), px = e.clientX - b.left - b.width / 2, py = e.clientY - b.top - b.height / 2, sc1 = (view.sc * z1) / z0;
      view.dx += px / view.sc - px / sc1; view.dy += py / view.sc - py / sc1;
    }
    view.zoom = z1;
    if (z1 === 1) view.dx = view.dy = 0;
    onChange();
  };
  const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, moved: false }; cv.setPointerCapture(e.pointerId); };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
    const sc = view.sc || 1;
    if (view.follow && view.c && view.mid) { view.follow = false; view.dx = view.c[0] - view.mid[0]; view.dy = view.c[1] - view.mid[1]; }
    view.dx -= (e.clientX - drag.x) / sc; view.dy -= (e.clientY - drag.y) / sc;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved = true;
    onChange();
  };
  const up = (e: PointerEvent) => {
    const d = drag;
    drag = null;
    if (d && !d.moved) { const b = cv.getBoundingClientRect(); onClick(e.clientX - b.left, e.clientY - b.top); }
  };
  const dbl = () => { view.follow = !view.follow; if (view.follow && view.zoom < 4) view.zoom = 4; onChange(); };
  cv.addEventListener("wheel", wheel, { passive: false });
  cv.addEventListener("pointerdown", down);
  cv.addEventListener("pointermove", move);
  cv.addEventListener("pointerup", up);
  cv.addEventListener("dblclick", dbl);
  return () => {
    cv.removeEventListener("wheel", wheel); cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move);
    cv.removeEventListener("pointerup", up); cv.removeEventListener("dblclick", dbl);
  };
}
