// The Pit Wall GT3: a simple body in five damage zones, four wheels with their suspension (s0..s3) and brakes (b0..b3).
// Frame: metres, x forward, y left, z up. Wheels in the order FL, FR, RL, RR.
import type * as THREE from "three";
import { assemble, CarModel, makeKit } from "./car3d";

const FRONT_X = 1.36, REAR_X = -1.32, TRACK = 0.8, R = 0.345;

export function buildCar2(T: typeof THREE): CarModel {
  const k = makeKit(T);
  // lower body, one block per damage zone
  k.box("shell", 1.2, 2.45, -0.95, 0.95, 0.2, 0.62, "front", "paint");
  k.box("shell", -2.35, -1.2, -0.95, 0.95, 0.2, 0.62, "rear", "paint");
  k.box("shell", -1.2, 1.2, 0.62, 0.95, 0.2, 0.62, "left", "paint");
  k.box("shell", -1.2, 1.2, -0.95, -0.62, 0.2, 0.62, "right", "paint");
  k.box("shell", -1.2, 1.2, -0.62, 0.62, 0.2, 0.62, "centre", "paint");
  k.plate("shell", [[1.2, 0.55], [2.45, 0.35], [2.55, 0.25], [2.45, 0.2], [1.2, 0.2]], -0.9, 1.8, "front", "paint");
  k.plate("shell", [[-0.7, 0.62], [-1.9, 0.7], [-2.35, 0.62], [-2.35, 0.2], [-0.7, 0.2]], -0.9, 1.8, "rear", "paint");
  k.box("shell", -1.1, 0.55, -0.72, 0.72, 0.62, 1.1, "centre", "paint");
  k.box("glass", 0.55, 0.9, -0.66, 0.66, 0.66, 1.06, "centre", "neutral");
  k.box("glass", -1.1, -0.9, -0.66, 0.66, 0.66, 1.06, "centre", "neutral");
  k.box("glass", -0.9, 0.55, -0.74, 0.74, 0.7, 1.04, "centre", "neutral");
  k.box("shell", -0.9, 0.55, -0.7, 0.7, 1.08, 1.14, "centre", "carbon");
  // splitter and rear wing
  k.box("frame", 2.2, 2.75, -0.95, 0.95, 0.12, 0.17, "front", "carbon");
  k.box("shell", -2.5, -2.15, -0.95, 0.95, 1.2, 1.26, "rear", "carbon");
  k.both((s) => k.box("frame", -2.5, -2.1, s * 0.93, s * 0.97, 0.9, 1.3, "rear", "carbon"));
  k.both((s) => k.box("frame", -2.4, -2.25, s * 0.3, s * 0.34, 0.6, 1.2, "rear", "carbon"));

  const wheels: [number, number, number][] = [[FRONT_X, 1, 0], [FRONT_X, -1, 1], [REAR_X, 1, 2], [REAR_X, -1, 3]];
  for (const [x, s, i] of wheels) {
    const y = s * TRACK, tyre = new T.CylinderGeometry(R, R, 0.3, 24), rim = new T.CylinderGeometry(R * 0.68, R * 0.68, 0.32, 16);
    k.geo("inner", tyre, k.M(x, y, R), "tyre", "tyre");
    k.geo("inner", rim, k.M(x, y, R), "rim", "rim");
    k.geo("inner", new T.CylinderGeometry(R * 0.55, R * 0.55, 0.04, 20), k.M(x, y - s * 0.1, R), `b${i}`, "paint");
    k.rod("inner", [x, y - s * 0.12, R], [x + 0.05, s * 0.45, R + 0.1], 0.025, `s${i}`, "paint");
    k.rod("inner", [x, y - s * 0.12, R + 0.12], [x - 0.12, s * 0.45, R + 0.2], 0.025, `s${i}`, "paint");
  }
  return assemble(T, k.layers, [FRONT_X, REAR_X]);
}
