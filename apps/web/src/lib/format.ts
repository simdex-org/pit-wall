/** U+2212, the minus sign every figure uses. */
export const MINUS = "−";

/** What a missing value shows. An en dash, so it never reads as a minus sign. */
export const NONE = "–";

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

export const okMs = (ms: number | null | undefined): ms is number => finite(ms) && ms > 0 && ms < 3.6e6;

export const fmtLap = (ms: number | null | undefined): string => {
  if (!okMs(ms)) return NONE;
  const s = `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${String(Math.round(ms % 1000)).padStart(3, "0")}`;
  return s.replace(/\.1000$/, ".999");
};

export const fmtSector = (ms: number | null | undefined): string =>
  !okMs(ms) ? NONE : ms >= 60000 ? fmtLap(ms) : (ms / 1000).toFixed(3);

/** Lap and sector deltas: unsigned zero inside half a millisecond, otherwise signed with a real minus. */
export const fmtDelta = (ms: number | null | undefined): string =>
  !finite(ms) ? NONE : Math.abs(ms) < 0.5 ? "0.000" : (ms > 0 ? "+" : MINUS) + (Math.abs(ms) / 1000).toFixed(3);

export const fmtGap = (ms: number | null | undefined, laps?: number): string =>
  laps && laps > 0 ? `+${laps}L` : !finite(ms) || ms < 0 ? NONE : "+" + (ms / 1000).toFixed(ms < 10000 ? 2 : 1);

export const fmtClock = (ms: number | null | undefined): string => {
  if (!finite(ms) || ms < 0 || ms > 1e9) return NONE;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export const fmtAgo = (ms: number | null | undefined): string =>
  !finite(ms) ? NONE : ms < 1500 ? "now" : ms < 60000 ? `${Math.round(ms / 1000)} s` : ms < 3.6e6 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 3.6e6)} h`;

export const signed = (v: number | null | undefined, d: number): string =>
  !finite(v) ? NONE : (v > 0 ? "+" : v < 0 ? MINUS : "") + Math.abs(v).toFixed(d);

/** The one rule for the time between two cars: unsigned, the direction is carried by the row or the word. */
export const fmtRel = (ms: number | null | undefined, d?: number): string =>
  !finite(ms) ? NONE : (Math.abs(ms) / 1000).toFixed(d ?? (Math.abs(ms) < 10000 ? 2 : 1));

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export const nf = (v: number | null | undefined, d = 1): string => (!finite(v) ? NONE : (+v).toFixed(d));

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
