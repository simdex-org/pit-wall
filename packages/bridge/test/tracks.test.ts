import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "pw-tracks-"));
process.env.PITWALL_TRACKS = dir;
const { loadLayout, saveLayout } = await import("../src/tracks.js");

const lap = (ms: number, valid = true) => ({ valid, ms, sec: [0.3, 0.7], line: [[0, 0, 0], [1, 1, 1]] });

test("a slower lap is ignored and a faster one replaces it", () => {
  saveLayout("T1", lap(100000));
  saveLayout("T1", lap(105000));
  expect(loadLayout("T1")!.ms).toBe(100000);
  saveLayout("T1", lap(99000));
  expect(loadLayout("T1")!.ms).toBe(99000);
});

test("sectors alone are saved, and any lap beats them", () => {
  saveLayout("T2", { sec: [0.3, 0.7] });
  expect(loadLayout("T2")!.sec).toEqual([0.3, 0.7]);
  saveLayout("T2", lap(120000, false));
  expect(loadLayout("T2")!.ms).toBe(120000);
});

test("sectors alone do not replace a lap's own", () => {
  saveLayout("T3", lap(100000));
  saveLayout("T3", { sec: [0.1, 0.2] });
  expect(loadLayout("T3")!.sec).toEqual([0.3, 0.7]);
});
