import type { Rec } from "../util.js";

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

// The driver broadcasting says is in our car, or null when it cannot tell
export function inCar(field: Rec | null, entries: Rec | null): string | null {
  const me = field?.me;
  if (me == null) return null;
  const car = (field!.cars ?? []).find((c: Rec) => c.i === me);
  const d = car && entries?.cars?.[String(me)]?.drivers?.[car.drv];
  return d ? `${d.first ?? ""} ${d.last ?? ""}`.trim() || null : null;
}

// This PC's driver is in the car: its game is live and broadcasting names no one else
export const drivingHere = (live: boolean, name: string, driver: string | null): boolean => live && (driver === null || norm(name) === norm(driver));
