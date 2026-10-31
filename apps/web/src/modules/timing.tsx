import { Fragment, ReactNode, useLayoutEffect, useRef, useState } from "react";
import { defineModule } from "../engine/registry";
import type { Ctx } from "../feed/store";
import type { Car } from "../feed/types";
import { carName } from "../lib/cars";
import { FLAGS, PENALTIES, PHASES } from "../lib/enums";
import { fmtClock, fmtDelta, fmtGap, fmtLap, fmtRel, fmtSector, MINUS, nf, NONE, okMs, plural } from "../lib/format";
import { fv, unit } from "../lib/units";
import { KpiId, usePrefs } from "../state/prefs";
import { cell as kpiCell } from "../shell/KpiStrip";
import { CarTags, CarTr, carNum, carTitle, driver, fieldOn, Kv, sortedCars, Spark, useRowCursor, YouTag } from "./cars";
import { Delta } from "./delta";

const NO_RIVAL = "ACC shares no rival inputs, fuel or tyres";

// ---------- standings ----------
const SCOLS: [string, string][] = [["car", "Car"], ["cup", "Cup"], ["laps", "Laps"], ["gap", "Gap"], ["int", "Int"], ["last", "Last"], ["best", "Best"], ["sectors", "S1–S3 of the last lap"],
  ["pits", "Pits"], ["stint", "Stint"], ["net", "Net position"], ["deltaMe", "Δ to my best"]];
/** Dropped first when the width runs out; gap and position stay. */
const DROP_ORDER = ["car", "sectors", "deltaMe", "best", "stint", "pits", "net", "last", "int"];

const dash = <>{NONE}</>;

function LapCell({ x, sb }: { x: Car; sb: number | undefined }) {
  const v = x.last;
  if (!okMs(v)) return dash;
  if (x.last_valid === false) return <span className="t-inv">{fmtLap(v)}</span>;
  // The personal-best mark waits for a few laps: early on nearly every lap is the car's best.
  if (v === sb) return <span className="t-best">◆ {fmtLap(v)}</span>;
  if (v === x.best && (x.laps ?? 0) >= 3) return <span className="t-pb">● {fmtLap(v)}</span>;
  return <>{fmtLap(v)}</>;
}

function SectorCell({ x, k, bestS }: { x: Car; k: number; bestS: number[] }) {
  const v = (x.last_s ?? [])[k];
  if (!okMs(v)) return dash;
  if (v === bestS[k]) return <span className="t-best">◆ {fmtSector(v)}</span>;
  if (v === (x.best_s ?? [])[k] && x.laps >= 3) return <span className="t-pb">● {fmtSector(v)}</span>;
  return <>{fmtSector(v)}</>;
}

interface StdOpts { scope: string; cols: string[]; around: number; names: "short" | "full" | "last" }

