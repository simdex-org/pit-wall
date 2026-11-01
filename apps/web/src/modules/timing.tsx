import { Fragment, ReactNode, useLayoutEffect, useRef, useState } from "react";
import { defineModule } from "../engine/registry";
import type { Ctx } from "../feed/store";
import type { Car } from "../feed/types";
import { carName } from "../lib/cars";
import { FLAGS, PENALTIES, PHASES } from "../lib/enums";
import { clamp, fmtClock, fmtDelta, fmtGap, fmtLap, fmtRel, fmtSector, MINUS, nf, NONE, okMs, plural } from "../lib/format";
import { fv, unit } from "../lib/units";
import { editor } from "../state/editor";
import { KpiId, usePrefs } from "../state/prefs";
import { cell as kpiCell } from "../shell/KpiStrip";
import { CarTr, carNum, carTitle, driver, fieldOn, sortedCars, Spark, useRowCursor } from "./cars";
import { Delta } from "./delta";

const R = ({ k, children, cls }: { k: ReactNode; children: ReactNode; cls?: string }) => <div className="r"><span>{k}</span><span className={cls}>{children}</span></div>;

// ---------- standings ----------
const SCOLS: [string, string][] = [["car", "Car"], ["cup", "Cup"], ["laps", "Laps"], ["gap", "Gap"], ["int", "Int"], ["last", "Last"], ["best", "Best"], ["sectors", "S1–S3 of the last lap"],
  ["pits", "Pits"], ["stint", "Stint"], ["net", "Net position"], ["deltaMe", "Δ to my best"]];
/** Dropped first when the width runs out; gap and position stay. */
const DROP_ORDER = ["car", "sectors", "deltaMe", "best", "stint", "pits", "net", "last", "int"];

const dash = <>{NONE}</>;

/** The last-lap cell: ◆ session best (purple), ● personal best (green), struck through when invalid. */
function LapCell({ x, sb }: { x: Car; sb: number | undefined }) {
  const v = x.last;
  if (!okMs(v)) return dash;
  if (x.last_valid === false) return <span className="iv">{fmtLap(v)}</span>;
  // The personal-best mark waits for a few laps: early on nearly every lap is the car's best.
  if (v === sb) return <span className="b">◆ {fmtLap(v)}</span>;
  if (v === x.best && (x.laps ?? 0) >= 3) return <span className="p">● {fmtLap(v)}</span>;
  return <>{fmtLap(v)}</>;
}

