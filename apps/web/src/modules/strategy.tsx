import { ReactNode, useEffect, useRef, useState } from "react";
import { nextStop, useRacePlan } from "../state/racePlan";
import { defineModule } from "../engine/registry";
import type { Ctx } from "../feed/store";
import type { Json } from "../feed/types";
import { clamp, fmtLap, fmtRel, MINUS, nf, NONE, plural, signed } from "../lib/format";
import { GRIP, RAIN } from "../lib/enums";
import { carName } from "../lib/cars";
import { fuelState } from "../lib/states";
import { fv, fvu, unit } from "../lib/units";
import { useSize } from "../lib/useSize";
import { accessKey, post, say } from "../state/bridge";
import { usePrefs } from "../state/prefs";
import { planStore } from "../state/plan";
import { CarTr, fieldOn } from "./cars";
import { compass, forecast, tone } from "./weather";
import { Icon } from "../lib/icons";
import { slopePerMin, wxSample, WxSample } from "../state/wxlog";

const Litres = ({ v }: { v: number | null | undefined }) => <>{nf(v, 1)}<span className="u">L</span></>;
const R = ({ k, children, cls, p }: { k: ReactNode; children: ReactNode; cls?: string; p?: number }) => <div className="r" data-p={p}><span>{k}</span><span className={cls}>{children}</span></div>;
const CELLS = "cells h";
const isRace = (c: Ctx) => (c.r ? c.r.session.kind === "Race" : c.mode !== "best");
const fuelLow = (c: Ctx) => c.cfg?.fuel_low_laps ?? 3;

const KEY_MSG = "Needs the access key (Settings › Connection) to change shared values.";
const postMsg = (r: { status: number; text: string }) =>
  r.status === 200 ? "Saved for everyone watching this bridge." : r.status === 403 ? "Wrong or missing access key: Settings › Connection." : r.status === 0 ? r.text : "Refused: " + r.text;

/** Stop options, best first: the ones the fuel reaches, then fewest stops to the flag, then rejoin, then time lost. Race plan names the same first row. */
function rankOpts(st: Json | null): Json[] {
  return ((st?.options as Json[] | undefined) ?? []).slice().sort((a, b) =>
    Number(b.reach !== false) - Number(a.reach !== false) || (a.more_stops || 0) - (b.more_stops || 0)
    || Number(a.rejoin_pos == null) - Number(b.rejoin_pos == null) || (a.rejoin_pos || 0) - (b.rejoin_pos || 0) || a.loss_s - b.loss_s);
}

// ---------- fuel ----------
export const fuel = defineModule({
  type: "fuel", title: "Fuel", group: "Strategy", blurb: "Laps of fuel left, litres in the tank and consumption.",
  size: { w: 3, h: 5, minW: 3, minH: 5, maxW: 4, maxH: 6 }, needs: ["reading", "summary", "config"], requires: ["reading"],
  view({ ctx: c, size }) {
    const st = c.st, car = c.r!.car, fx = c.r!.fixed, lf = st?.laps_of_fuel;
    const fs = fuelState(lf, { th: c.th, wet: c.wet, fuelLowLaps: fuelLow(c) });
    const fpl = st?.fuel_per_lap || c.r!.session.fuel_per_lap;
    const max = fx.max_fuel > 0 ? fx.max_fuel : 0;
    const stint = (c.s?.stint as Json[] | undefined) ?? [];
    const lastL = stint.length ? stint[stint.length - 1]!.fuel : null;
    const spare = st?.spare_l ?? (st?.fuel_needed_l != null ? car.fuel_litres - st.fuel_needed_l : null);
    const large = size.h >= 6;
    const colour = fs === "bad" ? " up" : fs === "warn" ? " wn" : "";
    return {
      flush: true,
      alert: [fs === "bad" ? 2 : 0],
      info: large ? ["LAST 5 LAPS AVG"] : [],
      body: (
        <>
          <div className={CELLS}>
            <div className="c"><span className="lab">Laps left</span><span className={"big" + colour}>{nf(lf)}{fs === "bad" ? <b className="tag up" style={{ marginLeft: 6 }}>LOW</b> : null}</span></div>
            <div className="c"><span className="lab">In tank</span><span className="big">{nf(car.fuel_litres)}<span className="u">L</span></span></div>
            <div className="c"><span className="lab">Per lap</span><span className="big">{nf(fpl, 2)}<span className="u">L</span></span></div>
          </div>
          <div style={{ padding: "var(--pad)" }} hidden={!max} title={`Tick: ${fuelLow(c)} laps of fuel, the low-fuel warning`}>
            <div className={"bar tk tall " + (fs === "bad" ? "bd" : "ac")}><i style={{ width: max ? clamp((car.fuel_litres / max) * 100, 0, 100) + "%" : 0 }} /></div>
          </div>
          <div style={{ padding: "0 var(--pad) var(--pad)" }}>
            {spare != null ? <R k="To the flag" cls={spare < 0 ? "up" : undefined}>{spare >= 0 ? "+" : MINUS}{nf(Math.abs(spare), 1)} L</R> : null}
            {large && spare != null && fpl > 0 ? <R k="Margin" cls={spare < 0 ? "up" : "dn"}>{spare < 0 ? "▲ " : "▼ "}{nf(Math.abs(spare) / fpl, 1)} lap</R> : null}
            {large ? <R k="Last lap">{nf(lastL, 2)} L</R> : null}
          </div>
        </>
      ),
    };
  },
});

// ---------- fuel to the flag ----------
const SHARED = [
  { key: "reserve_laps", label: "Reserve laps", min: 0, max: 10, step: 0.1, ph: "" },
  { key: "laps_override", label: "Laps override", min: 1, max: 999, step: 1, ph: "auto" },
  { key: "mandatory_stops", label: "Mandatory stops", min: 0, max: 9, step: 1, ph: "ACC" },
] as const;

