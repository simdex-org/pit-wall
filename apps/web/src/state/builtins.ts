// The built-in templates: read-only data. x, y, w, h are on 12 columns and every layout fills 20 rows.
import type { Template } from "./templates";

type Mod = [type: string, x: number, y: number, w: number, h: number, options?: Record<string, unknown>];
type Ws = [id: string, name: string, modules: Mod[]];

const SHARED: Record<string, Ws> = {
  live: ["w-live", "Live", [
    ["lap-timer", 0, 0, 3, 5],
    ["fuel", 0, 5, 3, 5],
    ["relative", 0, 10, 3, 6],
    ["battle", 0, 16, 3, 4],
    ["track-map", 3, 0, 5, 11],
    ["race-plan", 3, 11, 5, 9],
    ["standings", 8, 0, 4, 7, { around: 5, cols: ["gap", "int", "last", "pits"] }],
    ["rejoin", 8, 7, 4, 6],
    ["flags", 8, 13, 4, 7],
  ]],
  quali: ["w-quali", "Qualifying", [
    ["track-map", 0, 0, 6, 9],
    ["standings", 0, 9, 6, 11, { cols: ["gap", "best", "last", "sectors", "deltaMe"] }],
    ["lap-timer", 6, 0, 3, 5],
    ["relative", 6, 5, 3, 8],
    ["flags", 6, 13, 3, 7],
    ["sector-compare", 9, 0, 3, 6],
    ["tyres", 9, 6, 3, 10, { corrections: false }],
    ["rules", 9, 16, 3, 4],
  ]],
  timing: ["w-timing", "Timing", [
    ["standings", 0, 0, 9, 20, { cols: ["gap", "int", "last", "best", "sectors", "pits", "stint", "deltaMe"] }],
    ["battle", 9, 0, 3, 4],
    ["pit-activity", 9, 4, 3, 9],
    ["sector-compare", 9, 13, 3, 7],
  ]],
  strategy: ["w-strategy", "Strategy", [
    ["fuel-calc", 0, 0, 6, 20],
    ["race-plan", 6, 0, 3, 9],
    ["weather", 6, 9, 3, 7],
    ["rules", 6, 16, 3, 4],
    ["rejoin", 9, 0, 3, 6],
    ["degradation", 9, 6, 3, 7],
    ["flags", 9, 13, 3, 7],
  ]],
  pit: ["w-pit", "Pit", [
    ["pit-plan", 0, 0, 8, 13],
    ["stop-options", 0, 13, 8, 7],
    ["press-fix", 8, 0, 4, 6],
    ["stops", 8, 6, 4, 8],
    ["rejoin", 8, 14, 4, 6],
  ]],
  car: ["w-car", "Car", [
    ["tyres", 0, 0, 4, 9, { corrections: false }],
    ["tyre-history", 0, 9, 4, 11],
    ["brakes", 4, 0, 4, 6],
    ["electronics", 4, 6, 4, 4],
    ["damage", 4, 10, 4, 5],
    ["weather", 4, 15, 4, 5],
    ["car-3d", 8, 0, 4, 12],
    ["gg", 8, 12, 4, 8],
  ]],
  review: ["w-review", "Review", [
    ["lap-picker", 0, 0, 2, 20],
    ["laps", 2, 0, 5, 10],
    ["lap-map", 7, 0, 5, 10],
    ["coach", 2, 10, 4, 10],
    ["traces", 6, 10, 6, 10],
  ]],
  log: ["w-log", "Log", [
    ["event-log", 0, 0, 8, 20],
    ["notes", 8, 0, 4, 5],
    ["advice", 8, 5, 4, 5],
    ["debrief", 8, 10, 4, 6],
    ["pit-log", 8, 16, 4, 4],
  ]],
};

const SOURCE: [id: string, name: string, workspaces: string[]][] = [
  ["builtin-race", "Race engineer", ["live", "quali", "timing", "strategy", "pit", "car", "review", "log"]],
];

export const BUILTIN_TEMPLATES: Template[] = SOURCE.map(([id, name, workspaces]) => {
  let n = 0; // deterministic module ids, so a fork keeps them and nothing remounts
  return {
    format: "pitwall-template", schemaVersion: 1, id, name, created: "2026-10-29T00:00:00Z", updated: "2026-10-29T00:00:00Z",
    workspaces: workspaces.map((w) => {
      const [wid, wname, mods] = SHARED[w]!;
      return {
        id: wid, name: wname,
        modules: mods.map(([type, x, y, w2, h, options]) => ({
          id: "m-" + (++n).toString(36).padStart(6, "0"), type, x, y, w: w2, h, options: options ?? {}, hidden: false, header: true, title: "", linked: false,
        })),
      };
    }),
  };
});
