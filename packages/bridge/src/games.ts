import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AC_APP_DIR } from "./paths.js";

// Looks, read only, for the games in Steam's libraries and for their running programs. Nothing here takes a path
// from outside: the only folder ever written to is <Assetto Corsa>/apps/lua/PitWall, found by this module itself.
export interface GameState { installed: boolean; running: boolean; app?: "none" | "old" | "current"; csp?: boolean }
export interface Games { acc: GameState; ac: GameState; lmu: GameState }

const ACC_EXE = ["steamapps", "common", "Assetto Corsa Competizione", "AC2", "Binaries", "Win64", "AC2-Win64-Shipping.exe"];
const AC_DIR = ["steamapps", "common", "assettocorsa"];
const LMU_EXE = ["steamapps", "common", "Le Mans Ultimate", "Le Mans Ultimate.exe"];
const PROGRAMS = { acc: "ac2-win64-shipping.exe", ac: "acs.exe", lmu: "le mans ultimate.exe" } as const;

function steamLibraries(): string[] {
  const out = new Set<string>();
  const run = (cmd: string, args: string[]): string => {
    try { return execFileSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 5000 }); } catch { return ""; }
  };
  const reg = /SteamPath\s+REG_SZ\s+(.+)/.exec(run("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"]));
  const roots = [reg?.[1]?.trim(), "C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"].filter((p): p is string => !!p);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    out.add(root);
    try {
      for (const m of readFileSync(join(root, "steamapps", "libraryfolders.vdf"), "utf8").matchAll(/"path"\s+"([^"]+)"/g)) out.add(m[1]!.replace(/\\\\/g, "\\"));
    } catch { /* no extra libraries */ }
  }
  return [...out];
}

function running(): Set<string> {
  try {
    const text = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    return new Set(text.split("\n").map((l) => /^"([^"]+)"/.exec(l)?.[1]?.toLowerCase()).filter((n): n is string => !!n));
  } catch { return new Set(); }
}

const acFolder = (libs: string[]): string | null => libs.map((l) => join(l, ...AC_DIR)).find((d) => existsSync(join(d, "acs.exe"))) ?? null;

const sameFiles = (a: string, b: string): boolean => {
  const names = readdirSync(a).filter((n) => /^[\w.-]+$/.test(n));
  return names.length > 0 && names.every((n) => existsSync(join(b, n)) && readFileSync(join(a, n)).equals(readFileSync(join(b, n))));
};

export function detect(libs = steamLibraries(), now = running(), source = AC_APP_DIR): Games {
  const ac = acFolder(libs);
  const app = ac ? join(ac, "apps", "lua", "PitWall") : null;
  return {
    acc: { installed: libs.some((l) => existsSync(join(l, ...ACC_EXE))), running: now.has(PROGRAMS.acc) },
    ac: {
      installed: !!ac, running: now.has(PROGRAMS.ac), csp: !!ac && existsSync(join(ac, "extension")),
      app: !app || !existsSync(app) ? "none" : existsSync(source) && sameFiles(source, app) ? "current" : "old",
    },
    lmu: { installed: libs.some((l) => existsSync(join(l, ...LMU_EXE))), running: now.has(PROGRAMS.lmu) },
  };
}

export function installAcApp(libs = steamLibraries(), source = AC_APP_DIR): string {
  const ac = acFolder(libs);
  if (!ac) throw new Error("Assetto Corsa was not found in Steam's libraries");
  const names = existsSync(source) ? readdirSync(source).filter((n) => /^[\w.-]+$/.test(n) && lstatSync(join(source, n)).isFile()) : [];
  if (!names.includes("PitWall.lua") || !names.includes("manifest.ini")) throw new Error("the Pit Wall app files are missing from this install");
  const dest = join(ac, "apps", "lua", "PitWall");
  // a link in the way could send the copy somewhere else
  for (const d of [join(ac, "apps"), join(ac, "apps", "lua"), dest]) {
    if (existsSync(d) && lstatSync(d).isSymbolicLink()) throw new Error(`${d} is a link, not a folder`);
  }
  mkdirSync(dest, { recursive: true });
  for (const n of names) copyFileSync(join(source, n), join(dest, n));
  return dest;
}
