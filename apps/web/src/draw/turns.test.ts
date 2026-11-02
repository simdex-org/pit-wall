import { describe, expect, it } from "vitest";
import { findTurns } from "./turns";

// A 1000 m by 400 m rectangle with 100 m radius corners, driven from the middle of the bottom straight.
function stadium(): [number, number][] {
  const pts: [number, number][] = [];
  const arc = (cx: number, cz: number, a0: number) => { for (let i = 0; i <= 20; i++) { const a = a0 + (i / 20) * (Math.PI / 2); pts.push([cx + 100 * Math.cos(a), cz + 100 * Math.sin(a)]); } };
  for (let x = 500; x <= 900; x += 20) pts.push([x, 0]);
  arc(900, 100, -Math.PI / 2);
  for (let z = 100; z <= 300; z += 20) pts.push([1000, z]);
  arc(900, 300, 0);
  for (let x = 900; x >= 100; x -= 20) pts.push([x, 400]);
  arc(100, 300, Math.PI / 2);
  for (let z = 300; z >= 100; z -= 20) pts.push([0, z]);
  arc(100, 100, Math.PI);
  for (let x = 100; x < 500; x += 20) pts.push([x, 0]);
  return even(pts, 10);
}

// The drawings are evenly spaced, so the test track is too.
function even(pts: [number, number][], step: number): [number, number][] {
  const closed = [...pts, pts[0]!], cum = [0];
  for (let i = 1; i < closed.length; i++) cum.push(cum[i - 1]! + Math.hypot(closed[i]![0] - closed[i - 1]![0], closed[i]![1] - closed[i - 1]![1]));
  const out: [number, number][] = [];
  let j = 0;
  for (let d = 0; d < cum[cum.length - 1]!; d += step) {
    while (cum[j + 1]! < d) j++;
    const t = (d - cum[j]!) / (cum[j + 1]! - cum[j]!);
    out.push([closed[j]![0] + (closed[j + 1]![0] - closed[j]![0]) * t, closed[j]![1] + (closed[j + 1]![1] - closed[j]![1]) * t]);
  }
  out.push(out[0]!);
  return out;
}

describe("findTurns", () => {
  it("finds the four corners in driving order", () => {
    const t = findTurns(stadium());
    expect(t).toHaveLength(4);
    expect(t).toEqual([...t].sort((a, b) => a - b));
  });
});
