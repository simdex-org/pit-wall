// Talking to the bridge: the access key, plans and settings going out, laps and traces coming back, and the one-line messages.
import { useSyncExternalStore } from "react";
import { numbersOnly } from "../feed/sanitize";
import { lsRaw, lsSet } from "../lib/storage";

/** The key arrives once as ?key=, is kept in this browser and removed from the address bar. */
export const accessKey: { value: string } = {
  value: (() => {
    if (typeof location === "undefined") return "";
    const k = new URLSearchParams(location.search).get("key");
    if (k) { lsSet("pitwall.pitkey", k); history.replaceState(null, "", location.pathname + location.hash); }
    return k || lsRaw("pitwall.pitkey") || "";
  })(),
};

export interface PostResult { ok: boolean; status: number; text: string }

export async function post(path: string, body: unknown): Promise<PostResult> {
  try {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Pit-Key": accessKey.value }, body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status, text: await r.text() };
  } catch {
    return { ok: false, status: 0, text: "The bridge is not answering." };
  }
}

export async function get<T = unknown>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path);
    return r.ok ? numbersOnly<T>(await r.json()) : null;
  } catch {
    return null;
  }
}

// ---------- the engineer bar's right-hand message, which replaces the status line for six seconds ----------
interface Say { text: string; sev: number; until: number }
let current: Say | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((fn) => fn());

export function say(text: string, sev = 0): void {
  current = { text: String(text), sev: sev | 0, until: performance.now() + 6000 };
  notify();
  setTimeout(notify, 6100);
}

export const useSay = (): Say | null =>
  useSyncExternalStore((fn) => { subs.add(fn); return () => { subs.delete(fn); }; }, () => current && current.until > performance.now() ? current : null);
