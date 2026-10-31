import { NB } from "../lib/coach/measure";
import type { Corner } from "../lib/coach/measure";
import type { LinePoint } from "../state/recorder";
import { fitCanvas, tokens } from "./canvas";

export interface LapMapIn {
  pts: LinePoint[];
  /** Speed of the reference lap per bin, and of the comparison lap when there is one. */
  ref: ArrayLike<number> | null; cmp: ArrayLike<number> | null;
  corners: Corner[];
  corner: number | null;
  cursor: number | null;
}

const bin = (f: number) => Math.max(0, Math.min(NB - 1, Math.round(f * (NB - 1))));
const frac = (p: LinePoint, i: number, n: number) => p[2] ?? i / (n - 1);
export const inZone = (z: Corner, j: number) => (z.end >= NB ? j >= z.start || j <= z.end - NB : j >= z.start && j <= z.end);

/** The reference lap's line, shaded by the speed it carried (or, with a comparison lap, by who was faster). Returns a function from a pointer to the lap fraction. */
export function drawLapMap(cv: HTMLCanvasElement, d: LapMapIn): (x: number, y: number) => number | null {
  const [g, w, h] = fitCanvas(cv), tk = tokens();
  if (d.pts.length < 2) return () => null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of d.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const pad = 16, k = Math.min((w - 2 * pad) / (x1 - x0 || 1), (h - 2 * pad) / (y1 - y0 || 1));
  const X = (v: number) => (w - (x1 - x0) * k) / 2 + (v - x0) * k, Y = (v: number) => (h - (y1 - y0) * k) / 2 + (v - y0) * k;
  const top = d.ref ? Math.max(...Array.from(d.ref)) : 1, low = d.ref ? Math.min(...Array.from(d.ref)) : 0;
  const z = d.corner != null ? d.corners.find((q) => q.n === d.corner) : null;
  g.lineCap = "round"; g.lineJoin = "round";
  for (let i = 1; i < d.pts.length; i++) {
    const a = d.pts[i - 1]!, b = d.pts[i]!, j = bin(frac(b, i, d.pts.length));
    let c = tk.muted;
    if (d.ref && d.cmp) { const dv = d.ref[j]! - d.cmp[j]!; c = Math.abs(dv) < 1 ? tk.muted : dv > 0 ? tk.ok : tk.bad; }
    else if (d.ref) c = `color-mix(in srgb, ${tk.cold}, ${tk.warn} ${Math.round(((d.ref[j]! - low) / (top - low || 1)) * 100)}%)`;
    const on = z ? inZone(z, j) : true;
    g.globalAlpha = on ? 1 : 0.25; g.strokeStyle = c; g.lineWidth = on && z ? 5 : 3;
    g.beginPath(); g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); g.stroke();
  }
  g.globalAlpha = 1; g.font = `11px ${tk.font}`; g.textAlign = "center"; g.textBaseline = "middle";
  const at = (f: number) => d.pts[Math.min(d.pts.length - 1, Math.round(f * (d.pts.length - 1)))]!;
  for (const q of d.corners) {
    const p = at(q.apex / (NB - 1)), cx = X(p[0]), cy = Y(p[1]);
    g.fillStyle = q.n === d.corner ? tk.accent : tk.panel; g.strokeStyle = tk.text; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = q.n === d.corner ? tk.bg : tk.text; g.fillText(String(q.n), cx, cy + 0.5);
  }
  if (d.cursor != null) { const p = at(d.cursor); g.fillStyle = tk.me; g.beginPath(); g.arc(X(p[0]), Y(p[1]), 5, 0, Math.PI * 2); g.fill(); }
  return (px, py) => {
    let best = -1, bd = 24;
    d.pts.forEach((p, i) => { const e = Math.hypot(X(p[0]) - px, Y(p[1]) - py); if (e < bd) { bd = e; best = i; } });
    return best < 0 ? null : frac(d.pts[best]!, best, d.pts.length);
  };
}
