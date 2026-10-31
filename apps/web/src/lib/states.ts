// Each function returns 'cold' | 'ok' | 'warn' | 'bad' | 'none'; every module colours by these.
export type State = "cold" | "ok" | "warn" | "bad" | "none";

export interface Thresholds {
  dry_psi: [number, number];
  wet_psi: [number, number];
  tyre_c: [number, number];
  brake_c: { front: [number, number]; rear: [number, number] };
  pad_low_mm: number;
  water_c: [number, number];
}

/** GT3 defaults, used until the bridge sends its config. They match the bridge's own defaults. */
export const DEFAULT_THRESHOLDS: Thresholds = {
  dry_psi: [26.0, 27.0], wet_psi: [29.5, 31.0], tyre_c: [65, 105],
  brake_c: { front: [200, 750], rear: [200, 750] }, pad_low_mm: 12, water_c: [105, 115],
};

export interface StateCtx { th: Thresholds; wet: boolean; fuelLowLaps: number }

export const pressState = (p: number, c: StateCtx): State => {
  if (!(p > 0)) return "none";
  const [lo, hi] = c.wet ? c.th.wet_psi : c.th.dry_psi;
  return p < lo ? "cold" : p > hi + 1 ? "bad" : p > hi ? "warn" : "ok";
};

export const tyreState = (t: number, c: StateCtx): State => {
  if (!(t > 0)) return "none";
  const [lo, hi] = c.th.tyre_c;
  return t < lo ? "cold" : t > hi + 10 ? "bad" : t > hi ? "warn" : "ok";
};

export const brakeState = (t: number, axle: "front" | "rear", c: StateCtx): State => {
  if (!(t > 0)) return "none";
  const [cold, hot] = c.th.brake_c[axle] ?? c.th.brake_c.front;
  return t < cold ? "cold" : t > hot ? "bad" : t > hot - 100 ? "warn" : "ok";
};

export const padState = (mm: number, c: StateCtx): State =>
  !(mm > 0) ? "none" : mm < c.th.pad_low_mm ? "bad" : mm < c.th.pad_low_mm + 3 ? "warn" : "ok";

export const fuelState = (laps: number | null | undefined, c: StateCtx): State =>
  laps == null || !Number.isFinite(laps) ? "none" : laps < c.fuelLowLaps ? "bad" : laps < c.fuelLowLaps + 2 ? "warn" : "ok";

export const waterState = (t: number, c: StateCtx): State => {
  if (!(t > 0)) return "none";
  const [warn, bad] = c.th.water_c;
  return t >= bad ? "bad" : t >= warn ? "warn" : "ok";
};

/** Colour is never the only cue: every non-ok state also has a glyph and a word. */
export const stateGlyph = (s: State): string => ({ cold: " ▼", warn: " ▲", bad: " ■" } as Record<string, string>)[s] ?? "";
export const STATE_WORD: Record<string, string> = { cold: "COLD", warn: "HIGH", bad: "CRIT" };
