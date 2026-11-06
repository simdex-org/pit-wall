import { useState } from "react";
import { lsGet, lsSet } from "./storage";

export function usePersisted<T>(key: string, init: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, set] = useState<T>(() => {
    const x = lsGet<unknown>("pitwall.ui", {}) as Record<string, unknown>;
    return typeof x === "object" && x && typeof x[key] === typeof init && x[key] !== null ? (x[key] as T) : init;
  });
  return [v, (n) => {
    const next = typeof n === "function" ? (n as (p: T) => T)(v) : n;
    set(next);
    lsSet("pitwall.ui", { ...(lsGet<Record<string, unknown>>("pitwall.ui", {}) ?? {}), [key]: next });
  }];
}
