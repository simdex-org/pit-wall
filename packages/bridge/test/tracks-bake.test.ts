import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { bakeTrack } from "../src/tracks-bake.js";

const line = Array.from({ length: 900 }, (_, k) => [300 * Math.cos((k / 900) * 6.2832), 300 * Math.sin((k / 900) * 6.2832), k / 900]);

test("a clean lap adds the track, then only the sectors it lacks", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "pw-")), "tracks.json");
  writeFileSync(file, "{}");
  expect(await bakeTrack("Test Ring", { valid: false, line, sec: [0.3, 0.7] }, file)).toBe(false);
  expect(await bakeTrack("Test Ring", { valid: true, line, sec: [] }, file)).toBe(true);
  expect(JSON.parse(readFileSync(file, "utf-8"))["test ring"]).toMatchObject({ acc: true, sec: [] });
  expect(await bakeTrack("Test Ring", { valid: true, line, sec: [0.3, 0.7] }, file)).toBe(true);
  expect(await bakeTrack("Test Ring", { valid: true, line, sec: [0.4, 0.8] }, file)).toBe(false);
  expect(JSON.parse(readFileSync(file, "utf-8"))["test ring"].sec).toEqual([0.3, 0.7]);
});
