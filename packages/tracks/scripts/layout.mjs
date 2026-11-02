const RECORD_BYTES = 72, HEADER_BYTES = 16, STEP_M = 5;

/**
 * The racing line in ACC's own AC2/Content/Cache/<track>/fastlane.ai: a 16 byte header (version 8, record count) and records of nine
 * doubles (x, y, z, distance, ...) 10 m apart, starting on the start/finish line. The first half of the records is the line, the second
 * half is other data, so reading stops at the first jump or the first value that is not a number. Null when it is not a whole lap.
 */
export function lineFromFastLane(buf) {
  if (buf.length < HEADER_BYTES || buf.readInt32LE(0) !== 8) return null;
  const n = buf.readInt32LE(4), pts = [];
  for (let i = 0; i < n && HEADER_BYTES + (i + 1) * RECORD_BYTES <= buf.length; i++) {
    const o = HEADER_BYTES + i * RECORD_BYTES, x = buf.readDoubleLE(o), z = buf.readDoubleLE(o + 16), last = pts[pts.length - 1];
    if (!Number.isFinite(x) || !Number.isFinite(z) || (last && Math.hypot(x - last[0], z - last[1]) > 60)) break;
    pts.push([x, z]);
  }
  return pts.length > 100 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 30 ? pts : null;
}

/** A closed Catmull-Rom curve through the 10 m points, a point about every 5 m, starting on the first one. */
function smooth(pts) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const steps = Math.max(1, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / STEP_M));
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t, c = (a, b, d, e) => 0.5 * (2 * b + (-a + d) * t + (2 * a - 5 * b + 4 * d - e) * t2 + (-a + 3 * b - 3 * d + e) * t3);
      out.push([+c(p0[0], p1[0], p2[0], p3[0]).toFixed(1), +c(p0[1], p1[1], p2[1], p3[1]).toFixed(1)]);
    }
  }
  return out;
}

/**
 * A track drawing from the game's own line, plus the sector lines a driven lap knows
 * (lay = the bridge's saved layout for the track, or null).
 */
export function drawingFrom(fastLane, lay) {
  const pts = lineFromFastLane(fastLane);
  if (!pts) return null;
  const loop = smooth(pts), xs = loop.map((p) => p[0]), zs = loop.map((p) => p[1]);
  return {
    box: [+(Math.max(...xs) - Math.min(...xs)).toFixed(1), +(Math.max(...zs) - Math.min(...zs)).toFixed(1)], loop,
    pit: [], labels: [], sec: Array.isArray(lay?.sec) ? lay.sec : [], acc: true,
  };
}
