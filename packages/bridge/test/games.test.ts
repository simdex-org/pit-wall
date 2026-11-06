import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { detect, installAcApp } from "../src/games.js";

function steam() {
  const lib = mkdtempSync(join(tmpdir(), "pw-steam-")), src = mkdtempSync(join(tmpdir(), "pw-app-"));
  writeFileSync(join(src, "PitWall.lua"), "lua v2");
  writeFileSync(join(src, "manifest.ini"), "[ABOUT]");
  return { lib, src, ac: join(lib, "steamapps", "common", "assettocorsa") };
}

describe("game detection", () => {
  test("finds nothing in an empty library", () => {
    const { lib, src } = steam();
    expect(detect([lib], new Set(), src)).toEqual({ acc: { installed: false, running: false }, ac: { installed: false, running: false, csp: false, app: "none" } });
  });

  test("finds both games and which one is running", () => {
    const { lib, src, ac } = steam();
    mkdirSync(ac, { recursive: true });
    writeFileSync(join(ac, "acs.exe"), "");
    const exe = join(lib, "steamapps", "common", "Assetto Corsa Competizione", "AC2", "Binaries", "Win64");
    mkdirSync(exe, { recursive: true });
    writeFileSync(join(exe, "AC2-Win64-Shipping.exe"), "");
    expect(detect([lib], new Set(["ac2-win64-shipping.exe"]), src)).toMatchObject({ acc: { installed: true, running: true }, ac: { installed: true, running: false, app: "none", csp: false } });
  });

  test("installs the app, then sees it as current, then as old", () => {
    const { lib, src, ac } = steam();
    mkdirSync(ac, { recursive: true });
    writeFileSync(join(ac, "acs.exe"), "");
    const dest = installAcApp([lib], src);
    expect(dest).toBe(join(ac, "apps", "lua", "PitWall"));
    expect(readFileSync(join(dest, "PitWall.lua"), "utf8")).toBe("lua v2");
    expect(detect([lib], new Set(), src).ac.app).toBe("current");
    writeFileSync(join(src, "PitWall.lua"), "lua v3");
    expect(detect([lib], new Set(), src).ac.app).toBe("old");
  });

  test("refuses without the game, without the files and through a link", () => {
    const { lib, src, ac } = steam();
    expect(() => installAcApp([lib], src)).toThrow(/not found/);
    mkdirSync(ac, { recursive: true });
    writeFileSync(join(ac, "acs.exe"), "");
    expect(() => installAcApp([lib], join(lib, "nothing"))).toThrow(/missing/);
    mkdirSync(join(ac, "apps"));
    try { symlinkSync(mkdtempSync(join(tmpdir(), "pw-else-")), join(ac, "apps", "lua"), "junction"); } catch { return; }
    expect(() => installAcApp([lib], src)).toThrow(/link/);
  });
});
