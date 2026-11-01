import { describe, expect, it } from "vitest";
import { slopePerMin, WxSample } from "./wxlog";

const s = (min: number, track: number): WxSample => ({ t: min * 60000, rain: 0, wet: null, clouds: null, track, air: 20, wind: null });

describe("slopePerMin", () => {
  it("is the change per minute", () => expect(slopePerMin([s(0, 30), s(5, 35)], (x) => x.track)).toBeCloseTo(1));
  it("needs a minute of data", () => expect(slopePerMin([s(0, 30), s(0.5, 35)], (x) => x.track)).toBeNull());
  it("ignores samples older than the window", () => expect(slopePerMin([s(0, 0), s(20, 30), s(25, 35)], (x) => x.track)).toBeCloseTo(1));
});
