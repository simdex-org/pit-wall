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

function nearFrac(loop: Pt[], q: Pt): number {
  let b = 0, bd = Infinity;
  for (let i = 0; i < loop.length; i += 2) { const d = (loop[i]![0] - q[0]) ** 2 + (loop[i]![1] - q[1]) ** 2; if (d < bd) { bd = d; b = i; } }
  return b / (loop.length - 1);
}

/**
 * The pit lane is drawn for every track from its loop (the drawn pit ways are fragments, and some tracks have none): PIT_M metres
 * before the line to PIT_M after it, PIT_OFF metres to the side the drawn pit ways lie on (right of the direction if none), tapering
 * into the track at both ends. Cars with a pit location sit on it by track position, in the garage row (PIT_BOX m further out) when stopped.
 */
const PIT_M = 250, PIT_OFF = 24, PIT_BOX = 9;
interface PitLane { pts: [number, number, number, number][]; a: number }

function pitLaneOf(loop: Pt[], pit: Pt[]): PitLane {
  const len = cumOf(loop)[loop.length - 1]!, a = PIT_M / len, e = 3 / len;
  const tn = (f: number): Pt => { const p = atFrac(loop, f - e), q = atFrac(loop, f + e), l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [-(q[1] - p[1]) / l, (q[0] - p[0]) / l]; };
  let side = 0;
  for (const q of pit) {
    const f = nearFrac(loop, q), p = atFrac(loop, f), n = tn(f), d = (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1];
    if (Math.abs(d) > 4 && Math.abs(d) < 60 && (f < a * 1.5 || f > 1 - a * 1.5)) side += Math.sign(d);
  }
  side = side < 0 ? -1 : 1;
  const pts: PitLane["pts"] = [];
  for (let k = 0; k <= 24; k++) {
    const u = k / 24, f = -a + 2 * a * u, p = atFrac(loop, f), n = tn(f), o = side * PIT_OFF * Math.min(1, 5 * Math.min(u, 1 - u));
    pts.push([p[0] + n[0] * o, p[1] + n[1] * o, n[0] * side, n[1] * side]);
  }
  return { pts, a };
}

function onPitLane(lane: PitLane, spl: number, still: boolean): Pt {
  const f = spl > 0.5 ? spl - 1 : spl, x = clamp((f + lane.a) / (2 * lane.a), 0, 1) * (lane.pts.length - 1);
  const i = Math.min(lane.pts.length - 2, Math.floor(x)), t = x - i, A = lane.pts[i]!, B = lane.pts[i + 1]!;
  const o = still ? PIT_BOX * Math.min(1, 5 * Math.min(x / 24, 1 - x / 24)) : 0;
  return [A[0] + (B[0] - A[0]) * t + A[2] * o, A[1] + (B[1] - A[1]) * t + A[3] * o];
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
interface Aligned { loop: Pt[]; pit: Pt[]; labels: [number, number, string][] }
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
  let fit: { e: number; sc: number; map: (p: Pt) => Pt } | null = null;
  for (let d = -0.05; d <= 0.0501; d += 0.0025) {
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
      if (!fit || e < fit.e) fit = { e, sc, map: ([x, y]) => { const u = x - ax, v = f * y - ay; return [bx + co * u - si * v, bz + si * u + co * v]; } };
    }
  }
  const len = fit!.sc * cumOf(t.loop)[t.loop.length - 1]!, ok = Math.sqrt(fit!.e / N) < Math.max(40, 0.03 * len); // a wrong layout or config: no drawing under the line
  const map = fit!.map;
  const B: Aligned | null = ok ? { loop: [...t.loop, t.loop[0]!].map(map), pit: t.pit.map(map), labels: t.labels.map(([x, y, n]) => [...map([x, y]), n] as [number, number, string]) } : null;
  if (B || !had || !had.B) ALIGN.set(name, { key, B }); else had.key = key;
  return B || (had?.B ?? null);
}

export interface MapView { zoom: number; follow: boolean; dx: number; dy: number; sc?: number; mid?: Pt; c?: Pt }
export interface MapOpts { field: boolean; labels: string; size: string; corners: boolean }
export interface MapHit { i: number; x: number; y: number }
export interface MapOut { hits: MapHit[]; info: string; empty: boolean }

