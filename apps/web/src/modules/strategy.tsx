import { ReactNode, useEffect, useRef, useState } from "react";
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
import { CarTr, fieldOn, Kv, YouTag } from "./cars";

const Litres = ({ v }: { v: number | null | undefined }) => <>{nf(v, 1)}<span className="u"> L</span></>;
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
  size: { w: 3, h: 7, minW: 3, minH: 5 }, needs: ["reading", "summary", "config"], requires: ["reading"],
  view({ ctx: c }) {
    const st = c.st, car = c.r!.car, fx = c.r!.fixed, lf = st?.laps_of_fuel;
    const fs = fuelState(lf, { th: c.th, wet: c.wet, fuelLowLaps: fuelLow(c) });
    const fpl = st?.fuel_per_lap || c.r!.session.fuel_per_lap;
    const max = fx.max_fuel > 0 ? fx.max_fuel : 0;
    const stint = (c.s?.stint as Json[] | undefined) ?? [];
    const lastL = stint.length ? stint[stint.length - 1]!.fuel : null;
    return {
      alert: [fs === "bad" ? 2 : 0],
      body: (
        <>
          <div className="lbl">Laps of fuel</div>
          <div className="big"><span className={fs === "bad" ? "s-bad" : fs === "warn" ? "s-warn" : ""}>{nf(lf)}</span><span className="u"> laps</span>{fs === "bad" ? <> <b className="tag low">LOW</b></> : null}</div>
          <div className="sub"><span><b>{nf(car.fuel_litres)}</b> L in the tank</span></div>
          <div className="gauge fu-g" hidden={!max} title={`Tick: ${fuelLow(c)} laps of fuel, the low-fuel warning`}>
            <i className={fs === "bad" ? "s-bad" : ""} style={{ width: max ? clamp((car.fuel_litres / max) * 100, 0, 100) + "%" : 0 }} />
            <b style={{ left: max ? clamp((fuelLow(c) * (fpl || 0) / max) * 100, 0, 100) + "%" : 0 }} />
          </div>
          <Kv rows={[["Per lap", <>{nf(fpl, 2)}<span className="u"> L</span></>], ["Last lap", <>{nf(lastL, 2)}<span className="u"> L</span></>],
            ["Used this session", <Litres v={c.r!.session.used_fuel_l} />], ["Tank capacity", max ? <Litres v={max} /> : NONE]]} />
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

export const racePlan = defineModule({
  type: "race-plan", title: "Fuel to the flag", group: "Strategy", blurb: "When to box and how much fuel to put in, from the bridge strategy.",
  size: { w: 4, h: 11, minW: 3, minH: 8 }, needs: ["summary", "reading", "config"], requires: ["summary"],
  view({ ctx: c }) {
    const st = c.st;
    if (!st) return { state: { kind: "empty", msg: "Waiting for the bridge strategy figures." } };
    const ss = c.r?.session, car = c.r?.car, cap = c.r && c.r.fixed.max_fuel > 0 ? (c.r.fixed.max_fuel as number) : null, w = st.pit_window;
    const lapNow = ss ? (ss.lap_number != null ? ss.lap_number : ss.completed_laps + 1) : null;
    const race = isRace(c), box = race && st.stops_needed > 0;
    const late = ((st.options as Json[] | undefined) ?? []).find((o) => o.id === "late_f"), top = rankOpts(st)[0];
    let head: ReactNode, crit = false;
    if (!race) head = <><div className="lbl">Fuel lasts to the end of lap</div><div className="big">{st.box_by_lap != null ? "L" + st.box_by_lap : NONE}{st.box_in_laps > 0 ? <span className="u"> in {plural(st.box_in_laps, "lap")}</span> : null}</div><p className="note">Fuel to the flag is planned in races only.</p></>;
    else if (box && (st.box_in_laps <= 0 || (st.box_by_lap != null && lapNow != null && st.box_by_lap < lapNow))) { head = <><div className="lbl">Fuel</div><div className="big s-bad">■ BOX THIS LAP</div></>; crit = true; }
    else if (box) head = <><div className="lbl">Box by end of lap</div><div className="big">{st.box_by_lap != null ? "L" + st.box_by_lap : NONE}<span className="u"> in {plural(st.box_in_laps, "lap")}</span></div></>;
    else head = <><div className="lbl">Fuel to the flag</div><div className="big">{nf(st.spare_l)}<span className="u"> L spare</span></div></>;

    const pace = ({ leader: "leader's", own: "own", best: "best-lap" } as Record<string, string>)[st.lap_ref_src] || "";
    const src = st.laps_src === "timed" ? `timed, ${pace} pace ${fmtLap(st.lap_ref_ms)}` : st.laps_src === "laps" ? "lap count" : st.laps_src === "override" ? "set by hand" : "";
    const save = st.save_lpl != null && st.fuel_per_lap > 0 ? <>{nf(st.save_lpl, 2)}<span className="u"> L/lap</span> <span className="note">{MINUS}{nf((1 - st.save_lpl / st.fuel_per_lap) * 100, 0)} %</span></> : null;
    // "Now" is what the tank takes now; what does not fit is said, not shown as a figure that cannot go in.
    const room = cap != null && car ? Math.max(0, cap - car.fuel_litres) : null;
    const addNow = st.fuel_to_add_l != null && room != null ? Math.min(st.fuel_to_add_l, room) : st.fuel_to_add_l;
    const over = st.fuel_to_add_l != null && addNow != null ? st.fuel_to_add_l - addNow : 0;
    const showNow = box && st.box_in_laps > 0 && addNow != null && (st.add_at_box_l == null || Math.abs(addNow - st.add_at_box_l) >= 1);

    const planFuel = () => {
      if (st.add_at_box_l == null) return;
      const n = Math.ceil(st.add_at_box_l);
      planStore.patch({ fuel: n });
      say(`Fuel ${n} L put in the pit plan`);
    };
    const sev = Math.max(0, ...((c.s?.advice as Json[] | undefined) ?? []).filter((a) => /^fuel_(low|box|flag)$/.test(a.id)).map((a) => a.severity | 0));

    return {
      alert: [crit ? 2 : Math.min(2, sev)],
      body: (
        <>
          <div className="rp-head">
            {head}
            {box && w && st.box_by_lap != null && st.box_by_lap < w.open_lap ? <p className="s-warn">▲ The fuel runs out before the pit window opens (L{w.open_lap}).</p> : null}
            {box && top && top.reach !== false && top.lap !== st.box_by_lap ? <p className="note">Best stop: {top.label}, see Stop options.</p> : null}
          </div>
          <Kv rows={race ? [
            ["Laps to go", <>{nf(st.laps_to_go, 0)}{src ? <span className="note"> {src}</span> : null}</>],
            ["Fuel needed", <Litres v={st.fuel_needed_l} />], ["In tank", car ? <Litres v={car.fuel_litres} /> : NONE],
            showNow && (over >= 0.5 ? ["Room in tank now", <><Litres v={addNow} /> <span className="note">{nf(over, 0)} L short of the flag</span></>] : ["To add now", <Litres v={addNow} />]),
            ["Add at the box", box ? <><Litres v={st.add_at_box_l} />{late && late.more_stops > 0 ? <span className="note"> then {plural(late.more_stops, "more stop")}</span> : null}</> : NONE],
            ["Stops needed", <>{nf(st.stops_needed, 0)}{st.stops_why ? <span className="note"> {st.stops_why}</span> : null}</>],
            save && ["Save to make it", save],
          ] : [["In tank", car ? <Litres v={car.fuel_litres} /> : NONE], ["Per lap", <>{nf(st.fuel_per_lap, 2)}<span className="u"> L</span></>], ["Laps of fuel", nf(st.laps_of_fuel)]]} />
          <div className="rp-acts"><button type="button" className="btn" disabled={!box || st.add_at_box_l == null} onClick={planFuel}>Put in pit plan</button></div>
          <SharedInputs cfg={c.cfg} />
        </>
      ),
    };
  },
});

// ---------- stop options ----------
interface Group { k: string; o: Json; laps: number[] }

function Options({ c, st, ranked }: { c: Ctx; st: Json; ranked: Json[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w } = useSize(ref);
  const slim = w > 0 && w < 560; // a phone: lap, loss, rejoin and the flag first
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
    return a === b ? { ...o, lapTxt: `L${nf(o.lap, 0)}` } : { ...o, lap: a, lapTxt: `L${a}–${b}`, label: `Box L${a}–L${b}, fuel${String(o.id).endsWith("_ft") ? " + tyres" : ""}` };
  });
  const est = st.refuel_src === "est" || st.tyre_src === "est";
  const top = opts[0]!.reach !== false ? opts[0]! : null;
  const flag = (o: Json) => o.reach === false ? <span className="s-bad">■ fuel lasts to L{nf(st.box_by_lap, 0)}</span>
    : o.more_stops > 0 ? <span className="s-warn">+{plural(o.more_stops, "stop")}{o.outside_window ? ": mandatory in window" : ""}</span> : <>yes</>;
  void c;
  return (
    <div ref={ref}>
      <table className="tt so">
        <thead><tr><th>Option</th><th className="n">Lap</th>{slim ? null : <><th className="n">Add L</th><th className="n">Stationary s{est ? <> <b className="tag est">est.</b></> : null}</th></>}<th className="n">Total loss s</th><th className="n">Rejoin</th><th>To the flag</th></tr></thead>
        <tbody>
          {opts.map((o, i) => (
            <tr key={i} className={[o === top && "so-best", o.reach === false && "so-off"].filter(Boolean).join(" ") || undefined}>
              <td>{o === top ? "▶ " : ""}{o.label}</td><td className="n">{o.lapTxt}</td>
              {slim ? null : <><td className="n">{nf(o.add_l, 1)}</td><td className="n">{nf(o.stationary_s, 1)}</td></>}
              <td className="n">{nf(o.loss_s, 1)}</td><td className="n">{o.rejoin_pos != null ? "P" + o.rejoin_pos : NONE}</td><td>{flag(o)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">Loss = drive-through {nf(st.drive_loss_s, 1)} s ({st.drive_loss_src === "measured" ? "measured" : "from Settings until a stop is measured"}) + stationary. Rejoin assumes the others keep their pace.</p>
    </div>
  );
}

export const stopOptions = defineModule({
  type: "stop-options", title: "Stop options", group: "Strategy", blurb: "Box now, at the last lap the fuel allows, or when the window opens: loss and rejoin position.",
  size: { w: 6, h: 7, minW: 5, minH: 6 }, needs: ["summary", "field"], requires: ["summary"],
  view({ ctx: c }) {
    const st = c.st!;
    const ranked = rankOpts(st);
    if (!isRace(c)) return { state: { kind: "empty", msg: "Stop options are planned in races only." } };
    if (!ranked.length) return { state: { kind: "empty", msg: "Stop options appear once a lap time and the fuel use are known." } };
    return {
      info: `refuel ${nf(st.refuel_s_per_l, 2)} s/L (${st.refuel_src}) · tyres ${nf(st.tyre_s, 0)} s (${st.tyre_src})`,
      body: <Options c={c} st={st} ranked={ranked} />,
    };
  },
});

// ---------- rejoin ----------
export const rejoin = defineModule({
  type: "rejoin", title: "Rejoin", group: "Strategy", blurb: "Where you come out if you box at the end of this lap, and who is around you.",
  size: { w: 4, h: 7, minW: 3, minH: 6 }, needs: ["summary", "field", "entries"], requires: ["field"],
  view({ ctx: c }) {
    if (c.mode === "best") return { state: { kind: "empty", msg: "Rejoin is predicted in races only." } };
    const rj = c.st?.rejoin;
    if (!rj) return { state: { kind: "empty", msg: "Rejoin needs a lap time and the field first." } };
    const mine = c.me != null ? c.cars.get(c.me) : undefined;
    const around = (rj.around as Json[] | undefined) ?? [];
    const k = around.findIndex((a) => a.i === c.me);
    const name = (i: number) => { const car = c.cars.get(i); return car ? `#${car.num} ${carName(car, "short")}` : NONE; };
    const myName = (() => { const n = mine ? carName(mine, "short") : ""; return /^\S\. *$/.test(n) ? carName(mine, "full") : n; })() || "You";
    return {
      body: (
        <>
          <div className="lbl">Rejoin if you box this lap</div>
          <div className="big">P{rj.pos}{mine && mine.net != null ? <span className="u"> · net P{mine.net}</span> : null}</div>
          <table className="tt rj">
            <thead><tr><th className="sb" /><th className="n">Pos</th><th>Car</th><th className="n">Gap to you s</th></tr></thead>
            <tbody>
              {around.map((a, j) => {
                const car = c.cars.get(a.i);
                const row = (
                  <>
                    <td className="n">P{k >= 0 ? rj.pos + j - k : "?"}</td>
                    <td>{a.i === c.me ? <>{myName} <YouTag /></> : name(a.i)}</td>
                    <td className="n">{a.i === c.me ? "" : fmtRel(a.gap_ms)}</td>
                  </>
                );
                return car ? <CarTr key={a.i} car={car} c={c}>{row}</CarTr> : <tr key={a.i}><td className="sb" />{row}</tr>;
              })}
            </tbody>
          </table>
        </>
      ),
    };
  },
});

// ---------- stops made ----------
export const stops = defineModule({
  type: "stops", title: "Pit stops", group: "Strategy", blurb: "Every stop measured: lane and box time, what it cost, fuel, tyres, and the stint after it.",
  size: { w: 6, h: 7, minW: 4, minH: 4 }, needs: ["summary"],
  view({ ctx: c }) {
    const list = (c.s?.stops as Json[] | undefined) ?? [];
    if (!list.length) return { state: { kind: "empty", msg: "No stops yet." } };
    const sts = (c.s?.stints as Json[] | undefined) ?? [];
    return {
      info: plural(list.length, "stop"),
      body: (
        <table className="tt">
          <thead><tr><th className="n">Lap</th><th className="n">Lane s</th><th className="n">Box s</th><th className="n">Loss s</th><th className="n">Fuel</th><th>Tyres</th><th className="n">Next stint</th></tr></thead>
          <tbody>
            {list.map((p, k) => {
              const n = sts.find((t) => t.n === k + 2);
              return (
                <tr key={k}>
                  <td className="n">L{nf(p.lap, 0)}</td><td className="n">{nf(p.lane_ms / 1000, 1)}</td><td className="n">{nf(p.box_ms / 1000, 1)}</td>
                  <td className="n">{p.loss_ms != null ? nf(p.loss_ms / 1000, 1) : <span className="note">after out-lap</span>}</td>
                  <td className="n">{p.fuel_added_l > 0 ? "+" + nf(p.fuel_added_l, 1) : NONE}</td>
                  <td>{p.tyres ? `${nf(p.set_before, 0)}→${nf(p.set_after, 0)}` : "no"}</td>
                  <td className="n">{n ? `${n.laps} L · ${fmtLap(n.best_ms)} · avg ${fmtLap(n.avg_ms)}` : NONE}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ),
    };
  },
});

// ---------- weather ----------
const compass = (d: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((((d % 360) + 360) % 360) / 45) % 8]!;

interface WxPoint { t: number; track: number; air: number }

export const weather = defineModule({
  type: "weather", title: "Track & weather", group: "Strategy", blurb: "Rain now and forecast, grip, track and air temperature trends, wind.",
  size: { w: 4, h: 5, minW: 3, minH: 5 }, needs: ["reading", "field", "tick"], requires: ["reading"],
  view({ ctx: c }) {
    const p = usePrefs();
    const s = c.r!.session, car = c.r!.car, rain = Array.isArray(s.rain) ? (s.rain as number[]) : [];
    const hist = useRef<WxPoint[]>([]);
    const H = hist.current, t = Date.now();
    if (!H.length || t - H[H.length - 1]!.t >= 30000) { H.push({ t, track: car.road_temp_c, air: car.air_temp_c }); while (H.length > 21) H.shift(); } // 10 min, every 30 s
    const trend = (k: "track" | "air"): ReactNode => {
      if (H.length < 2) return null;
      const d = car[k === "track" ? "road_temp_c" : "air_temp_c"] - H[0]![k], mins = Math.round((t - H[0]!.t) / 60000);
      if (Math.abs(d) < 0.5) return <span className="note"> steady</span>;
      return <span className="note"> {d > 0 ? "▲ +" : "▼ " + MINUS}{(Math.abs(d) * (unit("temp", p.units).u === "°F" ? 1.8 : 1)).toFixed(1)}° in {Math.max(1, mins)} min</span>;
    };
    const F = fieldOn(c) ? c.field!.weather : null;
    return {
      alert: [(rain[1]! | 0) >= 3 && !c.wet ? 1 : 0],
      body: (
        <>
          <div className="wx-rain">
            {([["Now", rain[0]], ["10 min", rain[1]], ["30 min", rain[2]]] as const).map(([l, v]) => {
              const k = (v ?? 0) | 0, w = k >= 3;
              return (
                <div className="wx-c" key={l}>
                  <div className="lbl">{l}</div>
                  <div className={w ? "s-warn" : ""}>{RAIN[k] ?? NONE}{w ? " ▲" : ""}</div>
                  <span className="wx-lvl" aria-hidden="true">{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= k ? (w ? "on w" : "on") : ""} />)}</span>
                </div>
              );
            })}
          </div>
          <>
            <Kv className="wx" rows={[
              ["Grip", <>{GRIP[s.track_grip] ?? NONE}{s.track_status ? <span className="note"> {s.track_status}</span> : null}</>],
              ["Track", <>{fv("temp", car.road_temp_c, p.units, 1)}°{trend("track")}</>],
              ["Air", <>{fv("temp", car.air_temp_c, p.units, 1)}°{trend("air")}</>],
              ["Wind", <>{fvu("speed", s.wind_speed_kmh, p.units)} <svg className="wx-arrow" width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true"><path transform={`rotate(${nf(s.wind_direction_deg, 0)})`} d="M0 -6 L4 4 L0 2 L-4 4 Z" /></svg> {nf(s.wind_direction_deg, 0)}° {compass(s.wind_direction_deg || 0)}</>],
              F && ["Clouds", <>{nf((F.clouds ?? 0) * 100, 0)}<span className="u"> %</span></>],
              F && ["Wetness", <>{nf((F.wet ?? 0) * 100, 0)}<span className="u"> %</span></>],
            ]} />
          </>
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
  size: { w: 6, h: 7, minW: 3, minH: 5 }, needs: ["summary", "laps"],
  options: [
    { key: "fuelCorr", label: "Fuel correction (s per 10 L)", type: "number", min: 0, max: 1, step: 0.05, def: 0 },
    { key: "compare", label: "Show the previous stint", type: "toggle", def: true },
  ],
  view({ ctx: c, opts }) {
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
    const cls = slope == null || few ? "s-dim" : slope > 150 ? "s-bad" : slope > 60 ? "s-warn" : "s-ok";
    return {
      info: `stint ${sn} · ${plural(pts.length, "clean lap")}`,
      body: (
        <>
          <div className="sub dg-sub">
            <span>
              {plural(pts.length, "clean lap")} · stint {sn}{o.fuelCorr > 0 ? " · fuel-corrected" : ""}
              {slope != null ? <> · trend <b className={cls}>{signed(slope / 1000, 3)} s/lap {slope > 0 ? "▲" : "▼"}</b>{few ? <span className="note"> (n={pts.length}, judged from 5)</span> : null}</> : null}
            </span>
            {o.compare && prev.length ? <span className="lg"><i className="sw dash" style={{ ["--c" as string]: "var(--dim)" }} />stint {sn - 1}</span> : null}
          </div>
          <PaceChart cur={cur} prev={prev} o={o} pts={pts} f={f} pf={pf} cc={cc} />
        </>
      ),
    };
  },
});

