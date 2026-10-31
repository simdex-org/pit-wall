// The built-in templates: read-only data. x, y, w, h are on 12 columns and every layout fits 22 rows.
import type { Template } from "./templates";

type Mod = [type: string, x: number, y: number, w: number, h: number, options?: Record<string, unknown>];
type Ws = [id: string, name: string, modules: Mod[]];

const SHARED: Record<string, Ws> = {
  live: ["w-live", "Live", [["track-map", 0, 0, 5, 11], ["standings", 5, 0, 4, 22, { around: 5, cols: ["gap", "int", "last", "pits"] }], ["relative", 9, 0, 3, 8], ["race-plan", 9, 8, 3, 14], ["tyres", 0, 11, 5, 11]]],
  timing: ["w-timing", "Timing", [["standings", 0, 0, 8, 22, { cols: ["gap", "int", "last", "best", "sectors", "pits", "stint", "deltaMe"] }], ["battle", 8, 0, 4, 6], ["pit-activity", 8, 6, 4, 8], ["sector-compare", 8, 14, 4, 8]]],
  strategy: ["w-strategy", "Strategy", [["fuel-calc", 0, 0, 6, 22], ["pit-plan", 6, 0, 6, 12], ["stop-options", 6, 12, 6, 8], ["race-plan", 0, 22, 4, 11], ["rejoin", 4, 22, 3, 7], ["rules", 7, 22, 3, 4]]],
  car: ["w-car", "Car", [["tyres", 0, 0, 4, 11, { corrections: false }], ["brakes", 4, 0, 4, 6], ["press-fix", 4, 6, 4, 5], ["electronics", 8, 0, 4, 5], ["damage", 8, 5, 4, 6], ["tyre-history", 0, 11, 8, 11], ["weather", 8, 11, 4, 7], ["flags", 8, 18, 4, 4]]],
  laps: ["w-laps", "Laps", [["laps", 0, 0, 8, 15], ["degradation", 0, 15, 8, 7], ["stops", 8, 0, 4, 7], ["debrief", 8, 7, 4, 15]]],
  analysis: ["w-analysis", "Analysis", [["lap-picker", 0, 0, 3, 22], ["traces", 3, 0, 6, 22], ["track-map", 9, 0, 3, 12, { field: false, follow: false }], ["segments", 9, 12, 3, 10]]],
  damage: ["w-damage", "Damage", [["car-3d", 0, 0, 8, 22], ["damage", 8, 0, 4, 8], ["brakes", 8, 8, 4, 7], ["tyres", 8, 15, 4, 7, { corrections: false }]]],
  log: ["w-log", "Log", [["event-log", 0, 0, 8, 22], ["notes", 8, 0, 4, 14], ["pit-log", 8, 14, 4, 8]]],
};

const SOURCE: [id: string, name: string, workspaces: (string | Ws)[]][] = [
  ["builtin-race", "Race engineer", ["live", "timing", "strategy", "car", "damage", "laps", "analysis", "log"]],
  ["builtin-strategist", "Strategist", [
    ["w-overview", "Overview", [["standings", 0, 0, 6, 14, { cols: ["gap", "int", "last", "best", "pits", "stint", "net"] }], ["pit-activity", 0, 14, 6, 8], ["track-map", 6, 0, 6, 9], ["stop-options", 6, 9, 6, 6], ["battle", 6, 15, 3, 7], ["rejoin", 9, 15, 3, 7]]],
    "timing", "strategy", "laps", "log"]],
  ["builtin-coach", "Driver coach", [
    ["w-live", "Live", [["track-map", 0, 0, 7, 14], ["channels", 0, 14, 4, 8], ["lap-timer", 7, 0, 5, 4], ["car-status", 7, 4, 5, 7], ["tyres", 7, 11, 5, 11, { corrections: false }], ["gg", 4, 14, 3, 8]]],
    "laps", "analysis", "car", "log"]],
  ["builtin-minimal", "Minimal", [
    ["w-wall", "Pit wall", [["track-map", 0, 0, 8, 14], ["relative", 8, 0, 4, 8], ["race-plan", 8, 8, 4, 14], ["tyres", 0, 14, 8, 8, { corrections: false }]]],
    ["w-pit", "Pit", [["pit-plan", 0, 0, 8, 22], ["race-plan", 8, 0, 4, 11], ["press-fix", 8, 11, 4, 6]]]]],
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
