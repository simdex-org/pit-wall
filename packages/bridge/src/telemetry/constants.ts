// ACC enums and display strings.
export const SESSIONS: Record<number, string> = { 0: "Practice", 1: "Qualifying", 2: "Race", 3: "Hotlap", 4: "Time attack", 7: "Hotstint", 8: "Superpole" };
export const STATUS = ["Off", "Replay", "Live", "Pause"];
export const CORNERS = ["FL", "FR", "RL", "RR"];
export const GFLAGS = ["yellow", "y1", "y2", "y3", "white", "green", "chequered", "red"];
export const FLAG_TEXT: Record<number, string> = { 1: "Blue flag", 2: "Yellow flag", 3: "Black flag", 4: "White flag", 5: "Chequered flag", 6: "Penalty flag", 7: "Green", 8: "Orange flag" };
export const RAIN = ["Dry", "Drizzle", "Light rain", "Medium rain", "Heavy rain", "Storm"];
export const PENALTIES: [string, string][] = [
  ["none", "none"], ["DT", "cutting"], ["SG10", "cutting"], ["SG20", "cutting"], ["SG30", "cutting"], ["DSQ", "cutting"],
  ["-BEST", "best lap removed, cutting"], ["DT", "pit speeding"], ["SG10", "pit speeding"], ["SG20", "pit speeding"],
  ["SG30", "pit speeding"], ["DSQ", "pit speeding"], ["-BEST", "pit speeding"], ["DSQ", "ignored mandatory pit"],
  ["TIME", "post-race time"], ["DSQ", "trolling"], ["DSQ", "pit entry"], ["DSQ", "pit exit"], ["DSQ", "wrong way"],
  ["DT", "ignored driver stint"], ["DSQ", "ignored driver stint"], ["DSQ", "exceeded driver stint limit"],
];
/** Served in the pit lane, within 3 laps. */
export const SERVABLE = new Set([1, 2, 3, 4, 7, 8, 9, 10, 19]);
/** Lap traces: as recorder.js resample(). */
export const NB = 400;
export const LCH = ["t", "speed", "thr", "brk", "steer", "gear", "rpm", "glat", "glon", "tc", "abs"] as const;

export function carClass(model: string): string {
  const m = (model || "").toLowerCase();
  return m.includes("gt4") ? "GT4" : m.includes("gt2") ? "GT2" : m.includes("cup") ? "GTC" : m.includes("m2_cs") ? "TCX" : "GT3";
}

/** A number with its sign, +0.123. */
export const signed = (x: number, d = 3): string => (x >= 0 ? "+" : "-") + Math.abs(x).toFixed(d);

/** A number that always shows a decimal: 26 -> "26.0". */
export const floatText = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export function fmtLap(ms: number | null): string {
  if (!ms || ms < 0) return "-";
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, "0")}`;
}
