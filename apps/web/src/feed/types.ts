// The shapes the bridge sends. Fields the page does not read are left out; unknown ones pass through untouched.
export interface Car {
  i: number;
  pos: number;
  cpos: number;
  laps: number;
  spl: number;
  kmh: number;
  gear: number;
  loc: "none" | "track" | "pit" | "entry" | "exit";
  cur: number | null;
  delta: number;
  gap: number | null;
  gap_laps: number;
  int: number | null;
  int_laps: number;
  rel: number | null;
  net: number | null;
  drv: number;
  xz: [number, number] | null;
  // merged from the entry list and the slow fields
  num?: number;
  team?: string;
  cup?: number;
  cup_name?: string;
  model_name?: string;
  class?: string;
  drivers?: { first: string; last: string; short: string; dcat: number }[];
  last?: number | null;
  last_s?: (number | null)[];
  last_valid?: boolean | null;
  best?: number | null;
  best_s?: (number | null)[];
  pits?: number;
  last_pit_lap?: number | null;
  lane_ms?: number | null;
  stint_laps?: number;
  out?: boolean;
  in?: boolean;
  int_hist?: (number | null)[];
  gap_hist?: (number | null)[];
}

export interface Field {
  t: number;
  type: number | null;
  phase: number | null;
  idx: number | null;
  mode: "race" | "best";
  me: number | null;
  best: { ms: number; car: number } | null;
  weather: Record<string, number> | null;
  track_m: number | null;
  xz_ok: boolean;
  cars: Car[];
  slow?: Record<string, Partial<Car>>;
}

export interface Advice { id: string; severity: number; text: string }
export interface LogLine { seq: number; t: number; lap: number; sev: number; cat: string; text: string; src?: string }
export interface BroadcastState { state: string; msg: string; port: number }

/** The reading is large and its sections are only used by name, so it stays loosely typed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export interface Payload {
  reading?: Json | null;
  summary?: Json | null;
  laps?: Json[] | null;
  field?: Field | null;
  entries?: { track: Json | null; cars: Record<string, Json> } | null;
  log?: LogLine[] | null;
  pit_log?: Json[] | null;
  config?: Json | null;
  reading_age_ms?: number | null;
  summary_age_ms?: number | null;
  field_age_ms?: number | null;
  bc?: BroadcastState;
  pit?: Json | null;
  pit_job?: Json | null;
}
