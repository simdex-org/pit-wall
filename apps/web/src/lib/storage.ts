// Every access may throw (private windows, blocked site data), so nothing here ever does.
export function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function lsRaw(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function lsSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function lsDel(key: string): void {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}