function SharedInputs({ cfg }: { cfg: Json | null }) {
  const S = cfg?.strategy as Json | undefined;
  const [vals, setVals] = useState<Record<string, string>>({});
  const edited = useRef(false);
  const [msg, setMsg] = useState("");
  const noKey = !accessKey.value;

  // The shared values show until the person starts typing; then they stay put.
  useEffect(() => {
    if (!S || edited.current) return;
    setVals(Object.fromEntries(SHARED.map((f) => [f.key, S[f.key] == null ? "" : String(S[f.key])])));
  }, [S]);

  const save = async () => {
    const int = (k: string) => (vals[k] === "" || vals[k] == null ? null : Math.round(+vals[k]!));
    setMsg("Saving…");
    const r = await post("/config", { strategy: { reserve_laps: +(vals.reserve_laps ?? 0) || 0, laps_override: int("laps_override"), mandatory_stops: int("mandatory_stops") } });
    setMsg(postMsg(r));
    if (r.status === 200) edited.current = false;
  };

  return (
    <details className="rp-in">
      <summary className="lbl">Shared inputs</summary>
      <div className="rp-g">
        {SHARED.map((f) => (
          <label className="rp-f" key={f.key}>
            <span>{f.label}</span>
            <input type="number" min={f.min} max={f.max} step={f.step} placeholder={f.ph} disabled={noKey} value={vals[f.key] ?? ""}
              onChange={(e) => { edited.current = true; setVals((v) => ({ ...v, [f.key]: e.target.value })); }} />
          </label>
        ))}
      </div>
      <div className="rp-acts"><button type="button" className="btn" disabled={noKey} onClick={save}>Save</button></div>
      <p className="note" role="status">{msg || (noKey ? KEY_MSG : "")}</p>
    </details>
  );
}

/** The race as one line, left to right from lap 0 to the flag. The legend under it says what each mark is. */
function RaceLine({ total, now, box, win, plan }: { total: number; now: number; box: number | null; win: { open_lap: number; close_lap: number } | null; plan: number[] }) {
  const W = 600, x = (lap: number) => Math.max(0, Math.min(W, (lap / total) * W));
  const marks: [number, string, string][] = [[now, "NOW", "var(--txt)"], ...(box != null && box > now ? [[box, (plan.length ? "FUEL " : "BOX ") + box, "var(--acc)"] as [number, string, string]] : []), [total, "FLAG", "var(--txt)"]];
  // Marks closer than a label is wide share one label, so they never print over each other.
  const labels: { at: number; anchor: "start" | "middle" | "end"; text: string; col: string }[] = [];
  let last = -Infinity;
  for (const [lap, label, col] of [...marks].sort((p, q) => p[0] - q[0])) {
    const g = labels[labels.length - 1];
    if (g && x(lap) - last < 64) { g.text += " · " + label; g.at = x(lap); g.col = col === "var(--acc)" ? col : g.col; } else labels.push({ at: x(lap), anchor: "middle", text: label, col });
    last = x(lap);
  }
  for (const g of labels) { g.at = Math.min(Math.max(g.at, 0), W); g.anchor = g.at > W - 60 ? "end" : g.at < 40 ? "start" : "middle"; }
  const wx = win ? x(win.open_lap) : 0, ww = win ? Math.max(2, x(win.close_lap) - wx) : 0;
  return (
    <>
      <svg className="rl" viewBox={`0 0 ${W + 14} 72`} role="img" aria-label={`Lap ${now} of ${total}${box != null ? `, box lap ${box}` : ""}${win ? `, pit window laps ${win.open_lap} to ${win.close_lap}` : ""}`}>
        <rect x="0" y="26" width={W} height="8" fill="var(--line)" />
        <rect x="0" y="26" width={x(now)} height="8" fill="var(--dim)" />
        {win ? <rect x={wx} y="23" width={ww} height="16" fill="none" stroke="var(--warn)" strokeWidth="1.5" strokeDasharray="4 2" /> : null}
        {marks.map(([lap, , col], i) => <path key={i} d={`M${x(lap)} 18V42`} stroke={col} strokeWidth="2" />)}
        {labels.map((g, i) => (
          <text key={i} x={g.at} y="13" textAnchor={g.anchor} style={{ fill: g.col, fontSize: 13, fontWeight: 600 }}>{g.text}</text>
        ))}
        {plan.filter((l) => l >= now && l < total).map((l, i) => (
          <g key={"p" + i}>
            <path d={`M${x(l)} 36L${x(l) - 5} 44H${x(l) + 5}Z`} fill="var(--me)" />
            <text x={x(l)} y="58" textAnchor="middle" style={{ fill: "var(--me)", fontSize: 12, fontWeight: 600 }}>PLAN {l}</text>
          </g>
        ))}
        <text x="0" y="70" style={{ fontSize: 12 }}>0</text>
        <text x={W} y="70" textAnchor="end" style={{ fontSize: 12 }}>{total}</text>
      </svg>
      <div className="rl-key" data-p="3">
        <span><i className="sw-done" />Laps done</span>
        {win ? <span><i className="sw-win" />Pit window <b>{win.open_lap}–{win.close_lap}</b></span> : null}
        {box != null && box > now ? <span><i className="sw-box" />{plan.length ? "Fuel lasts to" : "Fuel says box"} <b>lap {box}</b></span> : null}
        {plan.some((l) => l >= now && l < total) ? <span><i className="sw-plan" />Your race plan</span> : null}
      </div>
    </>
  );
}