function StandingsTable({ c, o, rows, cup, mine, race, cursor }: { c: Ctx; o: StdOpts; rows: Car[]; cup: boolean; mine: Car | undefined; race: boolean; cursor: number | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<{ key: string; set: string[] }>({ key: "", set: [] });
  const sb = c.field?.best?.ms;
  const bestS = [0, 1, 2].map((k) => Math.min(...rows.map((x) => (x.best_s ?? [])[k] ?? 0).filter((v) => v > 0), Infinity));
  const net = o.cols.includes("net") && race && rows.every((x) => x.net != null);

  let show: (Car | null)[] = rows;
  if (o.around > 0 && mine) {
    // The rows around the car are a minimum: the room the module has is filled outward from it.
    const body = wrap.current?.parentElement;
    const fit = Math.max(1, Math.floor((body?.clientHeight ?? 400) / (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--trow")) || 24)) - 1);
    const k = rows.indexOf(mine);
    let lo = Math.max(0, k - o.around), hi = Math.min(rows.length, k + o.around + 1);
    const used = () => hi - lo + (lo > 0 ? 1 : 0) + (lo > 1 ? 1 : 0);
    for (let t = 0; used() < fit && (lo > 0 || hi < rows.length); t++) { if (t % 2 ? lo > 0 : hi >= rows.length) lo--; else hi++; }
    show = (lo > 0 ? [rows[0]!] : []).concat(lo > 1 ? [null as unknown as Car] : [], rows.slice(lo, hi));
  }

  const cols = o.cols.filter((k) => SCOLS.some(([id]) => id === k) && (k !== "net" || net) && !drop.set.includes(k));
  const wkey = `${wrap.current?.parentElement?.clientWidth ?? 0}|${o.cols.join()}`;

  // Columns that do not fit are dropped, least useful first, and the header line says so.
  useLayoutEffect(() => {
    const body = wrap.current?.parentElement;
    if (!body) return;
    const key = `${body.clientWidth}|${o.cols.join()}`;
    if (drop.key !== key) { setDrop({ key, set: [] }); return; }
    if (body.clientWidth <= 0 || body.scrollWidth <= body.clientWidth + 1) return;
    const next = DROP_ORDER.find((k) => cols.includes(k));
    if (next) setDrop({ key, set: [...drop.set, next] });
  });
  void wkey;

  const gapF = (ms: number | null | undefined, laps: number) => (race ? fmtGap(ms, laps) : fmtDelta(ms));
  const ncol = 5 + cols.reduce((n, k) => n + (k === "sectors" ? 3 : 1), 0);
  const head: Record<string, ReactNode> = {
    car: <th>Car</th>, cup: <th>Cup</th>, laps: <th className="n">Laps</th>,
    gap: <th className="n">{race ? "Gap" : "To P1"}</th>, int: <th className="n">{race ? "Int" : "To next"}</th>,
    last: <th className="n">Last</th>, best: <th className="n">Best</th>,
    sectors: <><th className="n">S1</th><th className="n">S2</th><th className="n">S3</th></>,
    pits: <th className="n">Pits</th>, stint: <th className="n">Stint</th>, net: <th className="n">Net</th>, deltaMe: <th className="n" title="My best minus theirs">Δ me</th>,
  };
  const body = (k: string, x: Car): ReactNode => {
    switch (k) {
      case "car": return <td className="car" title={x.model_name}>{x.model_name || NONE}</td>;
      case "cup": return <td>{x.cup_name || NONE}</td>;
      case "laps": return <td className="n">{nf(x.laps, 0)}</td>;
      case "gap": return <td className="n">{x.pos === 1 ? NONE : gapF(x.gap, x.gap_laps)}</td>;
      case "int": return <td className="n">{x.pos === 1 ? NONE : gapF(x.int, x.int_laps)}</td>;
      case "last": {
        const inLap = x.last_pit_lap != null && x.laps === x.last_pit_lap + 1; // a slow in-lap, not a slow flying lap
        return <td className="n"><LapCell x={x} sb={sb} />{x.last_valid === false && okMs(x.last) ? <> <b className="tag inv">INV</b></> : null}{okMs(x.last) && inLap ? <> <b className="tag in">IN</b></> : null}</td>;
      }
      case "best": return <td className="n">{okMs(x.best) ? (x.best === sb ? <span className="t-best">◆ {fmtLap(x.best)}</span> : fmtLap(x.best)) : NONE}</td>;
      case "sectors": return <>{[0, 1, 2].map((i) => <td className="n" key={i}><SectorCell x={x} k={i} bestS={bestS} /></td>)}</>;
      case "pits": return <td className="n">{nf(x.pits, 0)}</td>;
      case "stint": return <td className="n">{nf(x.i === c.me && c.s ? c.s.stint_laps : x.stint_laps, 0)}</td>;
      case "net": return <td className="n">P{x.net}{x.net! < x.pos ? <> <span className="s-ok">(+{x.pos - x.net!})</span></> : x.net! > x.pos ? <> <span className="s-bad">({MINUS}{x.net! - x.pos})</span></> : null}</td>;
      case "deltaMe": return <td className="n">{x.i === c.me || !mine || !okMs(mine.best) || !okMs(x.best) ? NONE : <Delta ms={mine.best - x.best} />}</td>;
    }
    return null;
  };

  return (
    <div ref={wrap}>
      <table className="tt std">
        <thead><tr><th className="sb" /><th className="n">Pos</th><th className="n">#</th><th>Driver</th><th />{cols.map((k) => <Fragment key={k}>{head[k]}</Fragment>)}</tr></thead>
        <tbody>
          {show.map((x, n) => x == null ? (
            <tr className="gaprow" key={"gap" + n}><td className="sb" /><td colSpan={ncol - 1} className="note">⋯</td></tr>
          ) : (
            <CarTr key={x.i} car={x} c={c} cursor={cursor}>
              <td className="n">{cup ? x.cpos : x.pos}</td>
              <td className="n">{x.num}</td>
              <td className="drv" title={carTitle(x)}>{driver(x, o.names)}{x.i === c.me ? <> <YouTag /></> : null}{x.class && mine && x.class !== mine.class ? <> <b className="tag" title="Another class">{x.class}</b></> : null}</td>
              <td className="tags"><CarTags car={x} /></td>
              {cols.map((k) => <Fragment key={k}>{body(k, x)}</Fragment>)}
            </CarTr>
          ))}
        </tbody>
      </table>
      <p className="note">{NO_RIVAL}.</p>
    </div>
  );
}

export const standings = defineModule({
  type: "standings", title: "Standings", group: "Timing", blurb: "The whole field: positions, gaps, laps and pit stops.",
  size: { w: 7, h: 16, minW: 4, minH: 6 }, needs: ["field", "entries", "focus"], requires: ["field"], rate: 4,
  options: [
    { key: "scope", label: "Show", type: "select", choices: [["all", "All cars"], ["cup", "My cup category"]], def: "all" },
    { key: "cols", label: "Columns", type: "multi", choices: SCOLS, def: ["gap", "int", "last", "best", "pits", "stint"] },
    { key: "around", label: "Rows around me (0 = all)", type: "number", min: 0, max: 20, step: 1, def: 0 },
    { key: "names", label: "Names", type: "select", choices: [["short", "A. Mori"], ["full", "Aiko Mori"], ["last", "Mori"]], def: "short" },
  ],
  view({ ctx: c, opts }) {
    const o = opts as StdOpts;
    const mine = c.me != null ? c.cars.get(c.me) : undefined;
    const cup = o.scope === "cup" && !!mine;
    let rows = sortedCars(c);
    if (cup) rows = rows.filter((x) => x.cup === mine!.cup).sort((a, b) => a.cpos - b.cpos);
    const nav = useRowCursor(rows.map((x) => x.i));
    if (!rows.length) return { state: { kind: "empty", msg: "Waiting for the field." } };
    const sb = c.field!.best;
    const bestCar = sb ? c.cars.get(sb.car) : undefined;
    return {
      info: `${rows.length} cars${sb ? ` · ◆ ${fmtLap(sb.ms)} #${bestCar?.num ?? "?"}` : ""}`,
      onKey: nav.onKey,
      body: <StandingsTable c={c} o={o} rows={rows} cup={cup} mine={mine} race={c.mode !== "best"} cursor={nav.cursor} />,
    };
  },
});

// ---------- relative ----------
export const relative = defineModule({
  type: "relative", title: "Relative", group: "Timing", blurb: "The cars nearest to you on track, ahead and behind, in seconds.",
  size: { w: 3, h: 8, minW: 3, minH: 5 }, needs: ["field", "entries", "reading", "focus"], requires: ["reading"], rate: 4,
  options: [{ key: "rows", label: "Cars each side", type: "number", min: 2, max: 5, step: 1, def: 3 }, { key: "cls", label: "Class tags", type: "toggle", def: true }],
  view({ ctx: c, opts }) {
    const mine = c.me != null ? c.cars.get(c.me) : undefined;
    const others = [...c.cars.values()].filter((x) => x.i !== c.me && x.rel != null && isFinite(x.rel));
    const N = opts.rows as number;
    const ahead = others.filter((x) => x.rel! > 0).sort((a, b) => a.rel! - b.rel!).slice(0, N).reverse();
    const behind = others.filter((x) => x.rel! < 0).sort((a, b) => b.rel! - a.rel!).slice(0, N);
    const order = ahead.concat(mine ? [mine] : [], behind).map((x) => x.i);
    const nav = useRowCursor(order);
    const ss = c.r!.session;
    if (!fieldOn(c) || !mine) {
      // Field timing off: what shared memory knows, without names.
      return {
        info: "field off", body: (
          <>
            <table className="tt rel"><tbody>
              <tr data-loc="none"><td className="sb" /><td>Car ahead</td><td className="n">{ss.gap_ahead_ms > 0 ? fmtRel(ss.gap_ahead_ms) : NONE}</td></tr>
              <tr className="me" data-loc="track"><td className="sb" /><td>You <YouTag /> <span className="note">P{nf(ss.position, 0)}</span></td><td className="n">{NONE}</td></tr>
              <tr data-loc="none"><td className="sb" /><td>Car behind</td><td className="n">{ss.gap_behind_ms > 0 ? fmtRel(ss.gap_behind_ms) : NONE}</td></tr>
            </tbody></table>
            <p className="note">Names and lap relation need field timing.</p>
          </>
        ),
      };
    }
    const myD = mine.laps + mine.spl;
    const lapRel = (x: Car) => {
      const f = ((x.spl - mine.spl + 1.5) % 1) - 0.5, k = Math.round(x.laps + x.spl - myD - f);
      return k > 0 ? <b className="tag s-dim">+{k}L</b> : k < 0 ? <b className="tag s-dim">{MINUS}{-k}L</b> : null;
    };
    return {
      info: `${ahead.length} ahead · ${behind.length} behind`,
      onKey: nav.onKey,
      body: (
        <table className="tt rel"><tbody>
          {ahead.concat([mine], behind).map((x) => (
            <CarTr key={x.i} car={x} c={c} cursor={nav.cursor}>
              <td className="n pos">{c.focus === x.i ? "▶ " : ""}{carNum(x)}</td>
              <td className="drv" title={carTitle(x)}>
                {driver(x)}{x.i === c.me ? <> <YouTag /></> : null} <CarTags car={x} />{x.i === c.me ? null : lapRel(x)}
                {opts.cls && x.class && x.class !== mine.class ? <> <b className="tag">{x.class}</b></> : null}
              </td>
              <td className="n">{x.i === c.me ? NONE : fmtRel(x.rel)}</td>
            </CarTr>
          ))}
        </tbody></table>
      ),
    };
  },
});

// ---------- battle ----------
const series = (hist: (number | null | undefined)[] | undefined, gap: number | null | undefined, gl: number): number[] =>
  (hist ?? []).filter((v): v is number => v != null && isFinite(v)).concat(!(gl > 0) && gap != null && isFinite(gap) ? [gap] : []);

function Trend({ h, gap, closer, opener, cls }: { h: number[]; gap: number | null | undefined; closer: string; opener: string; cls: string }) {
  if (h.length < 2) return <span className="note">trend after 2 laps</span>;
  const rate = (h[h.length - 1]! - h[0]!) / (h.length - 1); // ms per lap; negative = the interval is closing
  if (Math.abs(rate) < 20) return <span className="note">holding</span>;
  if (rate < 0) {
    const n = gap! > 1000 ? Math.ceil((gap! - 1000) / -rate) : 0;
    return <><span className={cls}>{closer} catching {(-rate / 1000).toFixed(2)} s/lap</span>{n ? ` · within 1 s in ${plural(n, "lap")}` : " · within 1 s"}</>;
  }
  return <span className="note">{opener} pulling away {(rate / 1000).toFixed(2)} s/lap</span>;
}

function BattleRow({ label, car, gap, gl, hist, closer, opener }: { label: "Ahead" | "Behind"; car: Car | undefined; gap: number | null | undefined; gl: number; hist: (number | null | undefined)[] | undefined; closer: string; opener: string }) {
  if (!car) return <div className="bat-row"><div className="lbl">{label}</div><div className="empty">{label === "Ahead" ? "Leading." : "Last car."}</div></div>;
  const h = series(hist, gap, gl);
  return (
    <div className="bat-row">
      <div className="lbl">{label}</div>
      <div className="bat-main">
        <span className="drv" title={carTitle(car)}><b>{carNum(car)}</b> {driver(car)}</span>
        <b className="big n">{gl > 0 ? plural(gl, "lap") : fmtRel(gap)}</b>
        {label === "Behind" && !(gl > 0) && gap != null && gap < 500 ? <> <b className="tag close">CLOSE</b></> : null}
        <Spark values={h} fmt={(v) => (v / 1000).toFixed(1)} />
      </div>
      <div className="sub"><Trend h={h} gap={gap} closer={closer} opener={opener} cls={label === "Ahead" ? "s-ok" : "s-warn"} /></div>
    </div>
  );
}

export const battle = defineModule({
  type: "battle", title: "Battle", group: "Timing", blurb: "The car ahead and the car behind: interval and whether it is closing.",
  size: { w: 4, h: 6, minW: 3, minH: 5 }, needs: ["field", "entries", "focus", "reading"], rate: 2,
  view({ ctx: c }) {
    if (c.mode === "best") return { state: { kind: "empty", msg: "Battles are tracked in races only." } };
    const ss = c.r?.session;
    const fc = c.focusCar;
    if (!fieldOn(c) || !fc) {
      return {
        info: "field off", body: (
          <>
            <Kv rows={[["Car ahead", ss && ss.gap_ahead_ms > 0 ? fmtRel(ss.gap_ahead_ms) : NONE], ["Car behind", ss && ss.gap_behind_ms > 0 ? fmtRel(ss.gap_behind_ms) : NONE]]} />
            <p className="note">The trend needs field timing.</p>
          </>
        ),
      };
    }
    const list = sortedCars(c), A = list.find((x) => x.pos === fc.pos - 1), B = list.find((x) => x.pos === fc.pos + 1);
    const who = fc.i === c.me ? "you" : carNum(fc);
    return {
      info: fc.i === c.me ? `P${fc.pos}` : `${carNum(fc)} · P${fc.pos}`,
      body: (
        <div className="bat">
          <BattleRow label="Ahead" car={A} gap={fc.int} gl={fc.int_laps} hist={fc.int_hist} closer={who === "you" ? "you're" : who} opener={A ? carNum(A) : ""} />
          <BattleRow label="Behind" car={B} gap={B?.int} gl={B?.int_laps ?? 0} hist={B?.int_hist} closer={B ? carNum(B) : ""} opener={who === "you" ? "you're" : who} />
        </div>
      ),
    };
  },
});

// ---------- pit lane ----------
interface Seen { t: number; partial: boolean }

export const pitActivity = defineModule({
  type: "pit-activity", title: "Pit lane", group: "Timing", blurb: "Who is in the pit lane now, and every car's stops so far.",
  size: { w: 4, h: 8, minW: 3, minH: 5 }, needs: ["field", "entries"], requires: ["field"], rate: 2,
  view({ ctx: c }) {
    const F = c.field!;
    const seen = useRef(new Map<number, Seen>()).current;
    const started = useRef(false);
    const list = sortedCars(c);
    // Entry time is when this page saw the car leave the track; a car already in the lane at first sight is marked with ≥.
    for (const x of list) {
      const inL = x.loc !== "track" && x.loc !== "none", e = seen.get(x.i);
      if (inL && !e) seen.set(x.i, { t: F.t, partial: !started.current }); else if (!inL && e) seen.delete(x.i);
    }
    started.current = true;
    const now = list.filter((x) => x.loc === "pit" || x.loc === "entry" || x.loc === "exit");
    // Only the cars that have stopped, latest stop first: twenty rows of zeros would bury them.
    const stopped = list.filter((x) => (x.pits ?? 0) > 0).sort((a, b) => (b.last_pit_lap ?? 0) - (a.last_pit_lap ?? 0) || a.pos - b.pos);
    const nav = useRowCursor(now.map((x) => x.i).concat(stopped.map((x) => x.i)));
    return {
      info: `${now.length} in the lane · ${plural(list.reduce((a, x) => a + (x.pits || 0), 0), "stop")}`,
      onKey: nav.onKey,
      body: (
        <>
          <div className="pa-now">
            {now.length ? (
              <table className="tt"><tbody>
                {now.map((x) => {
                  const e = seen.get(x.i);
                  return (
                    <CarTr key={x.i} car={x} c={c} cursor={nav.cursor}>
                      <td className="n">{carNum(x)}</td>
                      <td className="drv" title={carTitle(x)}>{driver(x)} <b className="tag pit">{x.loc.toUpperCase()}</b></td>
                      <td className="n"><span className="u">in lane </span>{e ? <>{e.partial ? <span title="already in the lane when this page connected">≥ </span> : null}{nf((F.t - e.t) / 1000, 1)}<span className="u"> s</span></> : NONE}</td>
                    </CarTr>
                  );
                })}
              </tbody></table>
            ) : <div className="empty">Nobody in the pit lane now.{stopped.length ? " Stops so far:" : ""}</div>}
          </div>
          <table className="tt pa-all" hidden={!stopped.length}>
            <thead><tr><th className="sb" /><th className="n">#</th><th>Driver</th><th className="n">Pits</th><th className="n">Stop lap</th><th className="n">Lane s</th><th className="n">Stint</th></tr></thead>
            <tbody>
              {stopped.map((x) => (
                <CarTr key={x.i} car={x} c={c} cursor={nav.cursor}>
                  <td className="n">{carNum(x)}</td>
                  <td className="drv" title={carTitle(x)}>{driver(x)}{x.i === c.me ? <> <YouTag /></> : null}</td>
                  <td className="n">{nf(x.pits, 0)}</td>
                  <td className="n">{x.last_pit_lap != null ? "L" + x.last_pit_lap : NONE}</td>
                  <td className="n">{x.lane_ms ? nf(x.lane_ms / 1000, 1) : NONE}</td>
                  <td className="n">{nf(x.stint_laps, 0)}</td>
                </CarTr>
              ))}
            </tbody>
          </table>
          {stopped.length ? null : <div className="pa-none"><div className="empty">No stops in the field yet.</div></div>}
        </>
      ),
    };
  },
});

// ---------- you vs the focus car ----------
export const sectorCompare = defineModule({
  type: "sector-compare", title: "You vs focus car", group: "Timing", blurb: "Your last and best lap against the focus car (or the car ahead), sector by sector.",
  size: { w: 4, h: 8, minW: 3, minH: 6 }, needs: ["field", "entries", "focus", "laps"], requires: ["field"], rate: 2,
  view({ ctx: c }) {
    const mine = c.me != null ? c.cars.get(c.me) : undefined;
    if (!mine) return { state: { kind: "empty", msg: "Your car is not in the field yet." } };
    const foc = c.focus !== "self" ? c.cars.get(c.focus) : undefined;
    const other = foc ?? sortedCars(c).find((x) => x.pos === mine.pos - 1);
    if (!other) return { state: { kind: "empty", msg: "You are leading: pick a car to compare with." } };
    const L = c.laps, last = L[L.length - 1];
    const ok = L.filter((l) => l.valid && l.ms > 0), best = ok.length ? ok.reduce((a, b) => (b.ms < a.ms ? b : a)) : null;
    const mineSet = {
      last: last ? [last.ms].concat(last.s ?? []) : [mine.last, ...(mine.last_s ?? [])],
      best: best ? [best.ms].concat(best.s && best.s.length ? best.s : best.ms === mine.best ? mine.best_s ?? [] : []) : [mine.best, ...(mine.best_s ?? [])],
    } as Record<"last" | "best", (number | null | undefined)[]>;
    const theirs = { last: [other.last, ...(other.last_s ?? [])], best: [other.best, ...(other.best_s ?? [])] } as typeof mineSet;
    const cellOf = (v: number | null | undefined, k: number) => <td className="n" key={k}>{!okMs(v) ? NONE : k ? fmtSector(v) : fmtLap(v)}</td>;
    const four = (a: (number | null | undefined)[]) => [0, 1, 2, 3].map((i) => cellOf(a[i], i));
    const block = (k: "last" | "best", label: string) => (
      <Fragment key={k}>
        <tr className="tt-group"><td colSpan={5}>{label}</td></tr>
        <tr className="me"><td>You</td>{four(mineSet[k])}</tr>
        <tr><td title={carTitle(other)}>{carNum(other)}</td>{four(theirs[k])}</tr>
        <tr><td className="note">Δ you</td>{[0, 1, 2, 3].map((i) => <td className="n" key={i}>{okMs(mineSet[k][i]) && okMs(theirs[k][i]) ? <Delta ms={mineSet[k][i]! - theirs[k][i]!} /> : NONE}</td>)}</tr>
      </Fragment>
    );
    const ahead = other.pos === mine.pos - 1;
    const hist = c.mode === "best" ? [] : (ahead ? mine.int_hist : other.int_hist) ?? []; // intervals mean nothing in best-lap sessions
    const h5 = hist.slice(-5);
    return {
      info: `vs ${carNum(other)} ${carName(other, "short")}`,
      body: (
        <>
          <table className="tt sc">
            <thead><tr><th /><th className="n">Lap</th><th className="n">S1</th><th className="n">S2</th><th className="n">S3</th></tr></thead>
            <tbody>{block("last", "Last lap")}{block("best", "Best lap")}</tbody>
          </table>
          <div className="sc-int">
            {hist.length ? (
              <>
                <div className="lbl">{ahead ? "Your interval to it, last 5 laps, oldest first" : `${carNum(other)}'s interval to the car ahead, last 5 laps, oldest first`}</div>
                <div className="sub">
                  {h5.map((v, j) => <span key={j}>L{(ahead ? mine : other).laps - h5.length + j + 1} <b className="n">{fmtRel(v)}</b><span className="u"> s</span></span>)}
                  <Spark values={h5} fmt={(v) => (v / 1000).toFixed(1)} />
                </div>
              </>
            ) : null}
          </div>
        </>
      ),
    };
  },
  // The title follows what is compared against, unless the template gave the module its own.
});

// ---------- session ----------
export const session = defineModule({
  type: "session", title: "Session", group: "Timing", blurb: "Car, class, track, session, time left and conditions.",
  size: { w: 4, h: 7, minW: 3, minH: 5 }, needs: ["reading", "field", "entries", "tick"], requires: ["reading"],
  view({ ctx: c }) {
    const f = c.r!.fixed, s = c.r!.session, len = c.entries?.track?.length_m || f.track_length_m, st = c.st;
    const ph = fieldOn(c) && c.field!.phase != null ? PHASES[c.field!.phase] : "";
    const tot = s.total_laps > 0 ? " / " + s.total_laps : st && st.laps_to_go != null ? ` / ≈${s.completed_laps + st.laps_to_go}` : "";
    const tod = s.clock_s != null && isFinite(s.clock_s) ? `${String(Math.floor(s.clock_s / 3600) % 24).padStart(2, "0")}:${String(Math.floor((s.clock_s % 3600) / 60)).padStart(2, "0")}` : NONE;
    return {
      body: (
        <Kv rows={[
          ["Car", String(f.car_model || NONE).replace(/_/g, " ")], ["Class", f.car_class || NONE],
          ["Track", <>{f.track || NONE}{len ? <span className="u"> {(len / 1000).toFixed(3)} km</span> : null}</>],
          ["Session", <>{s.kind || NONE}{ph ? <span className="u"> · {ph}</span> : null}</>],
          ["Time left", fmtClock(s.session_time_left_ms)], ["Lap", `${nf(s.lap_number != null ? s.lap_number : s.completed_laps + 1, 0)}${tot}`],
          ["Timed race", f.is_timed_race ? "yes" + (f.has_extra_lap ? " + extra lap" : "") : "no"], ["Online", f.is_online ? "yes" : "no"], ["Time of day", tod],
          ["Fuel rate", "×" + nf(f.fuel_rate, 1)], ["Tyre rate", "×" + nf(f.tyre_rate, 1)],
        ]} />
      ),
    };
  },
});

// ---------- flags and penalties ----------
const GF: [string, string, string][] = [["yellow", "Y", "yellow"], ["y1", "S1", "yellow"], ["y2", "S2", "yellow"], ["y3", "S3", "yellow"], ["white", "White", "white"], ["green", "Green", "green"], ["chequered", "Chequered", "chequered"], ["red", "Red", "red"]];

export const flags = defineModule({
  type: "flags", title: "Flags & penalties", group: "Timing", blurb: "The flag the driver sees, sector yellows, and any penalty to serve.",
  size: { w: 4, h: 6, minW: 3, minH: 4 }, needs: ["reading", "summary"], requires: ["reading"],
  view({ ctx: c }) {
    const s = c.r!.session, f = FLAGS[s.flag] ?? "none", gf = s.global_flags ?? {}, pen = s.penalty | 0, sp = c.s?.penalty;
    const on = GF.filter(([k]) => gf[k]);
    const P = PENALTIES[pen] ?? ["?", "unknown penalty"];
    return {
      info: s.track_status || "",
      alert: [pen ? 2 : gf.y1 || gf.y2 || gf.y3 || gf.yellow || f === "yellow" ? 1 : 0],
      body: (
        <>
          <div className="fl-main">{f === "none" ? <b className="s-dim">No flag for the driver</b> : <><span className="flag big-flag" data-flag={f} /><b>{f.toUpperCase()}</b></>}</div>
          <div className="fl-glob">
            {on.length ? on.map(([k, l, fl]) => <span className="chip on" key={k}><span className="flag" data-flag={fl} />{l}</span>) : <span className="chip"><span className="flag" data-flag="green" />Track clear</span>}
          </div>
          <div className="fl-pen">
            {pen ? (
              <>
                <b className="tag pen">{P[0]}</b> {P[1]}{s.penalty_time_s > 0 ? ` · ${nf(s.penalty_time_s, 0)} s` : ""}
                {sp && sp.laps_left != null ? <> · <b className="s-bad">serve within {plural(sp.laps_left, "lap")}</b></> : null}
              </>
            ) : <span className="note">No penalty.</span>}
          </div>
        </>
      ),
    };
  },
});

// ---------- stint rules ----------
export const rules = defineModule({
  type: "rules", title: "Stint rules", group: "Timing", blurb: "Mandatory stops, the pit window and the driver stint limits.",
  size: { w: 3, h: 4, minW: 3, minH: 4 }, needs: ["reading", "summary"], requires: ["reading"],
  view({ ctx: c }) {
    const s = c.r!.session, st = c.st, ml = st ? st.mandatory_left : null, w = st?.pit_window, lap = s.lap_number || s.completed_laps + 1;
    const mand = ml === 0 ? <span className="s-ok">done ●</span> : ml > 0 ? <span className="s-warn">{ml} left</span> : s.kind !== "Race" ? <span className="note">none outside races</span> : <span className="note">unknown: set in Settings</span>;
    const win = !w ? NONE : s.kind !== "Race" ? <span className="note">races only</span> : <>L{w.open_lap}–L{w.close_lap} <span className="note">{lap < w.open_lap ? `opens in ${plural(w.open_lap - lap, "lap")}` : lap <= w.close_lap ? "open" : "closed"} · {w.src === "config" ? "set" : "ACC"}</span></>;
    const left = s.session_time_left_ms;
    const lim = (ms: number | null | undefined) => ms == null || !isFinite(ms) ? NONE : ms < 0 ? "no limit" : left > 0 && ms >= left ? <span className="note">past the flag</span> : fmtClock(ms);
    return {
      alert: [c.s && (c.s.advice ?? []).some((a: { id: string }) => a.id === "window_closing") ? 1 : 0],
      body: <Kv rows={[["Mandatory stops", mand], ["Pit window", win], ["Driver stint left", lim(s.stint_time_left_ms)], ["Driver total left", lim(s.stint_total_time_left_ms)]]} />,
    };
  },
});

// ---------- one big number ----------
const KPI_CHOICES: [string, string][] = [["session", "Session"], ["left", "Time left"], ["lap", "Lap"], ["pos", "Position"], ["ahead", "Gap ahead"], ["behind", "Gap behind"], ["last", "Last lap"],
  ["best", "Best lap"], ["delta", "Live Δ"], ["fuel", "Fuel"], ["stint", "Stint"], ["flag", "Flag"], ["temps", "Track / air"], ["grip", "Grip"], ["rain", "Rain"],
  ["penalty", "Penalty"], ["stintTime", "Driver stint"], ["boxIn", "Box in"], ["gear", "Gear"], ["speed", "Speed"], ["fuelL", "Fuel litres"]];

export const bigNumber = defineModule({
  type: "kpi", title: "Big number", group: "Timing", blurb: "One figure, large: for a driver-facing or second screen.",
  size: { w: 2, h: 3, minW: 2, minH: 2 }, needs: ["reading", "summary", "field"],
  options: [{ key: "metric", label: "Figure", type: "select", choices: KPI_CHOICES, def: "pos" }, { key: "label", label: "Label (empty = the figure's name)", type: "text", def: "" }],
  view({ ctx: c, opts }) {
    const p = usePrefs();
    const m = opts.metric as string, car = c.r?.car;
    const [l, v]: [string, ReactNode] = m === "gear" ? ["Gear", !car ? NONE : car.gear < 0 ? "R" : car.gear === 0 ? "N" : String(car.gear)]
      : m === "speed" ? ["Speed", car ? <>{fv("speed", car.speed_kmh, p.units)}<span className="u"> {unit("speed", p.units).u}</span></> : NONE]
      : m === "fuelL" ? ["Fuel", car ? <>{nf(car.fuel_litres, 1)}<span className="u"> L</span></> : NONE]
      : kpiCell(m as KpiId, c, p, null);
    return { body: <><div className="lbl">{opts.label || l}</div><div className="big xl">{v}</div></> };
  },
});