export const mapScale = (o: { size?: string }): number => ({ s: 0.75, l: 1.4 } as Record<string, number>)[o.size ?? "m"] ?? 1;
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
  const B = t && own ? alignLayout(r.fixed.track, t, src) : null;
  // A track with a drawing is always that drawing: the saved layout only stands in where there is none.
  const world = own && (B || (!t && L)) && (!F || F.xz_ok);
  const D: Aligned | null = world ? (B ? B : { loop: L!.pts.map((q) => [q[0], q[1]] as Pt), pit: [], labels: [] }) : t ? { loop: [...t.loop, t.loop[0]!], pit: t.pit, labels: t.labels } : null;
  if (!D) { out.empty = true; return out; }
  const now = performance.now(), cars: [Car, Pt][] = [], xz = new Map<number, Pt>();
  const rxz = (r.xz as number[] | undefined) ?? [];
  for (let k = 0; k + 2 < rxz.length; k += 3) xz.set(rxz[k]!, [rxz[k + 1]!, rxz[k + 2]!]); // 30 Hz positions beat the field's 4 Hz ones
  const lane = pitLaneOf(D.loop, D.pit), sp = r.session, mePit = sp.in_pit_lane && sp.track_position != null;
  const me: Pt = mePit ? glide("me", onPitLane(lane, sp.track_position, r.car.speed_kmh < 5), now) : world ? glide("me", [p![0]!, p![2]!], now) : atFrac(t!.loop, sp.track_position);
  if (F) {
    for (const car of c.cars.values()) {
      if (car.i === c.me) continue;
      if (IN_LANE.includes(car.loc) && car.spl != null) { cars.push([car, glide(car.i, onPitLane(lane, car.spl, car.loc === "pit" && car.kmh < 5), now)]); continue; }
      const q: Pt | null = world ? xz.get(car.i) ?? (Array.isArray(car.xz) ? car.xz : null) : car.spl != null ? atFrac(t!.loop, car.spl) : null;
      if (q) cars.push([car, glide(car.i, q, now)]);
    }
  }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const pts of [D.loop, lane.pts]) for (const [x, z] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
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
  path(lane.pts, 9, tk.line); path(D.loop, 16, tk.line); path(D.loop, 2, tk.muted); // the road and its centre line
  g.setLineDash([4, 3]); path(lane.pts, 1, tk.muted); g.setLineDash([]); // the pit lane beside it
  const avoid: number[][] = [];
  if (o.corners !== false) { // corner names; car labels keep clear of them
    const fz = Math.round(10 * mapScale(o));
    g.font = `500 ${fz}px ${tk.font}`; g.fillStyle = tk.dim; g.textBaseline = "middle"; g.textAlign = "left";
    for (const [x, z, n] of D.labels) { g.fillText(n, X(x), Y(z)); avoid.push([X(x), Y(z) - fz / 2, g.measureText(n).width, fz]); }
  }
  const sf = D.loop[0]!;
  g.fillStyle = tk.text; g.fillRect(X(sf[0]) - 5, Y(sf[1]) - 1.5, 10, 3); // start/finish
  const mx = X(me[0]), my = Y(me[1]);
  drawField(g, tk, c, o, cars.map(([car, [x, z]]) => ({ car, sx: X(x), sy: Y(z) })), mx, my, foc ? foc[0] : null, r.session.in_pit_lane, w, h, out, avoid);
  if (c.me != null) out.hits.push({ i: c.me, x: mx, y: my });
  out.info = [`${(r.session.track_position * 100).toFixed(1)} % of lap`, cars.length ? `${cars.length + 1} cars` : "", view.zoom > 1.01 ? `×${view.zoom.toFixed(1)}` : ""].filter(Boolean).join(" · ");
  return out;
}

interface Dot { car: Car; sx: number; sy: number }

