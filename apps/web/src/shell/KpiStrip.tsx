import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Ctx } from "../feed/store";
import { useFeed } from "../feed/useFeed";
import { fmtClock, fmtDelta, fmtLap, fmtRel, NONE, okMs } from "../lib/format";
import { GRIP, PENALTIES, PHASES, RAIN } from "../lib/enums";
import { fuelState } from "../lib/states";
import { fv, unit } from "../lib/units";
import { KpiId, Prefs, usePrefs } from "../state/prefs";
import { FlagTracker } from "./flag";


export const KPI_LABEL: Record<KpiId, string> = {
  session: "Session", left: "Time left", lap: "Lap", pos: "Position", ahead: "Ahead", behind: "Behind", last: "Last", best: "Best", delta: "Delta", fuel: "Fuel", fuelLaps: "Fuel laps",
  stint: "Stint", flag: "Flag", temps: "Track · air", grip: "Grip", rain: "Rain", penalty: "Penalty", stintTime: "Driver stint", boxIn: "Box in",
};
// What the driver checks on a phone, first.
const PHONE: KpiId[] = ["pos", "fuel", "boxIn", "left"];

const U = ({ children }: { children: ReactNode }) => <span className="u">{children}</span>;
const dim = (t: string) => <span className="s-dim">{t}</span>;
const fieldLive = (c: Ctx) => !!(c.field && c.bc?.state === "live");

export function cell(id: KpiId, c: Ctx, p: Prefs, flag: string | null): [string, ReactNode] {
  const r = c.r, s = c.s, st = c.st, ss = r?.session, car = r?.car;
  const me = fieldLive(c) && c.me != null ? c.cars.get(c.me) ?? null : null;
  const race = (c.mode ?? "race") === "race";
  let label: string = KPI_LABEL[id];
  switch (id) {
    case "session": {
      if (!ss) return [label, NONE];
      const ph = fieldLive(c) && c.field!.phase != null ? PHASES[c.field!.phase] : ss.status && ss.status !== "Live" ? ss.status : "";
      return [label, <>{String(ss.kind ?? "").toUpperCase()}{ph ? <U> {"·"} {String(ph).toUpperCase()}</U> : null}</>];
    }
    case "left": return [label, ss ? fmtClock(ss.session_time_left_ms) : NONE];
    case "lap": {
      if (!ss) return [label, NONE];
      const n = ss.lap_number ?? ss.completed_laps + 1;
      const tot = ss.total_laps > 0 ? ss.total_laps : st?.laps_to_go != null ? "≈" + (ss.completed_laps + st.laps_to_go) : "";
      return [label, <>{n}{tot !== "" ? <U>/ {tot}</U> : null}</>];
    }
    case "pos":
      if (!ss?.position) return [label, NONE];
      return [label, <>P{ss.position}</>];
    case "ahead":
    case "behind": {
      const ahead = id === "ahead", pos = me ? me.pos : ss?.position;
      label = race ? (ahead ? "Ahead" : "Behind") : pos ? `To P${ahead ? pos - 1 : pos + 1}` : ahead ? "To P(n−1)" : "To P(n+1)";
      if (me) {
        const o = ahead ? me : [...c.cars.values()].find((x) => x.pos === me.pos + 1);
        if (!o || (ahead && me.pos === 1)) return [label, NONE];
        if (race) return [label, o.int_laps > 0 ? <>{o.int_laps}<U> lap{o.int_laps > 1 ? "s" : ""}</U></> : fmtRel(o.int)];
        return [label, fmtDelta(ahead ? o.int : o.int == null ? null : -o.int)];
      }
      const ms = ss && (ahead ? ss.gap_ahead_ms : ss.gap_behind_ms);
      return [label, ms > 0 && ms < 600000 ? fmtRel(ms) : NONE];
    }
    case "last": {
      if (!ss) return [label, NONE];
      const l = c.laps.length ? c.laps[c.laps.length - 1] : null, inv = l && l.valid === false && l.ms === ss.last_lap_ms;
      const pbLast = !inv && okMs(ss.last_lap_ms) && ss.last_lap_ms === ss.best_lap_ms;
      return [label, inv ? <><span className="t-inv">{fmtLap(ss.last_lap_ms)}</span> <b className="tag inv">INV</b></> : pbLast ? <span className="s-pb">{fmtLap(ss.last_lap_ms)}</span> : fmtLap(ss.last_lap_ms)];
    }
    case "best": {
      const b = s?.best_ms != null ? s.best_ms : ss && okMs(ss.best_lap_ms) ? ss.best_lap_ms : null;
      const sb = b != null && c.field?.best?.ms === b;
      return [label, b == null ? NONE : sb ? <span className="t-best">{"◆"} {fmtLap(b)}</span> : fmtLap(b)];
    }
    case "delta": {
      const d = car?.reference_delta_s;
      if (d == null || !isFinite(d)) return [label, NONE];
      const ms = d * 1000;
      const abs = (Math.abs(ms) / 1000).toFixed(3);
      return [label, ms < -5 ? <span className="s-ok">{"▼"} {abs}</span> : ms > 5 ? <span className="s-bad">{"▲"} {abs}</span> : abs];
    }
    case "fuel": {
      if (!car) return [label, NONE];
      const lf = st?.laps_of_fuel, fs = fuelState(lf, { th: c.th, wet: c.wet, fuelLowLaps: c.cfg?.fuel_low_laps ?? 3 });
      return [label, <>{car.fuel_litres.toFixed(1)}<U> L</U>{lf != null && isFinite(lf) ? <> {"·"} <span className={fs === "bad" ? "s-bad" : ""}>{lf.toFixed(1)}<U> laps</U></span>{fs === "bad" ? <> <b className="tag low">LOW</b></> : null}</> : null}</>];
    }
    case "fuelLaps": {
      const lf = st?.laps_of_fuel, fs = fuelState(lf, { th: c.th, wet: c.wet, fuelLowLaps: c.cfg?.fuel_low_laps ?? 3 });
      return [label, lf != null && isFinite(lf) ? <span className={fs === "bad" ? "s-bad" : fs === "warn" ? "s-warn" : ""}>{lf.toFixed(1)}{fs === "bad" ? <> <b className="tag low">LOW</b></> : null}</span> : NONE];
    }
    case "stint": return [label, s && ss ? <>{s.stint_laps}<U> lap{s.stint_laps === 1 ? "" : "s"} {"·"} set </U>{ss.tyre_set || NONE}</> : NONE];
    case "flag": return [label, !ss ? NONE : <span role="img" aria-label={flag ?? "green"}>{" "}</span>];
    case "temps": return [label, car ? <>{fv("temp", car.road_temp_c, p.units, 0)} {"·"} {fv("temp", car.air_temp_c, p.units, 0)}<U>{unit("temp", p.units).u}</U></> : NONE];
    case "grip": return [label, ss && GRIP[ss.track_grip] ? GRIP[ss.track_grip]! : NONE];
    case "rain": return [label, ss && Array.isArray(ss.rain) ? `${RAIN[ss.rain[0]] ?? NONE} → ${RAIN[ss.rain[2]] ?? NONE}` : NONE];
    case "penalty": return [label, !ss || ss.penalty == null ? NONE : ss.penalty ? <b className="tag pen">{PENALTIES[ss.penalty]?.[0] ?? "?"}</b> : dim("none")];
    case "stintTime": return [label, !ss || ss.stint_time_left_ms == null ? NONE : ss.stint_time_left_ms < 0 ? "no limit" : fmtClock(ss.stint_time_left_ms)];
    case "boxIn":
      return [label, !st ? NONE : st.stops_needed === 0 ? "no stop" : st.box_in_laps != null
        ? (st.box_in_laps <= 0 ? <span className="s-bad">{"■"} this lap</span> : <span className="s-acc">{st.box_in_laps}<U>lap{st.box_in_laps === 1 ? "" : "s"}</U></span>) : NONE];
  }
}

