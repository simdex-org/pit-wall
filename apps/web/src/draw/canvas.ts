import { aux } from "../engine/versions";

const TOKEN_VARS = {
  bg: "--bg", panel: "--panel", raise: "--raise", line: "--line", line2: "--line2", text: "--txt", muted: "--mut", dim: "--dim", accent: "--acc",
  me: "--me", best: "--best", pb: "--pb", slow: "--slow", invalid: "--inv", ok: "--ok", warn: "--warn", bad: "--bad", cold: "--cold",
  chSpeed: "--c-speed", chThr: "--c-thr", chBrk: "--c-brk", chSteer: "--c-steer", chGear: "--c-gear", chRpm: "--c-rpm", chRef: "--c-ref", chCmp: "--c-cmp",
  chLap: "--c-lap", chFL: "--c-fl", chFR: "--c-fr", chRL: "--c-rl", chRR: "--c-rr", accSoft: "--acc-soft", badSoft: "--bad-soft", warnSoft: "--warn-soft",
} as const;

export type Tokens = Record<keyof typeof TOKEN_VARS, string> & { font: string; num: string };

let cache: { ver: number; tk: Tokens } | null = null;

/** The design tokens as resolved colours, read through a probe so color-mix() and theme overrides resolve too. */
export function tokens(): Tokens {
  const ver = aux.version("theme");
  if (cache && cache.ver === ver) return cache.tk;
  let p = document.getElementById("tokProbe");
  if (!p) { p = document.createElement("span"); p.id = "tokProbe"; p.hidden = true; document.body.appendChild(p); }
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(TOKEN_VARS)) { p.style.color = ""; p.style.color = `var(${v})`; o[k] = getComputedStyle(p).color; }
  o.font = getComputedStyle(document.body).fontFamily;
  o.num = getComputedStyle(document.documentElement).getPropertyValue("--num").trim() || '"IBM Plex Mono", monospace';
  cache = { ver, tk: o as Tokens };
  return cache.tk;
}

export type Ctx2D = CanvasRenderingContext2D;

/** Sizes the canvas to its box at the device's pixel ratio and clears it. */
export function fitCanvas(cv: HTMLCanvasElement): [Ctx2D, number, number] {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return [g, w, h];
}

export function chGrid(g: Ctx2D, w: number, h: number, tk: Tokens): void {
  g.strokeStyle = tk.line; g.lineWidth = 1; g.beginPath();
  for (let k = 1; k < 4; k++) { const y = Math.round((h * k) / 4) + 0.5; g.moveTo(0, y); g.lineTo(w, y); }
  g.stroke();
}

export const chY = (v: number, lo: number, hi: number, top: number, h: number): number => top + h - 3 - (h - 6) * Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));

export function chCursor(g: Ctx2D, x: number, h: number, tk: Tokens): void {
  g.strokeStyle = tk.text; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, h); g.stroke(); g.setLineDash([]);
}

/** A value label on the line: a --bg box with the value in the series colour. */
export function chTag(g: Ctx2D, x: number, y: number, text: string, color: string, tk: Tokens, w: number): void {
  g.font = `600 10px ${tk.num}`;
  const tw = g.measureText(text).width + 6, left = x + 6 + tw > w ? x - 6 - tw : x + 6, top = Math.round(y - 7);
  g.fillStyle = tk.bg; g.fillRect(left, top, tw, 14); g.strokeStyle = color; g.lineWidth = 1; g.strokeRect(left + 0.5, top + 0.5, tw - 1, 13);
  g.fillStyle = color; g.textBaseline = "middle"; g.textAlign = "left"; g.fillText(text, left + 3, top + 7.5);
}

/** Lane title and readouts, left to right, on a --bg strip so a title over a trace stays readable. */
export function chLabel(g: Ctx2D, x: number, y: number, parts: [string, string][], tk: Tokens): void {
  g.font = `600 10px ${tk.font}`; g.textBaseline = "top"; g.textAlign = "left";
  let cx = x;
  const ws = parts.map(([t]) => g.measureText(t).width + 8), tot = ws.reduce((a, b) => a + b, 0);
  g.fillStyle = tk.bg; g.fillRect(x - 2, y - 1, tot + 2, 13);
  parts.forEach(([t, col], i) => { g.fillStyle = col; g.fillText(t, cx, y); cx += ws[i]!; });
}