export const racePlan = defineModule({
  type: "race-plan", title: "Fuel to the flag", group: "Strategy", blurb: "When to box and how much fuel to put in, from the bridge strategy.",
  size: { w: 4, h: 11, minW: 3, minH: 8, maxW: 6, maxH: 10 }, needs: ["summary", "reading", "config"], requires: ["summary"],
  view({ ctx: c, size }) {
    const st = c.st, mine = useRacePlan();
    if (!st) return { state: { kind: "empty", msg: "Waiting for the bridge strategy figures." } };
    const ss = c.r?.session, car = c.r?.car, w = st.pit_window;
    const lapNow = ss ? (ss.lap_number != null ? ss.lap_number : ss.completed_laps + 1) : null;
    const race = isRace(c), box = race && st.stops_needed > 0;
    const crit = box && (st.box_in_laps <= 0 || (st.box_by_lap != null && lapNow != null && st.box_by_lap < lapNow));
    const sev = Math.max(0, ...((c.s?.advice as Json[] | undefined) ?? []).filter((a) => /^fuel_(low|box|flag)$/.test(a.id)).map((a) => a.severity | 0));
    const large = size.h >= 9;
    const ns = nextStop(mine, ((c.s?.stops as Json[] | undefined) ?? []).length);
    // With a race plan the headline is the planned lap, as long as the fuel lasts to it; otherwise the fuel limit stays and says why.
    const planLap = race && box && ns && st.box_by_lap != null && ns.lap <= st.box_by_lap ? ns.lap : null, planLate = !!(race && box && ns && st.box_by_lap != null && ns.lap > st.box_by_lap);
    const total = lapNow != null && st.laps_to_go != null ? lapNow - 1 + Math.ceil(st.laps_to_go) : null;
    const fpl = st.fuel_per_lap || 0;
    // Stints: the ones done, this one to the box (or the flag), and the one after it.
    const stops = (c.s?.stops as Json[] | undefined) ?? [];
    const rows: { n: string; cls?: string; laps: string; start: ReactNode; end: ReactNode; rejoin: ReactNode }[] = [];
    let from = 1;
    stops.forEach((p, k) => { rows.push({ n: `${k + 1} · done`, cls: "dim", laps: `${from}–${p.lap}`, start: NONE, end: NONE, rejoin: NONE }); from = p.lap + 1; });
    if (race && lapNow != null && total != null && car) {
      const boxLap = box && st.box_by_lap != null ? Math.min(st.box_by_lap, total) : total;
      const end1 = car.fuel_litres - fpl * Math.max(0, boxLap - lapNow + 1);
      rows.push({ n: `${stops.length + 1} · now`, cls: "cur", laps: `${from}–${boxLap}`, start: <Litres v={car.fuel_litres} />, end: <Litres v={end1} />, rejoin: st.rejoin ? "P" + st.rejoin.pos : NONE });
      if (box && boxLap < total) {
        const start2 = st.add_at_box_l != null ? end1 + st.add_at_box_l : null;
        rows.push({ n: `${stops.length + 2}`, laps: `${boxLap + 1}–${total}`, start: <Litres v={start2} />, end: <Litres v={start2 != null ? start2 - fpl * (total - boxLap) : null} />, rejoin: NONE });
      }
    }
    return {
      flush: true,
      alert: [crit ? 2 : Math.min(2, sev)],
      info: lapNow != null && total != null ? [`LAP ${lapNow} / ${total}`] : [],
      body: (
        <>
          <div className={CELLS}>
            <div className="c"><span className="lab">{race ? (planLap ? "Box on lap · your plan" : planLate ? "Box on lap · fuel limit" : "Box on lap") : "Fuel lasts to lap"}</span><span className={"big" + (crit || planLate ? " up" : " ac")}>{crit ? "NOW" : planLap ?? (st.box_by_lap != null ? st.box_by_lap : NONE)}</span>
              {planLap ? <span className="v di" style={{ fontSize: 10.5 }}>fuel lasts to lap {st.box_by_lap}</span> : planLate ? <span className="v up" style={{ fontSize: 10.5 }}>plan says lap {ns!.lap}: too late</span> : null}</div>
            <div className="c"><span className="lab">Add</span><span className="big">{planLap ? nf(ns!.add, 1) : box && st.add_at_box_l != null ? nf(st.add_at_box_l, 1) : NONE}<span className="u">L</span></span></div>
            {large ? <div className="c"><span className="lab">Stops left</span><span className="big">{race ? nf(st.stops_needed, 0) : NONE}</span></div> : null}
          </div>
          {large && race && lapNow != null && total != null && total > 0 ? <div style={{ padding: "var(--pad) var(--pad) 0" }}><RaceLine total={total} now={lapNow} box={box ? st.box_by_lap : null} win={w ?? null} plan={mine ? mine.stints.filter((t) => t.add != null).map((t) => t.from - 1) : []} /></div> : null}
          {!large && total ? <div style={{ padding: "var(--pad)" }}><div className="bar tk ac"><i style={{ width: clamp(((lapNow ?? 0) / total) * 100, 0, 100) + "%" }} /></div></div> : null}
          {large && race && ns && box && st.box_by_lap != null ? <div className="v" style={{ padding: "0 var(--pad) 6px" }}><span style={{ color: "var(--me)" }}>Plan:</span> box lap {ns.lap}, add {nf(ns.add, 1)} L{ns.lap === st.box_by_lap ? " · same as the fuel" : ns.lap < st.box_by_lap ? ` · ${plural(st.box_by_lap - ns.lap, "lap")} before the fuel runs out` : <span className="up"> · {plural(ns.lap - st.box_by_lap, "lap")} after the fuel runs out</span>}</div> : null}
          {box && w && st.box_by_lap != null && st.box_by_lap < w.open_lap ? <div className="rl-warn"><b>▲ Fuel runs out first</b><span>The window only opens on lap {w.open_lap}.</span></div> : null}
          {large && rows.length ? (
            <table className="t" data-p="4">
              <thead><tr><th className="l">Stint</th><th>Laps</th><th>Start</th><th>End</th><th>Rejoin</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.n} className={r.cls}><td className="l">{r.n}</td><td>{r.laps}</td><td>{r.start}</td><td>{r.end}</td><td>{r.rejoin}</td></tr>)}</tbody>
            </table>
          ) : (
            <div style={{ padding: "var(--pad)" }}>
              <R k="Stops left">{nf(st.stops_needed, 0)}</R>
              {w ? <R k="Window">lap {w.open_lap}–{w.close_lap}</R> : null}
              <R k="Fuel at the flag" cls={st.spare_l != null && st.spare_l < 0 ? "up" : undefined}>{nf(st.spare_l, 1)} L</R>
            </div>
          )}
          {large ? <div data-p="5" style={{ padding: "var(--pad)", marginTop: "auto" }}><SharedInputs cfg={c.cfg} /></div> : null}
        </>
      ),
    };
  },
});

// ---------- stop options ----------
interface Group { k: string; o: Json; laps: number[] }

