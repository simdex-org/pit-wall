import { describe, expect, it } from "vitest";
import { appearance, BUILTIN_THEMES, LAYOUT, sanitizeTheme, type Theme } from "./appearance";

const pick = (t: Theme) => [t.font, t.numFont, t.fontScale, t.labelScale];

describe("theme text settings", () => {
  it("loads a theme saved before fonts and label size with today's look", () => {
    const old = { format: "pitwall-theme", schemaVersion: 1, name: "Mine", base: "pitwall", tokens: {}, density: "auto", fontScale: 1.25, radius: 4, panel: "flat", numFont: "mono", labels: "upper" };
    expect(pick(sanitizeTheme(old)!)).toEqual(["barlow", "mono", 1.25, 1]);
    expect(pick(sanitizeTheme({ ...old, numFont: "sans", fontScale: 0.7 })!)).toEqual(["barlow", "sans", 0.7, 1]);
  });

  it("keeps every old size step and reaches 160 %", () => {
    for (const v of [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25]) expect(LAYOUT.fontScale).toContain(v);
    expect([LAYOUT.fontScale.at(-1), LAYOUT.labelScale[0], LAYOUT.labelScale.at(-1)]).toEqual([1.6, 0.8, 1.6]);
  });

  it("carries the new fields through export and import", () => {
    const t: Theme = { ...BUILTIN_THEMES[0]!, id: "th-abcdef", font: "legible", numFont: "jetbrains", fontScale: 1.45, labelScale: 1.2 };
    expect(pick(sanitizeTheme(JSON.parse(JSON.stringify(appearance.pack(t))))!)).toEqual(["legible", "jetbrains", 1.45, 1.2]);
  });

  it("drops values it does not know", () => {
    const t = sanitizeTheme({ base: "telemetry", font: "Comic Sans", numFont: "x", fontScale: 1.23, labelScale: 9 })!;
    expect(pick(t)).toEqual(["barlow", "mono", 1, 1]);
  });
});
