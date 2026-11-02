import { test } from "node:test";
import assert from "node:assert/strict";
import { drawingFrom, lineFromFastLane } from "../scripts/layout.mjs";

// A fastlane.ai: header, then n records of nine doubles (x, y, z, distance, ...) 10 m apart, then garbage like the real file's second half.
function fastLane(r = 300, junk = 40) {
  const n = Math.round((2 * Math.PI * r) / 10), buf = Buffer.alloc(16 + (n + junk) * 72);
  buf.writeInt32LE(8, 0); buf.writeInt32LE(n + junk, 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI, o = 16 + i * 72;
    buf.writeDoubleLE(r * Math.cos(a), o); buf.writeDoubleLE(0, o + 8); buf.writeDoubleLE(r * Math.sin(a), o + 16); buf.writeDoubleLE(i * 10, o + 24);
  }
  for (let i = 0; i < junk; i++) buf.writeDoubleLE(Number.NaN, 16 + (n + i) * 72);
  return buf;
}

test("reads the line and stops where the file stops being a line", () => {
  const pts = lineFromFastLane(fastLane());
  assert.equal(pts.length, 188);
  assert.deepEqual(pts[0], [300, 0]);
});

test("refuses a file that is not a whole lap or not version 8", () => {
  assert.equal(lineFromFastLane(Buffer.alloc(100)), null);
  const half = fastLane(); half.writeInt32LE(60, 4);
  assert.equal(lineFromFastLane(half), null);
});

test("the drawing is smooth, starts on the line and carries sectors", () => {
  const d = drawingFrom(fastLane(), { sec: [0.3, 0.7] });
  assert.deepEqual(d.loop[0], [300, 0]);
  assert.ok(d.loop.length > 300);
  const gaps = d.loop.map((p, i) => Math.hypot(d.loop[(i + 1) % d.loop.length][0] - p[0], d.loop[(i + 1) % d.loop.length][1] - p[1]));
  assert.ok(Math.max(...gaps) < 6);
  assert.deepEqual(d.sec, [0.3, 0.7]);
  assert.equal(d.acc, true);
});
