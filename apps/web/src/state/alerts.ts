// Each mounted module reports [level, count]; the workspace tabs show the worst of their own workspace.
import { useSyncExternalStore } from "react";

const alerts = new Map<string, [number, number]>();
let snapshot = new Map(alerts);
const subs = new Set<() => void>();

export function setAlert(id: string, level: number, count: number): void {
  const old = alerts.get(id);
  if (old && old[0] === level && old[1] === count) return;
  if (level || count) alerts.set(id, [level, count]); else alerts.delete(id);
  snapshot = new Map(alerts);
  subs.forEach((fn) => fn());
}

export const clearAlert = (id: string): void => setAlert(id, 0, 0);

export const useAlerts = (): ReadonlyMap<string, [number, number]> =>
  useSyncExternalStore((fn) => { subs.add(fn); return () => { subs.delete(fn); }; }, () => snapshot);