function Options({ st, ranked, large, planLap }: { st: Json; ranked: Json[]; large: boolean; planLap: number | null }) {
  // Rows that differ only in the lap are one row ("Box L11–L18, fuel + tyres"), unless another option's lap lies inside that range.
  const kOf = (o: Json) => [String(o.id).endsWith("_ft"), nf(o.add_l, 1), nf(o.stationary_s, 1), nf(o.loss_s, 1), o.rejoin_pos, o.more_stops, o.reach !== false, !!o.outside_window].join();
  const groups: Group[] = [];
  for (const o of ranked) {
    const k = kOf(o);
    const g = groups.find((x) => {
      if (x.k !== k) return false;
      const a = Math.min(o.lap, ...x.laps), b = Math.max(o.lap, ...x.laps);
      return !ranked.some((p) => p.lap > a && p.lap < b && kOf(p) !== k);
    });
    if (g) g.laps.push(o.lap); else groups.push({ k, o, laps: [o.lap] });
  }
  const opts: Json[] = groups.map(({ o, laps }) => {
    const a = Math.min(...laps), b = Math.max(...laps);
    return a === b ? { ...o, lo: a, hi: b, lapTxt: String(nf(o.lap, 0)) } : { ...o, lo: a, hi: b, lap: a, lapTxt: `${a}–${b}`, label: `Box L${a}–L${b}, fuel${String(o.id).endsWith("_ft") ? " + tyres" : ""}` };
  });
  const top = opts[0]!.reach !== false ? opts[0]! : null;
  const shown = large ? opts : opts.slice(0, 2);
  const note = (o: Json): ReactNode => planLap != null && planLap >= o.lo && planLap <= o.hi ? <span className="tag me">Your plan</span>
    : o === top ? <span className="tag ac">Best</span>
    : o.reach === false ? <span className="tag up">■ fuel lasts to L{nf(st.box_by_lap, 0)}</span>
    : o.outside_window ? <span className="tag wn">▲ Outside window</span> : o.more_stops > 0 ? <span className="tag wn">+{plural(o.more_stops, "stop")}</span> : <span className="tag n">Now</span>;
  return (
    <table className="t">
      <thead><tr><th className="l">Option</th><th>{large ? "Box lap" : "Lap"}</th><th>Add</th>{large ? <th>More stops</th> : null}<th>Loss</th><th>Rejoin</th>{large ? <th className="l">Note</th> : null}</tr></thead>
      <tbody>
        {shown.map((o, i) => (
          <tr key={i} className={o === top ? "cur" : o.reach === false ? "dim" : undefined}>
            <td className="l">{o.label}</td><td>{o.lapTxt}{!large && o.outside_window ? <span className="wn"> ▲</span> : null}</td><td>{nf(o.add_l, 1)} L</td>
            {large ? <td>{nf(o.more_stops || 0, 0)}</td> : null}
            <td>{nf(o.loss_s, 1)} s</td><td>{o.rejoin_pos != null ? "P" + o.rejoin_pos : NONE}</td>
            {large ? <td className="l">{note(o)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const stopOptions = defineModule({
  type: "stop-options", title: "Stop options", group: "Strategy", blurb: "Box now, at the last lap the fuel allows, or when the window opens: loss and rejoin position.",
  size: { w: 6, h: 5, minW: 5, minH: 5, maxW: 8, maxH: 7 }, needs: ["summary", "field"], requires: ["summary"],
  view({ ctx: c, size }) {
    const st = c.st!;
    const ranked = rankOpts(st);
    if (!isRace(c)) return { state: { kind: "empty", msg: "Stop options are planned in races only." } };
    if (!ranked.length) return { state: { kind: "empty", msg: "Stop options appear once a lap time and the fuel use are known." } };
    const w = st.pit_window, large = size.h >= 7;
    return {
      flush: true,
      info: [w ? `WINDOW ${large ? "LAP " : ""}${w.open_lap}–${w.close_lap}` : "", large && st.laps_of_fuel != null ? `FUEL FOR ${nf(st.laps_of_fuel)} LAPS` : ""],
      body: <Options st={st} ranked={ranked} large={large} planLap={nextStop(useRacePlan(), ((c.s?.stops as Json[] | undefined) ?? []).length)?.lap ?? null} />,
    };
  },
});

// ---------- rejoin ----------
export const rejoin = defineModule({
  type: "rejoin", title: "Rejoin", group: "Strategy", blurb: "Where you come out if you box at the end of this lap, and who is around you.",
  size: { w: 4, h: 7, minW: 3, minH: 6, maxW: 6, maxH: 8 }, needs: ["summary", "field", "entries"], requires: ["field"],
  view({ ctx: c, size }) {
    if (c.mode === "best") return { state: { kind: "empty", msg: "Rejoin is predicted in races only." } };
    const rj = c.st?.rejoin;
    if (!rj) return { state: { kind: "empty", msg: "Rejoin needs a lap time and the field first." } };
    const mine = c.me != null ? c.cars.get(c.me) : undefined;
    const around = (rj.around as Json[] | undefined) ?? [];
    const k = around.findIndex((a) => a.i === c.me);
    const places = mine ? rj.pos - mine.pos : 0;
    const large = size.w >= 4;
    const nm = (i: number) => { const car = c.cars.get(i); return car ? `#${car.num} ${carName(car, "short")}` : NONE; };
    const verdict = places === 0 ? <span className="v mu">same place</span> : <span className={"v " + (places > 0 ? "up" : "dn")}>{places > 0 ? "▲" : "▼"} {Math.abs(places)} place{Math.abs(places) === 1 ? "" : "s"}{large ? (places > 0 ? " lost" : " gained") : ""}</span>;
    const loss = c.st?.drive_loss_s != null ? <span className="v mu">{large ? "Pit loss " : ""}{nf(c.st.drive_loss_s, 1)} s</span> : null;
    if (!large) {
      const a = around[k - 1], b = around[k + 1];
      return {
        info: ["IF YOU BOX NOW"],
        body: (
          <>
            <div className="f" style={{ gap: 16, alignItems: "flex-end" }}><span className="big">P{rj.pos}</span>{verdict}{loss}</div>
            {a ? <R k={`Ahead ${nm(a.i)}`}>{nf(Math.abs(a.gap_ms) / 1000, 1)}</R> : null}
            {b ? <R k={`Behind ${nm(b.i)}`}>{nf(Math.abs(b.gap_ms) / 1000, 1)}</R> : null}
          </>
        ),
      };
    }
    return {
      flush: true,
      info: ["IF YOU BOX THIS LAP"],
      body: (
        <div className="cells" style={{ height: "100%" }}>
          <div className="c" style={{ flex: "0 0 200px" }}><span className="lab">Come out</span><span className="big">P{rj.pos}</span>{verdict}{loss}</div>
          <div className="c" style={{ padding: 0 }}>
            <table className="t fx" style={{ minWidth: 318 }}>
              <thead><tr><th className="s">P</th><th className="s">#</th><th className="l d">Driver</th><th>Gap</th></tr></thead>
              <tbody>
                {around.map((a, j) => {
                  const car = c.cars.get(a.i), pos = k >= 0 ? rj.pos + j - k : null;
                  const row = <><td className="mu">{pos ?? "?"}</td><td>{car?.num ?? NONE}</td><td className="l">{a.i === c.me ? "You" : car ? carName(car, "short") : NONE}</td><td>{a.i === c.me ? "0.0" : nf(Math.abs(a.gap_ms) / 1000, 1)}</td></>;
                  return car ? <CarTr key={a.i} car={car} c={c}>{row}</CarTr> : <tr key={a.i}>{row}</tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      ),
    };
  },
});

// ---------- stops made ----------
/** One stop: the time in the pit lane as bars (lane, box), a planned stop dashed. */
function StopRow({ k, lap, plan, lane, box, loss, big, fuelL, tyres }: { k: number; lap: number; plan?: boolean; lane: number; box: number; loss: number | null; big: boolean; fuelL?: number; tyres?: string }) {
  const rest = Math.max(0.1, lane - box);
  const label = (t: string) => t;
  return (
    <div className={"pr" + (plan ? " pln" : "")} style={{ height: big ? 44 : 30, gridTemplateColumns: big ? "60px 1fr 56px 56px" + (fuelL != null ? " 64px 96px" : "") : "58px 1fr 44px 44px" }}>
      {big ? <div className="fc" style={{ gap: 2 }}><span className="v" style={{ fontWeight: 500 }}>Stop {k}</span><span className="v di" style={{ fontSize: 10 }}>LAP {lap}{plan ? " · PLAN" : ""}</span></div> : <span className="v" style={{ fontWeight: 500 }}>S{k}<span className="di" style={{ fontSize: 10, fontWeight: 400 }}> L{lap}</span></span>}
      <div className={"pb" + (plan ? " pl" : "")}><i style={{ flex: rest }}>{label(big ? `lane ${nf(rest, 1)}` : `lane ${nf(rest, 1)}`)}</i><i className="bx" style={{ flex: box }}>{label(`box ${nf(box, 1)}${plan ? " est." : ""}`)}</i></div>
      <span className="v r2">{nf(box, 1)}{big ? " s" : ""}</span>
      <span className={"v r2" + (!plan && loss != null ? " up" : "")}>{loss != null ? nf(loss, 1) + (big ? " s" : "") : NONE}</span>
      {big && fuelL != null ? <><span className="v r2">{fuelL > 0 ? "+" + nf(fuelL, 1) + " L" : NONE}</span><span className="v">{tyres}</span></> : null}
    </div>
  );
}

export const stops = defineModule({
  type: "stops", title: "Pit stops", group: "Strategy", blurb: "Every stop measured: lane and box time, what it cost, fuel, tyres, and the stint after it.",
  size: { w: 6, h: 8, minW: 4, minH: 4, maxH: 8 }, needs: ["summary", "focus"],
  view({ ctx: c, size }) {
    const list = (c.s?.stops as Json[] | undefined) ?? [];
    const st = c.st, top = rankOpts(st)[0], race = isRace(c);
    const rp = useRacePlan();
    // With a race plan the planned rows are its remaining stops; without one, the bridge's best option.
    const planned = rp ? rp.stints.filter((t) => t.add != null).slice(list.length) : [];
    const plan = race && st && st.stops_needed > 0 && top ? top : null;
    if (!list.length && !plan && !planned.length) return { state: { kind: "empty", msg: "No stops yet." } };
    const sts = (c.s?.stints as Json[] | undefined) ?? [];
    const big = size.w >= 5, full = size.w >= 6 && size.h >= 8;
    const loss = list.reduce((a, p) => a + (p.loss_ms != null ? p.loss_ms / 1000 : 0), 0);
    const bestBox = list.length ? Math.min(...list.map((p) => p.box_ms / 1000)) : null;
    const pace = (k: number) => { const a = sts.find((t) => t.n === k + 1), b = sts.find((t) => t.n === k + 2); return a && b && a.avg_ms && b.avg_ms ? (b.avg_ms - a.avg_ms) / 1000 : null; };
    const pa = list.length ? pace(list.length - 1) : null;
    const nPlan = planned.length || (plan ? 1 : 0);
    const timed = [...c.cars.values()].filter((x) => x.lane_ms && x.lane_ms > 0).sort((a, b) => (a.lane_ms ?? 0) - (b.lane_ms ?? 0)).map((x, k) => ({ ...x, rank: k + 1 }));
    const fastest = timed.slice(0, 3).concat(timed.filter((x) => x.rank > 3 && (x.i === c.me || x.i === c.focus)));
    return {
      flush: true,
      info: [list.length ? `${list.length} DONE` : "", nPlan ? `${nPlan} PLANNED` : "", !big && loss ? `LOSS ${nf(loss, 1)} s` : ""],
      body: (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          {big ? (
            <div className="cells h" data-p="2">
              <div className="c"><span className="lab">Total loss</span><span className="mid">{nf(loss, 1)}<span className="u">s</span></span></div>
              <div className="c"><span className="lab">Best box</span><span className="mid">{bestBox != null ? nf(bestBox, 1) : NONE}<span className="u">s</span></span></div>
              <div className="c"><span className="lab">Pace after</span><span className={"mid" + (pa != null ? (pa < 0 ? " dn" : " up") : "")}>{pa != null ? `${pa < 0 ? "▼" : "▲"} ${nf(Math.abs(pa), 2)}` : NONE}<span className="u">s/lap</span></span></div>
            </div>
          ) : null}
          <div className="pr hd" data-p="1" style={{ gridTemplateColumns: !big ? "58px 1fr 44px 44px" : full ? "60px 1fr 56px 56px 64px 96px" : "60px 1fr 56px 56px" }}><span>Stop</span><span>{big ? "Time in the pit lane, seconds" : "Lane · box (s)"}</span><span className="r2">Box</span><span className="r2">Loss</span>{full ? <><span className="r2">Fuel</span><span>Tyres</span></> : null}</div>
          {list.map((p, k) => <StopRow key={k} k={k + 1} lap={p.lap} lane={p.lane_ms / 1000} box={p.box_ms / 1000} loss={p.loss_ms != null ? p.loss_ms / 1000 : null} big={big} fuelL={full ? p.fuel_added_l : undefined} tyres={p.tyres ? `Set ${nf(p.set_before, 0)} → ${nf(p.set_after, 0)}` : "Kept"} />)}
          {planned.length ? planned.map((t, j) => <StopRow key={"p" + j} k={list.length + 1 + j} lap={t.from - 1} plan lane={Math.max(t.stat + (st?.drive_loss_s ?? 0) * 0.3, t.stat)} box={t.stat} loss={(st?.drive_loss_s ?? 0) + t.stat} big={big} fuelL={full ? t.add! : undefined} tyres={full ? (rp!.tyres ? "New set" : "Kept") : undefined} />)
            : plan ? <StopRow k={list.length + 1} lap={plan.lap} plan lane={Math.max(plan.stationary_s + (st!.drive_loss_s ?? 0) * 0.3, plan.stationary_s)} box={plan.stationary_s} loss={plan.loss_s} big={big} fuelL={full ? plan.add_l : undefined} tyres={full ? "Planned" : undefined} /> : null}
          {!big ? <div className="f v di" data-p="3" style={{ padding: "0 var(--pad)", fontSize: 9.5, height: 20, gap: 12 }}><span>S stop · L lap · grey lane · blue box · dashed planned</span></div> : null}
          {big ? <div className="f v di" data-p="3" style={{ padding: "var(--pad)", fontSize: 10.5, gap: 16 }}><span><i style={{ display: "inline-block", width: 10, height: 6, background: "#3a3f47", marginRight: 6 }} />pit lane</span><span><i style={{ display: "inline-block", width: 10, height: 6, background: "var(--ac)", marginRight: 6 }} />stationary in the box</span><span><i style={{ display: "inline-block", width: 10, height: 6, border: "1px dashed var(--t3)", marginRight: 6 }} />planned</span></div> : null}
        </div>
        {full && fieldOn(c) ? (
          <div style={{ width: 250, flex: "none", borderLeft: "1px solid var(--ln)", display: "flex", flexDirection: "column" }}>
            <div className="lab" style={{ padding: "12px 12px 6px" }}>Quickest in the lane so far</div>
            <table className="t"><tbody>
              {fastest.map((x) => <tr key={x.i} className={x.i === c.me ? "own" : undefined}><td className="mu">{x.rank}</td><td className="l">{x.i === c.me ? "You" : `#${x.num} ${carName(x, "last")}`}</td><td>{nf((x.lane_ms ?? 0) / 1000, 1)}</td></tr>)}
            </tbody></table>
          </div>
        ) : null}
        </div>
      ),
    };
  },
});

// ---------- weather ----------
const stageColor = (l: number) => (l >= 3 ? "var(--warn)" : l ? "var(--cold)" : "var(--ln)");

export const weather = defineModule({
  type: "weather", title: "Track and weather", group: "Strategy", blurb: "Rain now and forecast, grip, track and air temperature, wind. The Weather module has the charts.",
  size: { w: 4, h: 5, minW: 3, minH: 5, maxW: 5, maxH: 8 }, needs: ["reading", "field", "tick"], requires: ["reading"],
  view({ ctx: c, size }) {
    const p = usePrefs();
    const s = c.r!.session, car = c.r!.car, rain = Array.isArray(s.rain) ? (s.rain as number[]) : [];
    const clouds = c.field?.weather?.clouds != null ? c.field.weather.clouds * 100 : null;
    const log = wxSample({ t: Date.now(), rain: (rain[0] ?? 0) | 0, wet: c.field?.weather?.wet != null ? c.field.weather.wet * 100 : null, clouds, track: car.road_temp_c, air: car.air_temp_c, wind: s.wind_speed_kmh != null ? s.wind_speed_kmh / 3.6 : null });
    const tu = unit("temp", p.units).u, deg = tu === "°F" ? 1.8 : 1;
    const trend = (pick: (x: WxSample) => number) => { const v = slopePerMin(log, pick); return v == null || Math.abs(v * deg) < 0.05 ? <span className="v mu">steady</span> : <span className={"v " + (v > 0 ? "up" : "dn")}>{v > 0 ? "▲" : "▼"} {Math.abs(v * deg).toFixed(1)} {tu}/min</span>; };
    const grip = GRIP[s.track_grip] ?? NONE;
    const large = size.w >= 4 && size.h >= 5 && size.w * size.h >= 20;
    const fc = forecast(rain, clouds), lv = fc.lv;
    const wind = s.wind_speed_kmh != null ? s.wind_speed_kmh / 3.6 : null;
    const stages = ([["Now", 0], ["+10 min", 1], ["+30 min", 2]] as const).map(([l, i]) => (
      <div key={i} className="fc" style={{ gap: 4, minWidth: 0 }}>
        <div style={{ height: 40, display: "flex", alignItems: "flex-end", borderBottom: "1px solid var(--ln)" }}>
          <div style={{ width: "100%", height: 4 + lv(i) * 7, background: stageColor(lv(i)) }} title={`${lv(i)} of 5`} />
        </div>
        <span className="v di" style={{ fontSize: 10 }}>{l}</span>
        <span className={"v " + tone(lv(i))}>{RAIN[lv(i)]}</span>
      </div>
    ));
    return {
      flush: large, alert: [lv(1) >= 3 && !c.wet ? 1 : 0],
      info: large ? [`GRIP ${String(grip).toUpperCase()}`] : [],
      body: large ? (
        <div className="cells" style={{ height: "100%" }}>
          <div className="c" style={{ flex: 2 }}>
            <div className="f" style={{ gap: 10 }}>
              <span className={fc.cls}><Icon name={fc.icon} size={26} /></span>
              <div className="fc" style={{ gap: 3 }}><span className={"mid " + fc.cls} style={{ fontFamily: "var(--sans)", fontWeight: 600 }}>{fc.text}</span><span className="v mu">{fc.sub}</span></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 }}>{stages}</div>
          </div>
          <div className="c">
            <span className="lab">Track</span>
            <span className="mid wn">{fv("temp", car.road_temp_c, p.units, 0)}<span className="u">{tu}</span></span>
            {trend((x) => x.track)}
            <span className="lab" style={{ marginTop: 6 }}>Air</span>
            <span className="mid cd">{fv("temp", car.air_temp_c, p.units, 0)}<span className="u">{tu}</span></span>
            {trend((x) => x.air)}
          </div>
          <div className="c">
            <span className="lab">Wind</span>
            <span className="mid">{wind != null ? nf(wind, 1) : NONE}<span className="u">m/s</span></span>
            <span className="v mu">from {compass(s.wind_direction_deg || 0)} {nf(s.wind_direction_deg, 0)}°</span>
          </div>
        </div>
      ) : (
        <>
          <div className="cells h">
            {([["Now", 0], ["In 10 min", 1], ["In 30 min", 2]] as const).map(([l, i]) => (
              <div className="c" key={i}><span className="lab">{l}</span><span className={"v " + tone(lv(i))}>{RAIN[lv(i)]}</span><div style={{ height: 6, background: "var(--ln)", marginTop: 6 }} title={`${lv(i)} of 5`}><div style={{ height: "100%", width: (lv(i) / 5) * 100 + "%", background: stageColor(lv(i)) }} /></div></div>
            ))}
          </div>
          <R k="Outlook" cls={fc.cls}>{fc.text}</R>
          <R k="Track · air" p={1}>{fv("temp", car.road_temp_c, p.units, 0)} · {fv("temp", car.air_temp_c, p.units, 0)} {tu}</R>
          <R k="Grip" p={2}>{grip}</R>
          <R k="Wind" p={3}>{wind != null ? nf(wind, 1) : NONE} m/s · {nf(s.wind_direction_deg, 0)}°</R>
        </>
      ),
    };
  },
});

// ---------- pace (degradation) ----------
type Pt = [number, number];

/** Least squares: slope in ms per lap and intercept. */
function fit(pts: Pt[]): [number, number] | null {
  if (pts.length < 3) return null;
  const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0;
  for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  const k = sxx ? sxy / sxx : 0;
  return [k, my - k * mx];
}

interface PaceOpts { fuelCorr: number; compare: boolean }

function PaceChart({ cur, prev, o, pts, f, pf, cc }: { cur: Json[]; prev: Json[]; o: PaceOpts; pts: Pt[]; f: [number, number] | null; pf: [number, number] | null; cc: (l: Json) => number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w: W, h: H } = useSize(ref);
  const clean = (l: Json) => l.valid && !l.out && !l.in;
  let chart: ReactNode = null;
  if (W >= 60 && H >= 40 && cur.length) {
    const vals = pts.length ? pts.map((p) => p[1]) : cur.map(cc);
    let lo = Math.min(...vals) - 300, hi = Math.max(...vals) + 300;
    if (hi - lo < 1000) { const m = (hi + lo) / 2; lo = m - 500; hi = m + 500; }
    // One dot per lap at its time; invalid, out and in laps are hollow and named. The y labels sit in a gutter, never over the data.
    const n0 = cur[0]!.n, n1 = Math.max(cur[cur.length - 1]!.n + 2, n0 + 4), gl = 62, top = 6, bot = H - 14, step0 = (W - gl - 6) / (n1 - n0 + 1);
    const X = (n: number) => gl + (n - n0 + 0.5) * step0, Y = (v: number) => bot - (bot - top) * clamp((v - lo) / (hi - lo), 0, 1);
    const gs = [100, 200, 500, 1000, 2000, 5000].find((k) => (hi - lo) / k <= 5) ?? 10000, ys: number[] = [];
    for (let v = Math.ceil(lo / gs) * gs; v <= hi; v += gs) ys.push(v);
    const line = (F: [number, number] | null, cls: string, a: number, b: number, dash?: boolean) => F && (
      <line className={cls} x1={X(a)} y1={Y(F[0] * a + F[1])} x2={X(b)} y2={Y(F[0] * b + F[1])} strokeDasharray={dash ? "4 3" : undefined} />
    );
    const p0 = pts.length ? pts[0]![0] : n0, p1 = pts.length ? pts[pts.length - 1]![0] : n0;
    const xs = Math.max(1, Math.ceil(28 / step0));
    const ticks: number[] = [];
    for (let n = n0; n <= n1; n += xs) ticks.push(n);
    chart = (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Lap times of the stint with a fitted line">
        {ys.map((v) => <line key={v} className="dg-grid" x1={gl} y1={Y(v)} x2={W} y2={Y(v)} />)}
        <polyline className="dg-path" points={cur.filter(clean).map((l) => `${X(l.n)},${Y(cc(l))}`).join(" ")} />
        <text className="dg-ax dg-hint" x={gl + 6} y={top + 10}>slower ↑</text><text className="dg-ax dg-hint" x={gl + 6} y={bot - 4}>faster ↓</text>
        {line(pf, "dg-prev", n0, n1)}{line(f, "dg-fit", p0, p1)}{p1 < n1 ? line(f, "dg-fit", p1, n1, true) : null}
        {cur.map((l) => {
          const v = cc(l), ok = clean(l), over = v > hi, cx = X(l.n), cy = over ? top + 3 : Y(v);
          const tagY = !f || cy < Y(f[0] * l.n + f[1]) ? cy - 7 : cy + 13;
          return (
            <g key={l.n}>
              <circle className={"dg-dot" + (ok ? "" : " inv")} cx={cx} cy={cy} r="3.5"><title>{`L${l.n} ${fmtLap(l.ms)}${l.valid ? "" : " INV"}${l.out ? " OUT" : ""}${l.in ? " IN" : ""}`}</title></circle>
              {over ? <text className="dg-ax" x={cx} y={top + 14} textAnchor="middle">▲</text> : null}
              {!ok ? <text className="dg-tag" x={cx} y={tagY} textAnchor="middle">{l.valid ? (l.out ? "OUT" : "IN") : "INV"}</text> : null}
            </g>
          );
        })}
        {ticks.map((n) => <text key={n} className="dg-ax" x={X(n)} y={H - 2} textAnchor="middle">{n}</text>)}
        {ys.map((v) => <text key={"y" + v} className="dg-ax" x={gl - 6} y={Y(v) + 3} textAnchor="end">{fmtLap(v)}</text>)}
      </svg>
    );
  }
  void prev; void o;
  return <div className="dg-wrap" ref={ref}>{chart}</div>;
}

export const degradation = defineModule({
  type: "degradation", title: "Pace", group: "Strategy", blurb: "This stint's lap times against a fitted line: what the tyres are costing per lap.",
  size: { w: 6, h: 7, minW: 3, minH: 5, maxH: 9 }, needs: ["summary", "laps"],
  options: [
    { key: "fuelCorr", label: "Fuel correction (s per 10 L)", type: "number", min: 0, max: 1, step: 0.05, def: 0 },
    { key: "compare", label: "Show the previous stint", type: "toggle", def: true },
  ],
  view({ ctx: c, opts, size }) {
    const o = opts as PaceOpts;
    const L = c.laps.filter((l) => l.ms > 0);
    if (!L.length) return { state: { kind: "empty", msg: "Lap times appear here after the first lap." } };
    const sn = Math.max(...L.map((l) => l.stint || 1));
    const stintLaps = (n: number) => L.filter((l) => (l.stint || 1) === n);
    const cur = stintLaps(sn), prev = o.compare ? stintLaps(sn - 1) : [];
    const corr = (laps: Json[]) => {
      const last = laps.length ? laps[laps.length - 1]!.fuel_end : null;
      return (l: Json) => (o.fuelCorr > 0 && l.fuel_end != null && last != null ? l.ms - ((o.fuelCorr * (l.fuel_end - last)) / 10) * 1000 : l.ms);
    };
    const clean = (l: Json) => l.valid && !l.out && !l.in;
    const cc = corr(cur), pc = corr(prev);
    const pts: Pt[] = cur.filter(clean).map((l) => [l.n, cc(l)]);
    const f = fit(pts);
    const pf = fit(prev.filter(clean).map((l): Pt => [l.n - prev[0]!.n + cur[0]!.n, pc(l)])); // the previous stint laid over this one
    // Under five clean laps the slope is shown, dim, but not judged: one out-lap or traffic lap moves it a lot.
    const slope = f ? f[0] : null, few = pts.length < 5;
    const cls = slope == null || few ? "mu" : slope > 150 ? "up" : slope > 60 ? "wn" : "dn";
    const sl = (v: number | null) => (v == null ? NONE : `${v >= 0 ? "+" : MINUS}${Math.abs(v / 1000).toFixed(3)} s /lap`);
    const large = size.w >= 5 && size.h >= 6;
    const pfs = pf ? pf[0] : null, last = cur.filter(clean).slice(-1)[0];
    const vsTrend = f && last ? cc(last) - (f[0] * last.n + f[1]) : null;
    const [word, say] = slope == null || few ? ["Not enough laps yet", `${pts.length} of 5 clean laps needed: one out-lap or a traffic lap moves the trend a lot.`]
      : slope > 150 ? ["Falling off fast", `Each lap is about ${nf(slope / 1000, 2)} s slower than the one before. In 10 laps that is ${nf((slope * 10) / 1000, 1)} s a lap.`]
      : slope > 60 ? ["Dropping off", `Each lap is about ${nf(slope / 1000, 2)} s slower than the one before: the tyres are wearing.`]
      : slope > -60 ? ["Stable", "Lap times are holding: no tyre wear to see yet."]
      : ["Getting quicker", "Lap times are falling: the tyres are coming in, or the fuel is burning off."];
    return {
      flush: true,
      info: large ? ["THIS STINT: LAP TIME PER LAP"] : [<span key="s" className={cls}>{sl(slope)}</span>],
      body: large ? (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex" }}><PaceChart cur={cur} prev={prev} o={o} pts={pts} f={f} pf={pf} cc={cc} /></div>
          <div className="fc" style={{ width: 260, flex: "none", borderLeft: "1px solid var(--ln)", padding: 12, gap: 10 }}>
            <span className="lab">Tyre trend</span>
            <span className={"big " + cls} style={{ fontSize: 18 }}>{word}</span>
            <span className="v mu" data-p="2" style={{ lineHeight: 1.5, whiteSpace: "normal" }}>{say}</span>
            <div className="cells h" style={{ margin: "4px -12px 0" }}>
              <div className="c"><span className="lab">Per lap</span><span className={"mid " + cls}>{slope != null ? (slope >= 0 ? "+" : MINUS) + nf(Math.abs(slope / 1000), 3) : NONE}<span className="u">s</span></span></div>
              <div className="c"><span className="lab">Lost so far</span><span className="mid">{slope != null && slope > 0 ? nf((slope * (pts.length - 1)) / 1000, 2) : NONE}<span className="u">s</span></span></div>
            </div>
            <R k="Clean laps used" p={3}>{pts.length} of {cur.length}</R>
            <R k="Last lap against trend" p={2} cls={vsTrend == null ? "mu" : vsTrend > 150 ? "up" : vsTrend < -150 ? "dn" : ""}>{vsTrend == null ? NONE : (vsTrend >= 0 ? "+" : MINUS) + nf(Math.abs(vsTrend / 1000), 2) + " s"}</R>
            {prev.length ? <R k="Previous stint trend" cls="mu" p={4}>{sl(pfs)}</R> : null}
            {o.fuelCorr > 0 ? <R k="Fuel correction" p={4}>{nf(o.fuelCorr, 2)} s /10 L</R> : null}
            <span className="v di" data-p="5" style={{ marginTop: "auto", lineHeight: 1.5, whiteSpace: "normal", fontSize: 10.5 }}>Each dot is a lap. The solid line is the trend of the clean laps; the dashed one carries it forward. Out, in and invalid laps are hollow and not counted.</span>
          </div>
        </div>
      ) : <PaceChart cur={cur} prev={prev} o={o} pts={pts} f={f} pf={pf} cc={cc} />,
    };
  },
});
