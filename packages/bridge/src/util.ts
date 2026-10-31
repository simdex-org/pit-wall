// Small numeric helpers: rounding half to even, a modulo that follows the sign of the divisor, and indexing from the end.

export class ValueError extends Error {}

/** Loose record for ACC's raw pages and the payloads built from them; the shapes are too many to type one by one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rec = Record<string, any>;

/** Rounds half to even. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** x modulo m, with the sign of m. */
export const mod = (x: number, m: number): number => ((x % m) + m) % m;

/** An element by index, counting from the end when negative. */
export const at = <T>(a: readonly T[], i: number): T => a[mod(i, a.length)] as T;

export const sum = (xs: Iterable<number>): number => {
  let s = 0;
  for (const x of xs) s += x;
  return s;
};

export const mean = (xs: Iterable<number | null | undefined>): number | null => {
  const v = [...xs].filter((x): x is number => x != null);
  return v.length ? sum(v) / v.length : null;
};

export const isObj = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** Floats to 3 decimals (NaN/inf to null), recursively; a new object. */
export function rnd<T>(o: T): T {
  if (typeof o === "number") return (Number.isFinite(o) ? (Number.isInteger(o) ? o : Math.round(o * 1000) / 1000) : null) as T;
  if (Array.isArray(o)) return o.map(rnd) as T;
  if (isObj(o)) return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, rnd(v)])) as T;
  return o;
}

export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
