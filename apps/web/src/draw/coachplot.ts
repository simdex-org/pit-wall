// One corner's zone, benchmark against subject: speed over the throttle and brake.
import { wrap } from "../lib/coach/measure";
import type { LapData } from "../state/recorder";
import { fitCanvas, tokens } from "./canvas";

export function drawZone(cv: HTMLCanvasElement, subj: LapData, bench: LapData, c: { start: number; end: number; apex: number }, spd: (kmh: number) => number): void {
  const [g, w, h] = fitCanvas(cv), tk = tokens(), top = 4, sh = Math.round(h * 0.6), ph = h - sh - 10;
  const X = (u: number) => ((u - c.start) / (c.end - c.start)) * w;
  let hi = 1, lo = Infinity;
  for (const d of [subj, bench]) for (let u = c.start; u <= c.end; u++) { const v = spd(d.speed[wrap(u)]!); if (v > hi) hi = v; if (v < lo) lo = v; }
  const line = (d: LapData, ch: "speed" | "thr" | "brk", y0: number, hh: number, a: number, b: number, col: string, dash: number[]) => {
    g.beginPath();
    for (let u = c.start; u <= c.end; u++) {
      const v = ch === "speed" ? spd(d.speed[wrap(u)]!) : d[ch][wrap(u)]!, y = y0 + hh - ((v - a) / (b - a || 1)) * hh;
      if (u > c.start) g.lineTo(X(u), y); else g.moveTo(X(u), y);
    }
    g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
  };
  g.strokeStyle = tk.line; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(Math.round(X(c.apex)) + 0.5, 0); g.lineTo(Math.round(X(c.apex)) + 0.5, h); g.stroke(); g.setLineDash([]);
  line(bench, "speed", top, sh - top, lo * 0.95, hi, tk.chRef, []);
  line(subj, "speed", top, sh - top, lo * 0.95, hi, tk.chCmp, [4, 3]);
  const y0 = sh + 6;
  for (const ch of ["thr", "brk"] as const) {
    line(bench, ch, y0, ph, 0, 1, ch === "thr" ? tk.chThr : tk.chBrk, []);
    line(subj, ch, y0, ph, 0, 1, ch === "thr" ? tk.chThr : tk.chBrk, [4, 3]);
  }
  g.font = `500 10px ${tk.num}`; g.fillStyle = tk.dim; g.textBaseline = "top"; g.textAlign = "left"; g.fillText(`${Math.round(hi)}`, 2, top);
  g.textBaseline = "bottom"; g.fillText(`${Math.round(lo)}`, 2, sh - 1);
}
