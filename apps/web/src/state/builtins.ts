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
  practice: ["w-practice", "Practice", [
    ["lap-timer", 0, 0, 4, 5],
    ["car-status", 0, 5, 4, 7],
    ["tyres", 0, 12, 4, 8],
    ["laps", 4, 0, 8, 8],
    ["degradation", 4, 8, 4, 8],
    ["rules", 4, 16, 4, 4],
    ["press-fix", 8, 8, 4, 6],
    ["brakes", 8, 14, 4, 6],
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
  laps: ["w-laps", "Laps", [
    ["laps", 0, 0, 7, 11],
    ["lap-map", 7, 0, 5, 11],
    ["coach", 0, 11, 4, 9],
    ["degradation", 4, 11, 4, 9],
    ["debrief", 8, 11, 4, 9],
  ]],
  analysis: ["w-analysis", "Analysis", [
    ["lap-picker", 0, 0, 2, 20],
    ["coach", 2, 0, 4, 20],
    ["lap-map", 6, 0, 6, 10],
    ["traces", 6, 10, 6, 10],
  ]],
  log: ["w-log", "Log", [
    ["event-log", 0, 0, 8, 20],
    ["notes", 8, 0, 4, 7],
    ["advice", 8, 7, 4, 7],
    ["pit-log", 8, 14, 4, 6],
  ]],
};

const SOURCE: [id: string, name: string, workspaces: (string | Ws)[]][] = [
  ["builtin-race", "Race engineer", ["live", "quali", "timing", "strategy", "pit", "car", "laps", "analysis", "log"]],
  ["builtin-weekend", "Race weekend", ["practice", "quali", ["w-race", "Race", SHARED.live![2]], "strategy", "pit", "laps", "analysis", "log"]],
  ["builtin-strategist", "Strategist", [["w-overview", "Overview", [
    ["standings", 0, 0, 6, 11, { cols: ["gap", "int", "last", "best", "pits", "stint", "net"] }],
    ["pit-activity", 0, 11, 6, 9],
    ["track-map", 6, 0, 6, 7],
    ["stop-options", 6, 7, 6, 6],
    ["relative", 6, 13, 3, 7],
    ["rejoin", 9, 13, 3, 7],
  ]], "quali", "timing", "strategy", "pit", "laps", "log"]],
  ["builtin-coach", "Driver coach", [["w-live", "Live", [
    ["track-map", 0, 0, 8, 12],
    ["channels", 0, 12, 5, 8],
    ["gg", 5, 12, 3, 8],
    ["lap-timer", 8, 0, 4, 5],
    ["car-status", 8, 5, 4, 7],
    ["tyres", 8, 12, 4, 8, { corrections: false }],
  ]], "quali", "laps", "analysis", "car", "log"]],
  ["builtin-minimal", "Minimal", [["w-wall", "Pit wall", [
    ["track-map", 0, 0, 8, 11],
    ["tyres", 0, 11, 4, 9, { corrections: false }],
    ["lap-timer", 4, 11, 4, 5],
    ["rules", 4, 16, 4, 4],
    ["relative", 8, 0, 4, 7],
    ["race-plan", 8, 7, 4, 8],
    ["fuel", 8, 15, 4, 5],
  ]], ["w-pit", "Pit", [
    ["pit-plan", 0, 0, 8, 13],
    ["stop-options", 0, 13, 8, 7],
    ["race-plan", 8, 0, 4, 9],
    ["press-fix", 8, 9, 4, 6],
    ["stops", 8, 15, 4, 5],
  ]]]],
];

export const BUILTIN_TEMPLATES: Template[] = SOURCE.map(([id, name, workspaces]) => {
  let n = 0; // deterministic module ids, so a fork keeps them and nothing remounts
  return {
    format: "pitwall-template", schemaVersion: 1, id, name, created: "2026-10-29T00:00:00Z", updated: "2026-10-29T00:00:00Z",
    workspaces: workspaces.map((w) => {
      const [wid, wname, mods] = typeof w === "string" ? SHARED[w]! : w;
      return {
        id: wid, name: wname,
        modules: mods.map(([type, x, y, w2, h, options]) => ({
          id: "m-" + (++n).toString(36).padStart(6, "0"), type, x, y, w: w2, h, options: options ?? {}, hidden: false, header: true, title: "", linked: false,
        })),
      };
    }),
  };
});
