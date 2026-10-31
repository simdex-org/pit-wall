import { NONE } from "./format";

// Values arrive in km/h, degrees C and psi; they are converted only for display.
export interface Unit { f: (v: number) => number; b: (v: number) => number; u: string; d: number }

export const UNITS = {
  speed: {
    kmh: { f: (v) => v, b: (v) => v, u: "km/h", d: 0 },
    mph: { f: (v) => v * 0.621371, b: (v) => v / 0.621371, u: "mph", d: 0 },
  },
  temp: {
    c: { f: (v) => v, b: (v) => v, u: "°C", d: 0 },
    f: { f: (v) => v * 1.8 + 32, b: (v) => (v - 32) / 1.8, u: "°F", d: 0 },
  },
  press: {
    psi: { f: (v) => v, b: (v) => v, u: "psi", d: 1 },
    bar: { f: (v) => v * 0.0689476, b: (v) => v / 0.0689476, u: "bar", d: 2 },
    kpa: { f: (v) => v * 6.89476, b: (v) => v / 6.89476, u: "kPa", d: 0 },
  },
} satisfies Record<string, Record<string, Unit>>;

export type UnitKind = keyof typeof UNITS;
export type UnitChoice = { speed: keyof typeof UNITS.speed; temp: keyof typeof UNITS.temp; press: keyof typeof UNITS.press };
export const DEFAULT_UNITS: UnitChoice = { speed: "kmh", temp: "c", press: "psi" };

export function unit(kind: UnitKind, choice: UnitChoice = DEFAULT_UNITS): Unit {
  const table: Record<string, Unit> = UNITS[kind];
  return table[choice[kind]] ?? Object.values(table)[0]!;
}

/** The converted value with its unit's decimals, no unit text. */
export function fv(kind: UnitKind, v: number | null | undefined, choice?: UnitChoice, digits?: number): string {
  if (v == null || !Number.isFinite(v)) return NONE;
  const u = unit(kind, choice);
  return u.f(v).toFixed(digits ?? u.d);
}

/** The converted value followed by its unit's name. */
export function fvu(kind: UnitKind, v: number | null | undefined, choice?: UnitChoice, digits?: number): string {
  return v == null || !Number.isFinite(v) ? NONE : `${fv(kind, v, choice, digits)} ${unit(kind, choice).u}`;
}
