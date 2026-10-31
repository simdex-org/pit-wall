import { DEFAULT_THRESHOLDS, Thresholds } from "../lib/states";
import { numbersOnly } from "./sanitize";
import type { BroadcastState, Car, Field, Json, LogLine, Payload } from "./types";

export type Focus = "self" | number;

export interface Ctx {
  /** The latest reading, its source driver, summary, strategy and lap list. */
  r: Json | null;
  from: string;
  s: Json | null;
  st: Json | null;
  laps: Json[];
  field: Field | null;
  entries: { track: Json | null; cars: Record<string, Json> } | null;
  cars: Map<number, Car>;
  me: number | null;
  mode: "race" | "best" | null;
  focus: Focus;
  focusCar: Car | null;
  pit: Json | null;
  pitJob: Json | null;
  pitLog: Json[];
  log: LogLine[];
  cfg: Json | null;
  th: Thresholds;
  bc: BroadcastState | null;
  ages: { r: number | null; s: number | null; field: number | null };
  live: boolean;
  stale: boolean;
  wet: boolean;
  /** Rate of readings over the last two seconds, for the engineer bar. */
  hz: number;
}

export const emptyCtx = (): Ctx => ({
  r: null, from: "", s: null, st: null, laps: [], field: null, entries: null, cars: new Map(), me: null, mode: null, focus: "self",
  focusCar: null, pit: null, pitJob: null, pitLog: [], log: [], cfg: null, th: DEFAULT_THRESHOLDS, bc: null,
  ages: { r: null, s: null, field: null }, live: false, stale: false, wet: false, hz: 0,
});

const LOG_LIMIT = 500;

export interface Internals {
  lastSeq: number | null;
  slow: Map<number, Partial<Car>>;
  bridgeLog: LogLine[];
  bridgeLogSeq: number;
  pageLog: LogLine[];
  rx: number[];
}

export const emptyInternals = (): Internals => ({ lastSeq: null, slow: new Map(), bridgeLog: [], bridgeLogSeq: -1, pageLog: [], rx: [] });

function focusCar(c: Pick<Ctx, "cars" | "focus" | "me">): Car | null {
  const i = c.focus === "self" ? c.me : c.focus;
  return i == null ? null : c.cars.get(i) ?? null;
}

/** Fast field, slow fields and entry list merged by car index. */
function mergeCars(entries: Ctx["entries"], field: Field | null, slow: Map<number, Partial<Car>>): Map<number, Car> {
  const cars = new Map<number, Car>();
  const ents = entries?.cars ?? {};
  for (const c of field && Array.isArray(field.cars) ? field.cars : []) cars.set(c.i, Object.assign({}, ents[c.i], slow.get(c.i), c));
  return cars;
}

function mergeLog(it: Internals): LogLine[] {
  return it.bridgeLog.concat(it.pageLog).sort((a, b) => b.t - a.t).slice(0, LOG_LIMIT);
}

/**
 * One payload from the bridge applied to the context. Returns a new context; sections that did not change keep their identity.
 * `now` is a clock in ms, passed in so the rate can be tested.
 */
