import { expect, test } from "vitest";
import { slopePerMin, WxSample } from "./wxlog";

const at = (min: number, track: number): WxSample => ({ t: min * 60_000, rain: 0, wet: null, clouds: null, track, air: 20, wind: null });

test("the slope is per minute and needs a stretch of readings", () => {
  expect(slopePerMin([at(0, 30), at(1, 31), at(2, 32)], (x) => x.track)).toBeCloseTo(1);
  expect(slopePerMin([at(0, 30), at(0.1, 31), at(0.2, 32)], (x) => x.track)).toBeNull();
});
