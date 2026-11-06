import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex } from "./color";

describe("color", () => {
  it("round-trips hex through hsv", () => {
    for (const h of ["#000000", "#ffffff", "#30c030", "#0b0c0b", "#ff0000", "#1e90ff"]) expect(hsvToHex(hexToHsv(h))).toBe(h);
  });
  it("reads the hue", () => {
    expect(hexToHsv("#00ff00")[0]).toBe(120);
    expect(hexToHsv("#0000ff")[0]).toBe(240);
  });
});
