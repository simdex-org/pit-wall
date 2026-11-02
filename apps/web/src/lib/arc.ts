import { clamp } from "./format";

// A gauge sweeps 270 degrees, from -135 (lower left) to +135 (lower right), 0 at twelve o'clock.
export const SWEEP = 135;

export const angleOf = (v: number, lo: number, hi: number) => -SWEEP + 2 * SWEEP * clamp((v - lo) / (hi - lo || 1), 0, 1);

export const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => [
  cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180),
];

export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  if (a1 < a0 + 0.4) a1 = a0 + 0.4;
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}
