export const MAX_SOURCE = 100_000;

export const FRAME_URL = "/sandbox.html";

export type Kind = "reading" | "summary" | "field" | "laps" | "units" | "theme";

export type Payload = Record<Kind, unknown>;

export function sourceProblem(s: string): string | null {
  if (s.length > MAX_SOURCE) return `The file has ${s.length.toLocaleString("en")} characters; the limit is ${MAX_SOURCE.toLocaleString("en")}.`;
  return null;
}

export const cleanSource = (s: unknown): string | null =>
  typeof s === "string" && !sourceProblem(s) ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : null;

export function changed(prev: Partial<Payload>, next: Payload): Partial<Payload> | null {
  const out: Partial<Payload> = {};
  let any = false;
  for (const k of Object.keys(next) as Kind[]) if (prev[k] !== next[k]) { out[k] = next[k]; any = true; }
  return any ? out : null;
}

// Runs inside the frame, so it must not use anything from outside its own body.
export function helper(w: Window & typeof globalThis, from: unknown): void {
  const subs: Record<string, ((v: unknown) => void)[]> = {};
  const latest: Record<string, unknown> = {};
  const call = (fn: (v: unknown) => void, v: unknown) => { try { fn(v); } catch (err) { console.error(err); } };
  const paint = (t: { vars?: Record<string, string>; scheme?: string }) => {
    const s = w.document.documentElement.style;
    for (const [k, v] of Object.entries(t.vars ?? {})) s.setProperty(k, v);
    if (t.scheme) s.colorScheme = t.scheme;
  };
  for (const k of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"]) delete (w as unknown as Record<string, unknown>)[k];
  Object.defineProperty(w, "pitwall", {
    value: Object.freeze({
      latest,
      on(kind: string, fn: (v: unknown) => void) {
        (subs[kind] ??= []).push(fn);
        if (kind === "update" ? Object.keys(latest).length : kind in latest) call(fn, kind === "update" ? latest : latest[kind]);
        return () => { subs[kind] = (subs[kind] ?? []).filter((f) => f !== fn); };
      },
    }),
  });
  w.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== from || !e.data || e.data.type !== "data" || typeof e.data.data !== "object") return;
    const d = e.data.data as Record<string, unknown>;
    for (const k of Object.keys(d)) {
      latest[k] = d[k];
      if (k === "theme" && d[k]) paint(d[k] as { vars?: Record<string, string> });
    }
    for (const k of Object.keys(d)) for (const fn of subs[k] ?? []) call(fn, d[k]);
    for (const fn of subs.update ?? []) call(fn, latest);
  });
}

export const frameDoc = (src: string): string =>
  `<!doctype html><script>(${helper.toString()})(window, parent)</script>` + src.replace(/^\s*<!doctype[^>]*>/i, "");
