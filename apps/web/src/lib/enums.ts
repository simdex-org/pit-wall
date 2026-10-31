// The bridge sends these as indexes.
export const FLAGS = ["none", "blue", "yellow", "black", "white", "chequered", "penalty", "green", "orange"] as const;

export const PENALTIES: [code: string, why: string][] = [
  ["none", "none"], ["DT", "cutting"], ["SG10", "cutting"], ["SG20", "cutting"], ["SG30", "cutting"], ["DSQ", "cutting"],
  ["−BEST", "best lap removed, cutting"], ["DT", "pit speeding"], ["SG10", "pit speeding"], ["SG20", "pit speeding"], ["SG30", "pit speeding"],
  ["DSQ", "pit speeding"], ["−BEST", "pit speeding"], ["DSQ", "ignored mandatory pit"], ["TIME", "post-race time"], ["DSQ", "trolling"],
  ["DSQ", "pit entry"], ["DSQ", "pit exit"], ["DSQ", "wrong way"], ["DT", "ignored driver stint"], ["DSQ", "ignored driver stint"],
  ["DSQ", "exceeded driver stint limit"],
];
/** Penalties served in the pit lane. */
export const SERVABLE = [1, 2, 3, 4, 7, 8, 9, 10, 19];

export const GRIP = ["Green", "Fast", "Optimum", "Greasy", "Damp", "Wet", "Flooded"];
export const RAIN = ["Dry", "Drizzle", "Light rain", "Medium rain", "Heavy rain", "Storm"];
export const PHASES = ["none", "starting", "pre-formation", "formation", "pre-session", "green", "over", "post", "results"];
export const IN_LANE = ["pit", "entry", "exit"];