export function applyPayload(prev: Ctx, it: Internals, raw: Payload, now: number): Ctx {
  // These stay as sent: their strings reach the DOM only escaped by React.
  const { pit, pit_job: pitJob, pit_log: pitLog } = raw;
  const p = numbersOnly<Payload>({ ...raw, pit: undefined, pit_job: undefined, pit_log: undefined });
  const c: Ctx = { ...prev };

  c.ages = { r: p.reading_age_ms ?? null, s: p.summary_age_ms ?? null, field: p.field_age_ms ?? null };
  c.live = c.ages.r != null && c.ages.r < 1500;
  c.stale = c.ages.r != null && c.ages.r < 10000;

  const reading = p.reading as (Json & { sequence?: number }) | null | undefined;
  if (reading && reading.sequence !== it.lastSeq) {
    it.lastSeq = reading.sequence ?? null;
    c.r = reading.reading ?? null;
    c.from = reading.from ?? "";
    c.wet = !!(c.r && c.r.session.rain_tyres);
    it.rx.push(now);
    while (it.rx.length && it.rx[0]! < now - 2000) it.rx.shift();
  }
  c.hz = c.live ? Math.round(it.rx.length / 2) : 0;

  if (p.summary) { c.s = p.summary; c.st = p.summary.strategy ?? null; }
  if (p.laps) c.laps = p.laps;
  if (p.config) c.cfg = p.config;
  if (p.bc !== undefined) c.bc = p.bc;
  if (p.entries) { c.entries = p.entries; c.cars = mergeCars(c.entries, c.field, it.slow); }

  if (p.field) {
    c.field = p.field;
    c.me = p.field.me ?? null;
    if (p.field.slow) for (const [k, v] of Object.entries(p.field.slow)) it.slow.set(Number(k), v);
    c.cars = mergeCars(c.entries, c.field, it.slow);
  } else if (c.bc && c.bc.state !== "live" && c.field && c.ages.field == null) {
    c.field = null; c.cars = new Map(); c.me = null;
  }

  c.mode = c.field?.mode ?? (c.r?.session.kind ? (c.r.session.kind === "Race" ? "race" : "best") : null);
  const cls = c.r?.fixed.car_class as string | undefined;
  const table = c.cfg?.thresholds as Record<string, Thresholds> | undefined;
  c.th = table ? (cls && table[cls]) || table.GT3 || DEFAULT_THRESHOLDS : DEFAULT_THRESHOLDS;

  if (Array.isArray(p.log) && p.log.length) {
    for (const line of p.log) if (line.seq > it.bridgeLogSeq) { it.bridgeLog.unshift(line); it.bridgeLogSeq = line.seq; }
    if (it.bridgeLog.length > LOG_LIMIT) it.bridgeLog.length = LOG_LIMIT;
    c.log = mergeLog(it);
  }

  c.pit = pit ?? null;
  c.pitJob = pitJob ?? null;
  if (Array.isArray(pitLog)) c.pitLog = pitLog;
  c.focusCar = focusCar(c);
  return c;
}

/** A line the page itself adds to the log (a sent plan, a saved template). */
export function addPageLog(prev: Ctx, it: Internals, sev: number, cat: string, text: string): Ctx {
  const lap = prev.r ? prev.r.session.lap_number : 0;
  it.pageLog.unshift({ seq: -it.pageLog.length - 1, t: Date.now() / 1000, lap, sev: Math.max(0, Math.min(2, sev | 0)), cat: String(cat).slice(0, 8), text: String(text), src: "page" });
  if (it.pageLog.length > 200) it.pageLog.pop();
  return { ...prev, log: mergeLog(it) };
}

export function withFocus(prev: Ctx, v: Focus | null | undefined): Ctx {
  let focus: Focus = v == null || v === "self" ? "self" : Number(v);
  if (focus !== "self" && !Number.isFinite(focus)) return prev;
  if (focus !== "self" && focus === prev.me) focus = "self";
  const next = { ...prev, focus };
  next.focusCar = focusCar(next);
  return next;
}

/** A subscribable holder for the context; React reads it through useSyncExternalStore. */
export class FeedStore {
  private ctx = emptyCtx();
  private it = emptyInternals();
  private subs = new Set<() => void>();

  get = (): Ctx => this.ctx;

  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  };

  private set(next: Ctx): void {
    this.ctx = next;
    for (const fn of this.subs) fn();
  }

  receive(raw: Payload): void { this.set(applyPayload(this.ctx, this.it, raw, performance.now())); }
  log(sev: number, cat: string, text: string): void { this.set(addPageLog(this.ctx, this.it, sev, cat, text)); }
  setFocus(v: Focus | null | undefined): void { this.set(withFocus(this.ctx, v)); }
}

export const feed = new FeedStore();