export function KpiStrip() {
  const c = useFeed();
  const p = usePrefs();
  const strip = useRef<HTMLDivElement>(null);
  const flags = useRef(new FlagTracker());
  const [width, setWidth] = useState(0);
  const [hidden, setHidden] = useState<KpiId[]>([]);
  const [fitTick, setFitTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setFitTick((n) => n + 1), 2000); return () => clearInterval(t); }, []);

  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const phone = width > 0 && width < 600;
  const ids = phone ? PHONE : p.kpi;
  const flag = c.r ? flags.current.now(c) : null;

  // Drop cells from the end when the strip is too narrow, the phone set last, and say how many.
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el || phone) { if (hidden.length) setHidden([]); return; }
    const cells = [...el.querySelectorAll<HTMLElement>(".kc")];
    cells.forEach((x) => { x.hidden = false; });
    const order = cells.slice(1).reverse().sort((a, b) => Number(PHONE.includes(a.dataset.k as KpiId)) - Number(PHONE.includes(b.dataset.k as KpiId)));
    const off: KpiId[] = [];
    for (const x of order) {
      if (el.scrollWidth <= el.clientWidth + 1) break;
      x.hidden = true;
      off.push(x.dataset.k as KpiId);
    }
    if (off.join() !== hidden.join()) setHidden(off);
  }, [width, phone, ids.join(), fitTick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div id="kpi" role="group" aria-label="Session figures" ref={strip}>
      {ids.map((id) => {
        const [label, value] = cell(id, c, p, flag);
        return (
          <div className="kc" data-k={id} key={id} data-flag={id === "flag" ? flag ?? "" : undefined} hidden={hidden.includes(id)}>
            <span className="kl">{label}</span>
            <span className="kn n">{value}</span>
          </div>
        );
      })}
      <span className="kc-more n" hidden={!hidden.length} title={hidden.length ? `Not shown, the window is too narrow: ${hidden.map((k) => KPI_LABEL[k]).join(", ")}` : ""}>
        {hidden.length ? `+${hidden.length} more` : ""}
      </span>
    </div>
  );
}