function SectorCell({ x, k, bestS }: { x: Car; k: number; bestS: number[] }) {
  const v = (x.last_s ?? [])[k];
  if (!okMs(v)) return dash;
  if (v === bestS[k]) return <span className="b">◆ {fmtSector(v)}</span>;
  if (v === (x.best_s ?? [])[k] && x.laps >= 3) return <span className="p">● {fmtSector(v)}</span>;
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
    const fit = Math.max(1, Math.floor((body?.clientHeight ?? 400) / (parseFloat(getComputedStyle(wrap.current ?? document.body).getPropertyValue("--row")) || 24)) - 1);
    const k = rows.indexOf(mine);
    let lo = Math.max(0, k - o.around), hi = Math.min(rows.length, k + o.around + 1);
    const used = () => hi - lo + (lo > 0 ? 1 : 0) + (lo > 1 ? 1 : 0);
    for (let t = 0; used() < fit && (lo > 0 || hi < rows.length); t++) { if (t % 2 ? lo > 0 : hi >= rows.length) lo--; else hi++; }
    show = (lo > 0 ? [rows[0]!] : []).concat(lo > 1 ? [null as unknown as Car] : [], rows.slice(lo, hi));
  }

  const cols = o.cols.filter((k) => SCOLS.some(([id]) => id === k) && (k !== "net" || net) && !drop.set.includes(k));
  const wkey = `${wrap.current?.parentElement?.clientWidth ?? 0}|${o.cols.join()}`;

  // Columns that do not fit are dropped, least useful first.
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
  const ncol = 3 + cols.reduce((n, k) => n + (k === "sectors" ? 3 : 1), 0);
  const head: Record<string, ReactNode> = {
    car: <th className="l">Car</th>, cup: <th className="l">Cup</th>, laps: <th>Laps</th>,
    gap: <th>{race ? "Gap" : "To P1"}</th>, int: <th>{race ? "Int" : "To next"}</th>,
    last: <th>Last</th>, best: <th>Best</th>,
    sectors: <><th>S1</th><th>S2</th><th>S3</th></>,
    pits: <th>Pits</th>, stint: <th>Stint</th>, net: <th>Net</th>, deltaMe: <th title="My best minus theirs">Δ me</th>,
  };
  const body = (k: string, x: Car): ReactNode => {
    switch (k) {
      case "car": return <td className="l mu" title={x.model_name}>{x.model_name || NONE}</td>;
      case "cup": return <td className="l">{x.cup_name ? <span className="tag fx n" style={{ "--tw": "48px" } as React.CSSProperties}>{x.cup_name.toUpperCase()}</span> : NONE}</td>;
      case "laps": return <td>{nf(x.laps, 0)}</td>;
      case "gap": return <td>{x.pos === 1 ? NONE : gapF(x.gap, x.gap_laps)}</td>;
      case "int": return <td className="mu">{x.pos === 1 ? NONE : gapF(x.int, x.int_laps)}</td>;
      case "last": {
        const inLap = x.last_pit_lap != null && x.laps === x.last_pit_lap + 1; // a slow in-lap, not a slow flying lap
        return <td><LapCell x={x} sb={sb} />{x.last_valid === false && okMs(x.last) ? <> <b className="tag n">INV</b></> : null}{okMs(x.last) && inLap ? <> <b className="tag n">IN</b></> : null}</td>;
      }
      case "best": return <td>{okMs(x.best) ? (x.best === sb ? <span className="b">◆ {fmtLap(x.best)}</span> : fmtLap(x.best)) : NONE}</td>;
      case "sectors": return <>{[0, 1, 2].map((i) => <td key={i}><SectorCell x={x} k={i} bestS={bestS} /></td>)}</>;
      case "pits": return <td>{nf(x.pits, 0)}</td>;
      case "stint": return <td className="mu">{nf(x.i === c.me && c.s ? c.s.stint_laps : x.stint_laps, 0)}</td>;
      case "net": return <td>P{x.net}{x.net! < x.pos ? <> <span className="dn">(+{x.pos - x.net!})</span></> : x.net! > x.pos ? <> <span className="up">({MINUS}{x.net! - x.pos})</span></> : null}</td>;
      case "deltaMe": return <td>{x.i === c.me || !mine || !okMs(mine.best) || !okMs(x.best) ? NONE : <Delta ms={mine.best - x.best} />}</td>;
    }
    return null;
  };

  return (
    <div ref={wrap}>
      <table className="t">
        <thead><tr><th>P</th><th>#</th><th className="l">Driver</th>{cols.map((k) => <Fragment key={k}>{head[k]}</Fragment>)}</tr></thead>
        <tbody>
          {show.map((x, n) => x == null ? (
            <tr className="gaprow" key={"gap" + n}><td colSpan={ncol} className="di">⋯</td></tr>
          ) : (
            <CarTr key={x.i} car={x} c={c} cursor={cursor} p={mine && x !== mine && o.around > 0 ? (n === 0 && x.pos === 1 ? 2 : 3 + Math.abs(rows.indexOf(x) - rows.indexOf(mine))) : undefined}>
              <td className="mu">{cup ? x.cpos : x.pos}</td>
              <td>{x.num}</td>
              <td className="l" title={carTitle(x)}>{driver(x, o.names)}{x.i === c.me ? <> <b className="tag me">YOU</b></> : null}{x.loc !== "track" && x.loc !== "none" ? <> <b className="tag wn">PIT</b></> : x.out ? <> <b className="tag n">OUT</b></> : null}{x.class && mine && x.class !== mine.class ? <> <b className="tag n" title="Another class">{x.class}</b></> : null}</td>
              {cols.map((k) => <Fragment key={k}>{body(k, x)}</Fragment>)}
            </CarTr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const standings = defineModule({
  type: "standings", title: "Standings", group: "Timing", blurb: "The whole field: positions, gaps, laps and pit stops.",
  size: { w: 7, h: 16, minW: 4, minH: 6 }, needs: ["field", "entries", "focus"], requires: ["field"], rate: 4,
  options: [
    { key: "scope", label: "Show", type: "select", choices: [["all", "All cars"], ["cup", "My cup category"]], def: "all" },
    { key: "cols", label: "Columns", type: "multi", choices: SCOLS, def: ["cup", "gap", "int", "last", "best", "pits", "stint"] },
    { key: "around", label: "Rows around me (0 = all)", type: "number", min: 0, max: 20, step: 1, def: 0 },
    { key: "names", label: "Names", type: "select", choices: [["short", "A. Mori"], ["full", "Aiko Mori"], ["last", "Mori"]], def: "short" },
  ],
  view({ ctx: c, opts, id, size }) {
    const o = opts as StdOpts;
    const mine = c.me != null ? c.cars.get(c.me) : undefined;
    const cup = o.scope === "cup" && !!mine;
    let rows = sortedCars(c);
    if (cup) rows = rows.filter((x) => x.cup === mine!.cup).sort((a, b) => a.cpos - b.cpos);
    const nav = useRowCursor(rows.map((x) => x.i));
    if (!rows.length) return { state: { kind: "empty", msg: "Waiting for the field." } };
    const ss = c.r?.session, lap = ss ? (ss.lap_number != null ? ss.lap_number : ss.completed_laps + 1) : null;
    const tot = ss && ss.total_laps > 0 ? ` / ${ss.total_laps}` : c.st && c.st.laps_to_go != null && ss ? ` / ≈${ss.completed_laps + c.st.laps_to_go}` : "";
    const wide = size.w >= 6;
    const flag = ss ? FLAGS[ss.flag] : undefined;
    const set = (scope: string) => editor.setOpt((m) => { m.options = { ...m.options, scope }; }, id);
    return {
      flush: true,
      info: [lap != null ? `LAP ${lap}${tot}` : "", o.around > 0 && !wide ? `±${o.around} AROUND ME` : `${rows.length} CARS`, wide && flag && flag !== "none" ? flag.toUpperCase() : wide ? "GREEN" : ""],
      headExtra: wide && mine ? (
        <div className="seg">
          <button type="button" aria-pressed={!cup} onClick={() => set("all")}>ALL</button>
          <button type="button" aria-pressed={cup} onClick={() => set("cup")}>CUP</button>
        </div>
      ) : null,
      onKey: nav.onKey,
      body: <StandingsTable c={c} o={o} rows={rows} cup={cup} mine={mine} race={c.mode !== "best"} cursor={nav.cursor} />,
    };
  },
});

// ---------- relative ----------
/** The gap to each car when you last crossed the line: the trend is how it moved over this lap. */
function useLapTrend(c: Ctx, mine: Car | undefined): Map<number, number> {
  const snap = useRef<{ lap: number; rel: Map<number, number> }>({ lap: -1, rel: new Map() });
  const prev = useRef<Map<number, number>>(new Map());
  if (mine && snap.current.lap !== mine.laps) {
    prev.current = snap.current.rel;
    snap.current = { lap: mine.laps, rel: new Map([...c.cars.values()].filter((x) => x.rel != null && isFinite(x.rel)).map((x) => [x.i, x.rel!])) };
  }
  const out = new Map<number, number>();
  for (const x of c.cars.values()) {
    const a = prev.current.get(x.i);
    if (a == null || x.rel == null || !isFinite(x.rel) || Math.sign(a) !== Math.sign(x.rel)) continue;
    out.set(x.i, Math.abs(x.rel) - Math.abs(a));
  }
  return out;
}

export const relative = defineModule({
  type: "relative", title: "Relative", group: "Timing", blurb: "The cars nearest to you on track, ahead and behind, in seconds.",
  size: { w: 3, h: 8, minW: 3, minH: 5 }, needs: ["field", "entries", "reading", "focus"], requires: ["reading"], rate: 4,
  options: [{ key: "rows", label: "Cars each side", type: "number", min: 2, max: 5, step: 1, def: 3 }, { key: "cls", label: "Class tags", type: "toggle", def: true }],
  view({ ctx: c, opts, size }) {
    const mine = c.me != null ? c.cars.get(c.me) : undefined;
    const trend = useLapTrend(c, mine);
    const others = [...c.cars.values()].filter((x) => x.i !== c.me && x.rel != null && isFinite(x.rel));
    const rowPx = size.w >= 5 ? 27 : 21, N = Math.max(1, Math.min(opts.rows as number, Math.floor(((size.h * 28 - 48) / rowPx - 1) / 2))); // what fits the module, never more than asked
    const ahead = others.filter((x) => x.rel! > 0).sort((a, b) => a.rel! - b.rel!).slice(0, N).reverse();
    const behind = others.filter((x) => x.rel! < 0).sort((a, b) => b.rel! - a.rel!).slice(0, N);
    const fcar = c.focusCar;
    const pin = fcar && fcar.i !== c.me && !ahead.includes(fcar) && !behind.includes(fcar) && fcar.rel != null && isFinite(fcar.rel) ? fcar : null;
    const order = ahead.concat(mine ? [mine] : [], behind, pin ? [pin] : []).map((x) => x.i);
    const nav = useRowCursor(order);
    const ss = c.r!.session;
    if (!fieldOn(c) || !mine) {
      // Field timing off: what shared memory knows, without names.
      return {
        info: "FIELD OFF", flush: true, body: (
          <table className="t">
            <thead><tr><th className="l">Car</th><th>Gap</th></tr></thead>
            <tbody>
              <tr><td className="l mu">Car ahead</td><td>{ss.gap_ahead_ms > 0 ? fmtRel(ss.gap_ahead_ms) : NONE}</td></tr>
              <tr className="own"><td className="l">You · P{nf(ss.position, 0)}</td><td>{NONE}</td></tr>
              <tr><td className="l mu">Car behind</td><td>{ss.gap_behind_ms > 0 ? fmtRel(ss.gap_behind_ms) : NONE}</td></tr>
            </tbody>
          </table>
        ),
      };
    }
    const large = size.w >= 3 && size.h >= 7;
    const myD = mine.laps + mine.spl;
    const lapRel = (x: Car) => {
      const f = ((x.spl - mine.spl + 1.5) % 1) - 0.5, k = Math.round(x.laps + x.spl - myD - f);
      return k > 0 ? <b className="tag n">+{k}L</b> : k < 0 ? <b className="tag n">{MINUS}{-k}L</b> : null;
    };
    return {
      flush: true,
      info: large ? "TRACK ORDER" : `±${N}`,
      onKey: nav.onKey,
      body: (
        <table className="t">
          <thead><tr>{large ? <th>P</th> : null}<th>#</th><th className="l">Driver</th><th>Gap</th><th>Trend</th></tr></thead>
          <tbody>
            {ahead.concat([mine], behind, pin ? [pin] : []).map((x) => {
              const t = trend.get(x.i), isAhead = (x.rel ?? 0) > 0;
              return (
                <Fragment key={x.i}>
                {x === pin ? <tr className="gaprow"><td colSpan={large ? 5 : 4} className="di">⋯</td></tr> : null}
                <CarTr car={x} c={c} cursor={nav.cursor}>
                  {large ? <td className="mu">{x.pos}</td> : null}
                  <td>{c.focus === x.i ? "▶ " : ""}{x.num}</td>
                  <td className="l" title={carTitle(x)}>
                    {driver(x)}{x.i === c.me ? <> <b className="tag me">YOU</b></> : null}{x.i === c.me ? null : lapRel(x)}
                    {opts.cls && x.class && x.class !== mine.class ? <> <b className="tag n">{x.class}</b></> : null}
                  </td>
                  <td>{x.i === c.me ? "0.000" : (Math.abs(x.rel!) / 1000).toFixed(3)}</td>
                  <td className={t == null || Math.abs(t) < 20 ? "" : (t < 0) === isAhead ? "dn" : "up"}>{x.i === c.me || t == null || Math.abs(t) < 20 ? "" : `${t < 0 ? "▼" : "▲"} ${(Math.abs(t) / 1000).toFixed(2)}`}</td>
                </CarTr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      ),
    };
  },
});

// ---------- battle ----------
const series = (hist: (number | null | undefined)[] | undefined, gap: number | null | undefined, gl: number): number[] =>
  (hist ?? []).filter((v): v is number => v != null && isFinite(v)).concat(!(gl > 0) && gap != null && isFinite(gap) ? [gap] : []);

/** ms per lap the interval moves; negative means it is closing. */
const rateOf = (h: number[]): number | null => (h.length < 2 ? null : (h[h.length - 1]! - h[0]!) / (h.length - 1));

function Line({ h, col }: { h: number[]; col: string }) {
  if (h.length < 2) return null;
  const lo = Math.min(...h), hi = Math.max(...h), W = 262, H = 34;
  const pts = h.map((v, i) => `${((i * W) / (h.length - 1)).toFixed(1)},${(H - 2 - (H - 6) * (hi > lo ? (v - lo) / (hi - lo) : 0.5)).toFixed(1)}`).join(" ");
  return <svg className="ln" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Interval over the last laps"><path className="gl" d={`M0 ${H - 0.5}H${W}`} /><polyline className="tr" stroke={col} points={pts} vectorEffect="non-scaling-stroke" /></svg>;
}

function BattleCell({ label, car, gap, gl, hist, large, better }: { label: "Ahead" | "Behind"; car: Car | undefined; gap: number | null | undefined; gl: number; hist: (number | null | undefined)[] | undefined; large: boolean; better: boolean }) {
  if (!car) return <div className="c"><span className="lab">{label}</span><span className="mu">{label === "Ahead" ? "Leading." : "Last car."}</span></div>;
  const h = series(hist, gap, gl), rate = rateOf(h), shown = rate != null && Math.abs(rate) >= 20;
  // closing is good for the car ahead of you, bad for the car behind
  const closing = rate != null && rate < 0, good = shown && (closing === (label === "Ahead"));
  const trend = shown ? <span className={"v " + (good ? "dn" : "up")}>{closing ? "▼" : "▲"} {(Math.abs(rate!) / 1000).toFixed(2)} /lap</span> : null;
  void better;
  if (!large) return <div className="c"><span className="lab">{label} {carNum(car)}</span><span className="big">{gl > 0 ? plural(gl, "lap") : fmtRel(gap).replace(/^[+−-]/, "")}</span>{trend}</div>;
  return (
    <div className="c">
      <div className="fb"><span className="lab">{label}</span><span className="tag n">{carNum(car)}</span></div>
      <span className="mu">{driver(car)}</span>
      <div className="f" style={{ alignItems: "flex-end", gap: 10 }}><span className="big">{gl > 0 ? plural(gl, "lap") : fmtRel(gap).replace(/^[+−-]/, "")}</span>{trend}</div>
      <Line h={h} col={label === "Ahead" ? "var(--ac)" : "var(--warn)"} />
    </div>
  );
}

export const battle = defineModule({
  type: "battle", title: "Battle", group: "Timing", blurb: "The car ahead and the car behind: interval and whether it is closing.",
  size: { w: 4, h: 6, minW: 3, minH: 5 }, needs: ["field", "entries", "focus", "reading"], rate: 2,
  view({ ctx: c, size }) {
    if (c.mode === "best") return { state: { kind: "empty", msg: "Battles are tracked in races only." } };
    const ss = c.r?.session;
    const fc = c.focusCar;
    if (!fieldOn(c) || !fc) {
      return {
        info: "FIELD OFF", flush: true, body: (
          <div className="cells" style={{ height: "100%" }}>
            <div className="c"><span className="lab">Car ahead</span><span className="big">{ss && ss.gap_ahead_ms > 0 ? fmtRel(ss.gap_ahead_ms) : NONE}</span></div>
            <div className="c"><span className="lab">Car behind</span><span className="big">{ss && ss.gap_behind_ms > 0 ? fmtRel(ss.gap_behind_ms) : NONE}</span></div>
          </div>
        ),
      };
    }
    const list = sortedCars(c), A = list.find((x) => x.pos === fc.pos - 1), B = list.find((x) => x.pos === fc.pos + 1);
    const large = size.w >= 4 && size.h >= 6;
    const away = fc.i !== c.me && fc.rel != null && isFinite(fc.rel) ? `YOU ${(Math.abs(fc.rel) / 1000).toFixed(3)} ${fc.rel > 0 ? "BEHIND" : "AHEAD"}` : "";
    return {
      flush: true,
      info: large ? [`${carNum(fc)} · P${fc.pos}`, away] : fc.i === c.me ? `P${fc.pos}` : [`${carNum(fc)} · P${fc.pos}`, away],
      body: (
        <div className="cells" style={{ height: "100%" }}>
          <BattleCell label="Ahead" car={A} gap={fc.int} gl={fc.int_laps} hist={fc.int_hist} large={large} better />
          <BattleCell label="Behind" car={B} gap={B?.int} gl={B?.int_laps ?? 0} hist={B?.int_hist} large={large} better={false} />
        </div>
      ),
    };
  },
});

// ---------- pit lane ----------
interface Seen { t: number; partial: boolean }
const NOW: Record<string, [string, string]> = { pit: ["IN BOX", "wn"], entry: ["IN LANE", "wn"], exit: ["IN LANE", "wn"] };

export const pitActivity = defineModule({
  type: "pit-activity", title: "Pit lane", group: "Timing", blurb: "Who is in the pit lane now, and every car's stops so far.",
  size: { w: 4, h: 8, minW: 3, minH: 5 }, needs: ["field", "entries"], requires: ["field"], rate: 2,
  view({ ctx: c, size }) {
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
    const large = size.w >= 4 && size.h >= 7;
    const now = list.filter((x) => x.loc === "pit" || x.loc === "entry" || x.loc === "exit");
    const stops = list.reduce((a, x) => a + (x.pits || 0), 0);
    // The small module lists only who is in the lane; the large one the cars that are in it first, then those that have stopped.
    const rows = large ? now.concat(list.filter((x) => !now.includes(x) && (x.pits ?? 0) > 0).sort((a, b) => (b.last_pit_lap ?? 0) - (a.last_pit_lap ?? 0) || a.pos - b.pos)) : now;
    const nav = useRowCursor(rows.map((x) => x.i));
    if (!rows.length) return { state: { kind: "empty", msg: "Nobody in the pit lane now, and no stops in the field yet." } };
    return {
      flush: true,
      info: [`${now.length} IN LANE`, large ? `${stops} STOPS SO FAR` : ""],
      onKey: nav.onKey,
      body: (
        <table className="t">
          <thead><tr><th>#</th><th className="l">Driver</th><th className="l">Now</th><th>In lane</th>{large ? <><th>Stops</th><th>Last box</th></> : null}</tr></thead>
          <tbody>
            {rows.map((x) => {
              const e = seen.get(x.i), n = NOW[x.loc];
              return (
                <CarTr key={x.i} car={x} c={c} cursor={nav.cursor}>
                  <td>{x.num}</td>
                  <td className="l" title={carTitle(x)}>{driver(x)}</td>
                  <td className="l"><span className={"tag fx " + (n ? n[1] : "n")} style={{ "--tw": "72px" } as React.CSSProperties}>{n ? n[0] : "ON TRACK"}</span></td>
                  <td>{e ? <>{e.partial ? "≥ " : ""}{fmtClock(Math.max(0, F.t - e.t)).replace(/^0:/, "0:")}</> : NONE}</td>
                  {large ? <><td>{nf(x.pits, 0)}</td><td className="mu">{x.lane_ms ? `0:${nf(x.lane_ms / 1000, 1).padStart(4, "0")}` : NONE}</td></> : null}
                </CarTr>
              );
            })}
          </tbody>
        </table>
      ),
    };
  },
});

// ---------- you vs the focus car ----------
export const sectorCompare = defineModule({
  type: "sector-compare", title: "You vs focus", group: "Timing", blurb: "Your last and best lap against the focus car (or the car ahead), sector by sector.",
  size: { w: 4, h: 8, minW: 3, minH: 6 }, needs: ["field", "entries", "focus", "laps"], requires: ["field"], rate: 2,
  view({ ctx: c, size }) {
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
    // lap, S1, S2, S3 → the design's order S1, S2, S3, Lap
    const ord = [1, 2, 3, 0];
    const cellOf = (v: number | null | undefined, k: number, cls = "") => <td key={k} className={cls || undefined}>{!okMs(v) ? NONE : k === 3 ? fmtLap(v) : fmtSector(v)}</td>;
    const block = (k: "last" | "best", withBest: boolean) => (
      <Fragment key={k}>
        <tr className="own"><td className="l">You {k}</td>{ord.map((o, i) => cellOf(mineSet[k][o], i, k === "best" && withBest && okMs(mineSet[k][o]) && okMs(theirs[k][o]) && mineSet[k][o]! < theirs[k][o]! ? "p" : ""))}</tr>
        <tr><td className="l ac" title={carTitle(other)}>{carNum(other)} {k}</td>{ord.map((o, i) => cellOf(theirs[k][o], i))}</tr>
        <tr><td className="l mu">Δ {k}</td>{ord.map((o, i) => <td key={i}>{okMs(mineSet[k][o]) && okMs(theirs[k][o]) ? <Delta ms={mineSet[k][o]! - theirs[k][o]!} /> : NONE}</td>)}</tr>
      </Fragment>
    );
    const large = size.h >= 7;
    return {
      flush: true,
      info: [`${carNum(other)}${large ? " " + carName(other, "last").toUpperCase() : ""}`],
      body: (
        <table className="t">
          <thead><tr><th className="l" /><th>S1</th><th>S2</th><th>S3</th><th>Lap</th></tr></thead>
          <tbody>
            {block("last", false)}{large ? block("best", true) : null}
            {large ? (
              <tr><td className="l mu">Pits · stint</td><td colSpan={2}>You {nf(mine.pits, 0)} · {nf(c.s ? c.s.stint_laps : mine.stint_laps, 0)}</td><td colSpan={2}>{carNum(other)} {nf(other.pits, 0)} · {nf(other.stint_laps, 0)}</td></tr>
            ) : null}
          </tbody>
        </table>
      ),
    };
  },
});

// ---------- session ----------
export const session = defineModule({
  type: "session", title: "Session", group: "Timing", blurb: "Car, class, track, session, time left and conditions.",
  size: { w: 4, h: 7, minW: 3, minH: 5 }, needs: ["reading", "field", "entries", "tick"], requires: ["reading"],
  view({ ctx: c, size }) {
    const p = usePrefs();
    const f = c.r!.fixed, s = c.r!.session, a = c.r!.car, st = c.st, len = c.entries?.track?.length_m || f.track_length_m;
    const ph = fieldOn(c) && c.field!.phase != null ? PHASES[c.field!.phase] : "";
    const tot = s.total_laps > 0 ? " / " + s.total_laps : st && st.laps_to_go != null ? ` / ≈${s.completed_laps + st.laps_to_go}` : "";
    const lap = `${nf(s.lap_number != null ? s.lap_number : s.completed_laps + 1, 0)}${tot}`;
    const temps = a ? `${fv("temp", a.air_temp_c, p.units, 0)} · ${fv("temp", a.road_temp_c, p.units, 0)} ${unit("temp", p.units).u}` : NONE;
    const car = String(f.car_model || NONE).replace(/_/g, " "), track = f.track || NONE;
    const large = size.w >= 4 && size.h >= 6;
    const kind = String(s.kind || "").toUpperCase();
    return {
      info: [kind],
      body: large ? (
        <div className="g2" style={{ columnGap: 24 }}>
          <div>
            <R k="Car">{car}</R><R k="Class">{f.car_class || NONE}</R><R k="Track">{track}{len ? ` · ${(len / 1000).toFixed(3)} km` : ""}</R><R k="Session">{`${s.kind || NONE} · lap ${lap}`}</R>
          </div>
          <div>
            <R k="Time left">{fmtClock(s.session_time_left_ms)}</R><R k="Air · track">{temps}</R>
            <R k="Grip">{s.track_grip != null ? ["Green", "Fast", "Optimum", "Greasy", "Damp", "Wet", "Flooded"][s.track_grip] ?? NONE : NONE}</R>
            <R k="Rain" cls="cd">{Array.isArray(s.rain) ? `${["None", "Drizzle", "Light", "Medium", "Heavy", "Thunder"][s.rain[0]] ?? NONE}` : NONE}</R>
          </div>
        </div>
      ) : (
        <>
          <R k="Track">{track}</R><R k="Lap">{lap}</R><R k="Time left">{fmtClock(s.session_time_left_ms)}</R><R k="Air · track">{temps}</R>
        </>
      ),
    };
  },
});

// ---------- flags and penalties ----------
const GF: [string, string, string][] = [["yellow", "Y", "yellow"], ["y1", "S1", "yellow"], ["y2", "S2", "yellow"], ["y3", "S3", "yellow"], ["white", "White", "white"], ["green", "Green", "green"], ["chequered", "Chequered", "chequered"], ["red", "Red", "red"]];
const FLAG_COL: Record<string, string> = { none: "var(--ok)", green: "var(--ok)", yellow: "var(--warn)", blue: "var(--cold)", white: "var(--tx)", red: "var(--bad)", black: "var(--t3)", chequered: "var(--tx)", orange: "var(--warn)" };

export const flags = defineModule({
  type: "flags", title: "Flags and penalties", group: "Timing", blurb: "The flag the driver sees, sector yellows, and any penalty to serve.",
  size: { w: 4, h: 6, minW: 3, minH: 4 }, needs: ["reading", "summary"], requires: ["reading"],
  view({ ctx: c, size }) {
    const s = c.r!.session, f = FLAGS[s.flag] ?? "none", gf = s.global_flags ?? {}, pen = s.penalty | 0, sp = c.s?.penalty;
    const P = PENALTIES[pen] ?? ["?", "unknown penalty"];
    const large = size.w >= 4 && size.h >= 5;
    const word = f === "none" ? "GREEN" : f.toUpperCase();
    const col = FLAG_COL[f] ?? "var(--ok)";
    const penText = pen ? <>{P[0]} {P[1]}{s.penalty_time_s > 0 ? ` · ${nf(s.penalty_time_s, 0)} s` : ""}{sp && sp.laps_left != null ? <b className="up"> · serve within {plural(sp.laps_left, "lap")}</b> : null}</> : "none to serve";
    const sector = (k: string, y: boolean) => (
      <div className="fc" key={k} style={{ border: `1px solid ${y ? "var(--warn)" : "var(--ln)"}`, padding: 6 }}>
        <span className={"lab" + (y ? " wn" : "")}>{k.toUpperCase()}</span><span className={"v" + (y ? " wn" : "")}>{y ? "▲ yellow" : "clear"}</span>
      </div>
    );
    return {
      info: large ? ["SECTORS"] : [],
      alert: [pen ? 2 : gf.y1 || gf.y2 || gf.y3 || gf.yellow || f === "yellow" ? 1 : 0],
      body: large ? (
        <>
          <div className="f" style={{ gap: 16 }}>
            <div style={{ width: 44, height: 44, background: col, flex: "none" }} />
            <div className="fc"><span className="big" style={{ fontSize: 26 }}>{word}</span><span className="v mu">{f === "none" || f === "green" ? "Racing" : s.track_status || ""}</span></div>
            <div className="sp" />
            <div className="g3" style={{ gap: 6, width: 240 }}>{sector("s1", !!gf.y1)}{sector("s2", !!gf.y2)}{sector("s3", !!gf.y3)}</div>
          </div>
          <div className="hr" />
          <div className="fb"><span className="mu">Penalty</span><span className="v">{penText}</span></div>
        </>
      ) : (
        <div className="f" style={{ gap: 12 }}>
          <div style={{ width: 32, height: 32, background: col, flex: "none" }} />
          <span className="big" style={{ fontSize: 20 }}>{word}</span><div className="sp" />
          <span className="v mu">{pen ? penText : "No penalty"}</span>
        </div>
      ),
    };
  },
});

// ---------- stint rules ----------
/** The stint limit and the session clock are read a moment apart: a stint this close to the flag is not "past" it. */
const FLAG_SLACK = 60000;

export const rules = defineModule({
  type: "rules", title: "Stint rules", group: "Timing", blurb: "Mandatory stops, the pit window and the driver stint limits.",
  size: { w: 3, h: 4, minW: 3, minH: 4 }, needs: ["reading", "summary"], requires: ["reading"],
  view({ ctx: c }) {
    const s = c.r!.session, st = c.st, ml = st ? st.mandatory_left : null, w = st?.pit_window, lap = s.lap_number || s.completed_laps + 1;
    const total = s.total_laps > 0 ? s.total_laps : st && st.laps_to_go != null ? s.completed_laps + st.laps_to_go : 0;
    const left = s.session_time_left_ms;
    const lim = (ms: number | null | undefined) => ms == null || !isFinite(ms) ? null : ms < 0 ? "no limit" : left > 0 && ms > left + FLAG_SLACK ? "past the flag" : `${fmtClock(ms)} left`;
    const stint = lim(s.stint_time_left_ms);
    // The stint's full length is the most time it has had left since it began (it jumps back up after a stop); the bar is the share used.
    const top = useRef(0), sl: number = s.stint_time_left_ms;
    if (sl > top.current) top.current = sl;
    const used = sl >= 0 && top.current > 0 && !(left > 0 && sl > left + FLAG_SLACK) ? clamp((1 - sl / top.current) * 100, 0, 100) : 0;
    const win = !w || s.kind !== "Race" ? (s.kind !== "Race" ? "races only" : NONE) : lap < w.open_lap ? `opens lap ${w.open_lap} · closes lap ${w.close_lap}` : lap <= w.close_lap ? `open until lap ${w.close_lap}` : "closed";
    const done = ml === 0 ? "STOPS DONE" : ml != null && ml > 0 ? `${ml} STOP${ml > 1 ? "S" : ""} LEFT` : "";
    return {
      info: done,
      alert: [c.s && (c.s.advice ?? []).some((a: { id: string }) => a.id === "window_closing") ? 1 : 0],
      body: (
        <>
          <div className="fb"><span className="mu">Pit window</span><span className="v">{win}</span></div>
          <div className="bar tk ac"><i style={{ width: total && w ? clamp((lap / total) * 100, 0, 100) + "%" : "0%" }} /></div>
          <div className="fb"><span className="mu">Driver stint</span><span className="v">{stint ?? NONE}</span></div>
          <div className="bar tk"><i style={{ width: used + "%" }} /></div>
        </>
      ),
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
  view({ ctx: c, opts, size }) {
    const p = usePrefs();
    const m = opts.metric as string, car = c.r?.car;
    const [l, v]: [string, ReactNode] = m === "gear" ? ["Gear", !car ? NONE : car.gear < 0 ? "R" : car.gear === 0 ? "N" : String(car.gear)]
      : m === "speed" ? ["Speed", car ? <>{fv("speed", car.speed_kmh, p.units)}<span className="u">{unit("speed", p.units).u}</span></> : NONE]
      : m === "fuelL" ? ["Fuel", car ? <>{nf(car.fuel_litres, 1)}<span className="u">L</span></> : NONE]
      : kpiCell(m as KpiId, c, p, null);
    const label = (opts.label as string) || l;
    return size.h <= 2
      ? { flush: true, body: <div className="f" style={{ justifyContent: "space-between", alignSelf: "stretch", flex: 1, padding: "0 var(--pad)" }}><span className="lab">{label}</span><span className="big" style={{ fontSize: 28 }}>{v}</span></div> }
      : { body: <div className="fc" style={{ justifyContent: "center", flex: 1, gap: 8 }}><span className="lab">{label}</span><span className="big" style={{ fontSize: 34 }}>{v}</span></div> };
  },
});