/** The field's dots (and your own disc) with their labels, over a map already drawn. `avoid` are boxes no label may cover. */
function drawField(g: Ctx2D, tk: Tokens, c: Ctx, o: MapOpts, dots: Dot[], mx: number, my: number, foc: Car | null, inPit: boolean, w: number, h: number, out: MapOut, avoid: number[][]): void {
  const k = mapScale(o), blink = Math.floor(performance.now() / 600) % 2 === 0; // blue flags blink slowly: 0.6 s on, 0.6 s off
  const meCar0 = c.me != null ? c.cars.get(c.me) : undefined, race = c.mode === "race";
  // ACC publishes no flag for other cars: a car is marked blue when it is a lap or more down and just ahead of you in a race (about to be lapped).
  const lapped = (car: Car) => race && !!meCar0 && car.laps != null && meCar0.laps != null && car.laps < meCar0.laps && car.rel != null && car.rel > 0 && car.rel < 6000;
  const blueRing = (x: number, y: number, rad: number) => { if (!blink) return; g.beginPath(); g.arc(x, y, rad, 0, 7); g.strokeStyle = tk.cold; g.lineWidth = 3; g.stroke(); };
  // Other cars: one circle each; hollow in the pit lane; a ring on the focus car.
  for (const { car, sx, sy } of dots) {
    const pit = IN_LANE.includes(car.loc);
    g.beginPath(); g.arc(sx, sy, 5 * k, 0, 7);
    if (pit) { g.strokeStyle = tk.text; g.lineWidth = 1.5; g.stroke(); } else { g.fillStyle = tk.text; g.fill(); g.strokeStyle = tk.bg; g.lineWidth = 1.5; g.stroke(); }
    if (lapped(car)) blueRing(sx, sy, 10 * k);
    if (car === foc) { g.beginPath(); g.arc(sx, sy, 10 * k, 0, 7); g.strokeStyle = tk.accent; g.lineWidth = 2; g.stroke(); }
    out.hits.push({ i: car.i, x: sx, y: sy });
  }
  meDisc(g, mx, my, tk, inPit, k);
  if (c.r && c.r.session.flag === 1) blueRing(mx, my, 12 * k); // your own blue flag, from the game
  if (o.labels === "none") return;
  // Labels in priority order (focus car, then the nearest on track, then by position), each at the first spot whose box overlaps
  // nothing placed yet (your disc counts); a label with no free spot is skipped, the dot stays.
  const fs = Math.round(clamp(Math.min(w, h) / 60, 10, 14) * k);
  g.font = `600 ${fs}px ${tk.num}`; g.textBaseline = "middle"; g.textAlign = "left";
  const taken: number[][] = [...avoid, [mx - 9 * k, my - 9 * k, 18 * k, 18 * k], ...dots.map((d) => [d.sx - 6 * k, d.sy - 6 * k, 12 * k, 12 * k])];
  const meCar = c.me != null ? c.cars.get(c.me) : undefined;
  const meLb = (o.labels === "short" && meCar && carName(meCar, "code")) || "YOU"; // your own car is named too
  g.lineJoin = "round"; g.strokeStyle = tk.bg; g.lineWidth = 3.5;
  g.strokeText(meLb, mx + 10 * k, my); g.fillStyle = tk.me; g.fillText(meLb, mx + 10 * k, my);
  taken.push([mx + 10 * k, my - fs / 2, g.measureText(meLb).width, fs + 1]);
  const pri = (d: Dot) => (d.car === foc ? -1e9 : d.car.rel != null && isFinite(d.car.rel) ? Math.abs(d.car.rel) : 1e6 + (d.car.pos || 99));
  for (const d of dots.slice().sort((a, b) => pri(a) - pri(b))) {
    const lb = o.labels === "gap" ? (d.car.rel != null && isFinite(d.car.rel) ? fmtRel(d.car.rel) : "")
      : o.labels === "short" ? carName(d.car, "code") : o.labels === "name" ? carName(d.car, "last")
      : o.labels === "both" ? `${d.car.num != null ? d.car.num : ""} ${carName(d.car, "code")}`.trim() : d.car.num != null ? String(d.car.num) : "";
    if (!lb) continue;
    // Always to the right of its dot; cars closer than 12 px stack their labels downwards in car-number order (yours first), so none is hidden.
    const near = (ax: number, ay: number) => Math.hypot(d.sx - ax, d.sy - ay) < 12 * k;
    const rank = (near(mx, my) ? 1 : 0) + dots.filter((e) => e !== d && e.car.i < d.car.i && near(e.sx, e.sy)).length;
    const x = d.sx + 8 * k, y = d.sy + rank * (fs + 1);
    g.strokeText(lb, x, y); g.fillStyle = d.car === foc ? tk.accent : tk.text; g.fillText(lb, x, y);
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
