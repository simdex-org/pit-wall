import type { Template } from "./templates";

type Mod = [type: string, x: number, y: number, w: number, h: number, options?: Record<string, unknown>];
type Ws = [id: string, name: string, modules: Mod[]];

const SHARED: Record<string, Ws> = {
  race: ["w-race", "Race", [
    ["lap-timer", 0, 0, 3, 4],
    ["fuel", 0, 4, 3, 5],
    ["flags", 0, 9, 3, 7],
    ["rules", 0, 16, 3, 4],
    ["track-map", 3, 0, 5, 11],
    ["race-plan", 3, 11, 5, 9],
    ["standings", 8, 0, 4, 10, { around: 5, cols: ["gap", "int", "last", "pits"] }],
    ["relative", 8, 10, 4, 10],
  ]],
  timing: ["w-timing", "Timing", [
    ["standings", 0, 0, 9, 20, { cols: ["gap", "int", "last", "best", "sectors", "pits", "stint", "deltaMe"] }],
    ["battle", 9, 0, 3, 4],
    ["sector-compare", 9, 4, 3, 7],
    ["pit-activity", 9, 11, 3, 9],
  ]],
  pit: ["w-pit", "Pit", [
    ["pit-plan", 0, 0, 6, 13],
    ["stop-options", 0, 13, 6, 7],
    ["race-plan", 6, 0, 3, 8],
    ["rejoin", 9, 0, 3, 8],
    ["press-fix", 6, 8, 3, 6],
    ["stint-drivers", 9, 8, 3, 6],
    ["stops", 6, 14, 6, 6],
  ]],
  strategy: ["w-strategy", "Strategy", [
    ["fuel-calc", 0, 0, 6, 20],
    ["degradation", 6, 0, 6, 6],
    ["stint-drivers", 6, 6, 3, 14],
    ["rules", 9, 6, 3, 5],
    ["race-plan", 9, 11, 3, 9],
  ]],
  weather: ["w-weather", "Weather", [
    ["weather-center", 0, 0, 8, 20],
    ["weather", 8, 0, 4, 6],
    ["session", 8, 6, 4, 7],
    ["flags", 8, 13, 4, 7],
  ]],
  drive: ["w-drive", "Drive", [
    ["kpi", 0, 0, 12, 5, { metrics: ["pos", "ahead", "behind", "delta", "last", "best"] }],
    ["lap-timer", 0, 5, 4, 5],
    ["fuel", 0, 10, 4, 6],
    ["rules", 0, 16, 4, 4],
    ["relative", 4, 5, 4, 8],
    ["flags", 4, 13, 4, 7],
    ["car-status", 8, 5, 4, 8],
    ["weather", 8, 13, 4, 7],
  ]],
  dpit: ["w-dpit", "Pit", [
    ["pit-plan", 0, 0, 7, 13],
    ["kpi", 7, 0, 5, 5, { metrics: ["boxIn", "fuelL"] }],
    ["race-plan", 7, 5, 5, 8],
    ["stop-options", 0, 13, 7, 7],
    ["rejoin", 7, 13, 5, 7],
  ]],
  dmap: ["w-dmap", "Map", [
    ["track-map", 0, 0, 8, 20],
    ["relative", 8, 0, 4, 9],
    ["flags", 8, 9, 4, 7],
    ["rules", 8, 16, 4, 4],
  ]],
  dcar: ["w-dcar", "Car", [
    ["tyres", 0, 0, 4, 10, { corrections: false }],
    ["brakes", 0, 10, 4, 6],
    ["electronics", 0, 16, 4, 4],
    ["car-status", 4, 0, 4, 8],
    ["damage", 4, 8, 4, 6],
    ["gg", 4, 14, 4, 6],
    ["channels", 8, 0, 4, 8],
    ["car-3d", 8, 8, 4, 12],
  ]],
  dlaps: ["w-dlaps", "Laps", [
    ["laps", 0, 0, 8, 10],
    ["lap-map", 8, 0, 4, 10],
    ["coach", 0, 10, 4, 10],
    ["traces", 4, 10, 8, 10],
  ]],
  car: ["w-car", "Car", [
    ["tyres", 0, 0, 4, 9, { corrections: false }],
    ["tyre-history", 0, 9, 4, 11],
    ["brakes", 4, 0, 4, 6],
    ["electronics", 4, 6, 4, 4],
    ["damage", 4, 10, 4, 6],
    ["car-status", 4, 16, 4, 4],
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
  analysis: ["w-analysis", "Analysis", [
    ["traces", 0, 0, 7, 20, { lanes: ["delta", "speed", "pedals", "steer", "gear", "rpm"] }],
    ["lap-map", 7, 0, 5, 8],
    ["laps", 7, 8, 5, 12],
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
  ["builtin-race", "Race engineer", ["race", "timing", "pit", "strategy", "weather", "car", "review", "analysis", "log"]],
  ["builtin-driver", "Driver", ["drive", "dpit", "dmap", "dcar", "dlaps", "analysis"]],
];

export const BUILTIN_TEMPLATES: Template[] = SOURCE.map(([id, name, workspaces]) => {
  let n = 0;
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
