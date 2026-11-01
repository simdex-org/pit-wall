import { describe, expect, test } from "vitest";
import { isNewer, parseRelease, pick } from "../src/update.js";

const asset = (name: string) => ({ name, size: 1, browser_download_url: `https://x/${name}` });

describe("update", () => {
  test("only a higher version counts, and never when running from source", () => {
    expect(isNewer("1.0.2", "1.0.3")).toBe(true);
    expect(isNewer("1.0.9", "1.1.0")).toBe(true);
    expect(isNewer("1.0.10", "1.0.9")).toBe(false);
    expect(isNewer("1.0.2", "1.0.2")).toBe(false);
    expect(isNewer(null, "2.0.0")).toBe(false);
  });

  test("a release needs a tag and assets", () => {
    expect(parseRelease({ tag_name: "v1.0.3", assets: [asset("PitWall.exe"), { name: 1 }] })).toEqual({ version: "1.0.3", assets: [asset("PitWall.exe")] });
    expect(parseRelease({ assets: [] })).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });

  test("the installer or the portable exe is picked by what is running", () => {
    const assets = [asset("Pit.Wall_1.0.3_x64-setup.exe"), asset("PitWall.exe")];
    expect(pick(assets, false)?.name).toBe("Pit.Wall_1.0.3_x64-setup.exe");
    expect(pick(assets, true)?.name).toBe("PitWall.exe");
    expect(pick([asset("PitWall-portable.exe")], true)?.name).toBe("PitWall-portable.exe");
    expect(pick([asset("PitWall.exe")], false)).toBeUndefined();
  });
});
