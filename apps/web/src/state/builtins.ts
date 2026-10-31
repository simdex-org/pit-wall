// The built-in templates: read-only data. x, y, w, h are on 12 columns and every layout fits 22 rows.
import type { Template } from "./templates";

type Mod = [type: string, x: number, y: number, w: number, h: number, options?: Record<string, unknown>];
type Ws = [id: string, name: string, modules: Mod[]];

const SHARED: Record<string, Ws> = {
  // The wall: you at the left, the race in the middle, the field at the right.
  live: ["w-live", "Live", [
    ["lap-timer", 0, 0, 3, 4], ["fuel", 0, 4, 3, 5], ["relative", 0, 9, 3, 5], ["weather", 0, 14, 3, 8],
    ["track-map", 3, 0, 5, 8], ["race-plan", 3, 8, 5, 8], ["stop-options", 3, 16, 5, 6],
    ["standings", 8, 0, 4, 7, { around: 5, cols: ["gap", "int", "last", "pits"] }], ["battle", 8, 7, 4, 5], ["rejoin", 8, 12, 4, 6], ["flags", 8, 18, 4, 4],
  ]],
  // Practice: the car and the run. Tyres and pressures, fuel use, pace and wear, no field.
  practice: ["w-practice", "Practice", [
    ["lap-timer", 0, 0, 4, 4], ["fuel", 0, 4, 4, 5], ["tyres", 0, 9, 4, 13],
    ["laps", 4, 0, 8, 9], ["degradation", 4, 9, 4, 13], ["press-fix", 8, 9, 4, 7], ["brakes", 8, 16, 4, 6],
  ]],
  // Qualifying: one lap at a time. Sectors against the best, the others' times, traffic and flags around you.
  quali: ["w-quali", "Qualifying", [
    ["track-map", 0, 0, 6, 11], ["lap-timer", 6, 0, 6, 4], ["sector-compare", 6, 4, 6, 6],
    ["standings", 0, 11, 6, 11, { cols: ["gap", "best", "last", "sectors", "deltaMe"] }],
    ["relative", 6, 10, 3, 6], ["flags", 9, 10, 3, 6], ["tyres", 6, 16, 6, 6, { corrections: false }],
  ]],
  timing: ["w-timing", "Timing", [["standings", 0, 0, 8, 22, { cols: ["gap", "int", "last", "best", "sectors", "pits", "stint", "deltaMe"] }], ["battle", 8, 0, 4, 6], ["pit-activity", 8, 6, 4, 8], ["sector-compare", 8, 14, 4, 8]]],
  // Planning: the calculator beside what it feeds (the plan against the fuel, the rejoin, the stop options), pace under it.
  strategy: ["w-strategy", "Strategy", [
    ["fuel-calc", 0, 0, 6, 22], ["race-plan", 6, 0, 3, 11], ["rejoin", 9, 0, 3, 11],
    ["degradation", 6, 11, 6, 7], ["rules", 6, 18, 3, 4], ["flags", 9, 18, 3, 4],
  ]],
  // The pit box: what to type in, what the stop costs and where it puts you, and the pressures to set.
  pit: ["w-pit", "Pit", [
    ["pit-plan", 0, 0, 8, 14], ["stop-options", 0, 14, 8, 8],
    ["press-fix", 8, 0, 4, 7], ["stops", 8, 7, 4, 8], ["rejoin", 8, 15, 4, 7],
  ]],
  // The car's state, corner by corner: tyres and brakes, the electronics, the damage on the 3D car, the weather around it.
  car: ["w-car", "Car", [
    ["tyres", 0, 0, 4, 11, { corrections: false }], ["tyre-history", 0, 11, 4, 11],
    ["brakes", 4, 0, 4, 6], ["electronics", 4, 6, 4, 5], ["damage", 4, 11, 4, 6], ["weather", 4, 17, 4, 5],
    ["car-3d", 8, 0, 4, 14], ["gg", 8, 14, 4, 8],
  ]],
  laps: ["w-laps", "Laps", [["laps", 0, 0, 7, 12], ["lap-map", 7, 0, 5, 12], ["coach", 0, 12, 4, 10], ["degradation", 4, 12, 4, 10], ["debrief", 8, 12, 4, 10]]],
  analysis: ["w-analysis", "Analysis", [["lap-picker", 0, 0, 4, 8], ["coach", 0, 8, 4, 14], ["lap-map", 4, 0, 8, 12], ["traces", 4, 12, 8, 10]]],
  log: ["w-log", "Log", [["event-log", 0, 0, 8, 22], ["notes", 8, 0, 4, 10], ["advice", 8, 10, 4, 6], ["pit-log", 8, 16, 4, 6]]],
};

const SOURCE: [id: string, name: string, workspaces: (string | Ws)[]][] = [
  ["builtin-race", "Race engineer", ["live", "quali", "timing", "strategy", "pit", "car", "laps", "analysis", "log"]],
  ["builtin-weekend", "Race weekend", [
    "practice", "quali", ["w-race", "Race", SHARED.live![2]], "strategy", "pit", "laps", "analysis", "log"]],
  ["builtin-strategist", "Strategist", [
    ["w-overview", "Overview", [["standings", 0, 0, 6, 14, { cols: ["gap", "int", "last", "best", "pits", "stint", "net"] }], ["pit-activity", 0, 14, 6, 8], ["track-map", 6, 0, 6, 9], ["stop-options", 6, 9, 6, 6], ["battle", 6, 15, 3, 7], ["rejoin", 9, 15, 3, 7]]],
    "quali", "timing", "strategy", "pit", "laps", "log"]],
  ["builtin-coach", "Driver coach", [
    ["w-live", "Live", [["track-map", 0, 0, 7, 14], ["channels", 0, 14, 4, 8], ["lap-timer", 7, 0, 5, 4], ["car-status", 7, 4, 5, 7], ["tyres", 7, 11, 5, 11, { corrections: false }], ["gg", 4, 14, 3, 8]]],
    "quali", "laps", "analysis", "car", "log"]],
  ["builtin-minimal", "Minimal", [
    ["w-wall", "Pit wall", [["track-map", 0, 0, 8, 14], ["relative", 8, 0, 4, 8], ["race-plan", 8, 8, 4, 14], ["tyres", 0, 14, 8, 8, { corrections: false }]]],
    ["w-pit", "Pit", [["pit-plan", 0, 0, 8, 22], ["race-plan", 8, 0, 4, 11], ["press-fix", 8, 11, 4, 6], ["stops", 8, 17, 4, 5]]]]],
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
