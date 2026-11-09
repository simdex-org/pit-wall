import { useSyncExternalStore } from "react";
import { feed } from "../feed/store";
import { post, say } from "./bridge";

export interface Team {
  names: string[];
  drivers: number;
  spd: number;
  first: number;
  maxStintMin: number | null;
}

const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);

export function clean(o: unknown): Team {
  const r = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const drivers = int(Array.isArray(r.names) ? r.names.length : r.drivers, 1, 10, 1);
  const raw = Array.isArray(r.names) ? r.names : [];
  const names = Array.from({ length: drivers }, (_, i) => (typeof raw[i] === "string" ? raw[i].replace(/[\u0000-\u001f<>]/g, "").slice(0, 20) : ""));
  const m = r.maxStintMin;
  return { names, drivers, spd: int(r.spd, 1, 10, 1), first: int(r.first, 0, drivers - 1, 0), maxStintMin: typeof m === "number" && m > 0 && m <= 1440 ? Math.round(m) : null };
}

// The plan lives on the bridge, shared by every page and by the teammates' linked bridges
let fromCfg: { cfg: unknown; team: Team } = { cfg: undefined, team: clean({}) };
function onBridge(): Team {
  const cfg = feed.get().cfg;
  if (cfg !== fromCfg.cfg) {
    const t = (cfg?.team ?? {}) as Record<string, unknown>;
    fromCfg = { cfg, team: clean({ names: t.names, spd: t.spd, first: t.first, maxStintMin: t.max_stint_min }) };
  }
  return fromCfg.team;
}

// Edits show at once and go to the bridge after a short pause, so typing a name is one request
let draft: { team: Team; cfg: unknown } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();

async function send(): Promise<void> {
  const t = draft!.team;
  const r = await post("/config", { team: { names: t.names, spd: t.spd, first: t.first, max_stint_min: t.maxStintMin } });
  if (!r.ok) say(r.status === 403 ? "Changing the stint plan needs the access key: Settings › Connection" : `The bridge refused the stint plan: ${r.text.slice(0, 80)}`, 1);
  if (draft?.team === t) draft = r.ok ? { team: t, cfg: feed.get().cfg } : null;
  subs.forEach((fn) => fn());
}

export const team = {
  get: (): Team => {
    if (draft && draft.cfg !== undefined && draft.cfg !== feed.get().cfg) draft = null;
    return draft ? draft.team : onBridge();
  },
  set(p: Partial<Team>): void {
    draft = { team: clean({ ...team.get(), ...p }), cfg: undefined };
    subs.forEach((fn) => fn());
    clearTimeout(timer);
    timer = setTimeout(() => void send(), 400);
  },
};

export const useTeam = (): Team => useSyncExternalStore((fn) => { subs.add(fn); const off = feed.subscribe(fn); return () => { subs.delete(fn); off(); }; }, team.get);

export const nameOf = (t: Team, i: number): string => t.names[i] || `D${i + 1}`;

export const driverOf = (t: Team, stint: number): number => (Math.floor((stint - 1) / t.spd) + t.first) % t.drivers;

// Stop k ends stint k; the driver changes when the next stint belongs to someone else.
export const swapAt = (t: Team, stop: number): { from: number; to: number } | null => {
  const from = driverOf(t, stop), to = driverOf(t, stop + 1);
  return from === to ? null : { from, to };
};
