import { useEffect, useRef, useState } from "react";
import { defineModule } from "../engine/registry";
import { FillLap, fromLaps } from "../lib/fuelfill";
import { fuelPlan, PlanInputs, shiftStop } from "../lib/fuelplan";
import { fmtLap, MINUS, nf, NONE, plural } from "../lib/format";
import { lsGet, lsSet } from "../lib/storage";
import { say } from "../state/bridge";
import { planStore } from "../state/plan";
import { expectedFuel, nextStop, racePlan, useRacePlan } from "../state/racePlan";

type Values = Record<string, string> & { unit?: "min" | "laps" };
type Flags = { tyres: boolean; seq: boolean | null };

const NUMS = ["race", "extra", "fpl", "cap", "reserve", "formL", "mand", "maxStint", "loss", "refuel", "tyreS", "minStat", "wt", "drivers", "spd"];

function load(): { v: Values; f: Flags } {
  const o = lsGet<Record<string, unknown>>("pitwall.calc", {});
  const v: Values = { unit: "min", lap: "" };
  if (o && typeof o === "object") {
    for (const k of NUMS) if (typeof o[k] === "string" && (o[k] as string).length < 12 && /^[0-9.,:]*$/.test(o[k] as string)) v[k] = o[k] as string;
    if (o.unit === "laps") v.unit = "laps";
    if (typeof o.lap === "string" && /^[0-9.:]{0,10}$/.test(o.lap)) v.lap = o.lap;
  }
  return { v, f: { tyres: typeof o?.tyres === "boolean" ? o.tyres : true, seq: typeof o?.seq === "boolean" ? o.seq : null } };
}

const num = (s: string | undefined): number | null => {
  const v = parseFloat(String(s ?? "").replace(",", "."));
  return isFinite(v) ? v : null;
};
const lapSecs = (s: string): number | null => {
  const m = /^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(s.trim());
  return m ? (m[1] ? +m[1] * 60 : 0) + parseFloat(m[2]!.replace(",", ".")) : null;
};
const hms = (s: number) => { s = Math.round(s); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const sgn = (v: number, d: number) => (v < 0 ? MINUS : "+") + nf(Math.abs(v), d);


const FIELDS: [string, string, string][] = [
  ["fpl", "Fuel per lap", "L"], ["cap", "Tank", "L"], ["reserve", "Reserve", "laps"], ["extra", "Extra laps", "laps"], ["formL", "Formation", "L"],
  ["mand", "Mandatory stops", ""], ["maxStint", "Max driver stint", "min"], ["loss", "Pit loss", "s"], ["refuel", "Refuelling", "s/L"],
  ["drivers", "Drivers", ""], ["spd", "Stints per driver", ""], ["tyreS", "Tyres", "s"], ["minStat", "Min. stationary", "s"], ["wt", "Weight / 10 L", "s/lap"],
];
const TIPS: Record<string, string> = {
  extra: "Laps driven after the timer reaches zero, on top of finishing the lap in progress (already counted).",
  reserve: "Laps of fuel left in the tank at the flag, and when you arrive at each stop.",
  formL: "Fuel burnt before lap 1 (formation lap, grid).",
  maxStint: "Longest time one driver may drive in a row: forces stops. Empty = no limit.",
  drivers: "Drivers sharing the race. Stints go to them in turn; the stops table shows who drives each stint and the plan shows each driver's total time.",
  spd: "Stints a driver drives in a row before the next driver takes over. 2 = a double stint: the car stops for fuel in between with the same driver.",
  wt: "How much slower a lap is per 10 L of fuel carried (average over the lap). 0 = ignore; a stop then costs only its time.",
};

export const fuelCalc = defineModule({
  type: "fuel-calc", title: "Fuel & stints", group: "Strategy", blurb: "Plan the race: fuel to start with, stops, stint lengths and the fuel at each stop, from race length, lap time and consumption.",
  size: { w: 6, h: 20, minW: 4, minH: 10, maxH: 22 }, needs: ["summary", "reading", "config", "laps"], rate: 2,
  view({ ctx: c, size }) {
    const [state, setState] = useState(load);
    const [sel, setSel] = useState<number | null>(null);
    const [mine, setMine] = useState<number[] | null>(null);
    const [safe, setSafe] = useState(false);
    const [full, setFull] = useState(false);
    const stopsRef = useRef<HTMLDivElement>(null);
    const shared = useRacePlan();
    const { v, f } = state;
    const update = (nv: Values, nf: Flags) => { setState({ v: nv, f: nf }); setSel(null); setMine(null); lsSet("pitwall.calc", { ...nv, tyres: nf.tyres, ...(nf.seq == null ? {} : { seq: nf.seq }) }); };
    const set = (k: string, val: string) => update({ ...v, [k]: val.replace(k === "lap" ? /[^0-9.,:]/g : /[^0-9.,]/g, "") }, f);

    const st = c.st, cfg = (c.cfg?.strategy ?? {}) as Record<string, number | string | null>, fx = c.r?.fixed;
    const live: Record<string, number | null> = {
      fpl: st && st.fuel_per_lap > 0 ? st.fuel_per_lap : c.r && c.r.session.fuel_per_lap > 0 ? c.r.session.fuel_per_lap : null,
      lap: st && (st.my_pace_ms || st.lap_ref_ms) ? (st.my_pace_ms || st.lap_ref_ms) / 1000 : null,
      cap: fx && fx.max_fuel > 0 ? fx.max_fuel : null, reserve: cfg.reserve_laps as number | null, mand: cfg.mandatory_stops as number | null,
      loss: st ? st.drive_loss_s : (cfg.pit_loss_s as number | null), refuel: st ? st.refuel_s_per_l : (cfg.refuel_s_per_l as number | null),
      tyreS: st ? st.tyre_s : (cfg.tyre_s as number | null), minStat: cfg.min_stationary_s as number | null,
    };
    const ses = c.r?.session;
    const liveRace = ses && ses.kind === "Race" ? (ses.total_laps > 0 ? ses.total_laps : st?.laps_to_go != null ? ses.completed_laps + Math.ceil(st.laps_to_go) : null) : null;
    const ph: Record<string, string> = { race: liveRace ? String(liveRace) : "", extra: "0", formL: "0", maxStint: "none", wt: "0", lap: live.lap != null ? fmtLap(live.lap * 1000) : "m:ss.xxx" };
    for (const k of ["fpl", "cap", "reserve", "mand", "loss", "refuel", "tyreS", "minStat"]) ph[k] = live[k] == null ? "" : String(+(+live[k]!).toFixed(2));

    const n = (k: string) => num(v[k]);
    const or = (k: string, d: number | null): number | null => (n(k) != null ? n(k) : live[k] != null ? +live[k]! : d);
    const laps = v.unit === "laps";
    const seq = f.seq != null ? f.seq : cfg.fuel_and_tyres === "sequential";
    const inp: PlanInputs = {
      raceMin: !v.race && liveRace ? null : laps ? null : n("race"), raceLaps: !v.race && liveRace ? liveRace : laps ? n("race") : null, extra: n("extra") || 0, lapS: v.lap ? lapSecs(v.lap) : live.lap ?? null,
      fpl: or("fpl", null), cap: or("cap", null), reserve: or("reserve", 1)! + (safe ? 1 : 0), formL: n("formL") || 0, mand: Math.round(or("mand", 0)!), maxStintMin: n("maxStint"),
      lossS: or("loss", 25)!, refuelSpl: or("refuel", 0.25)!, tyreS: or("tyreS", 30)!, tyres: f.tyres, seq, minStat: or("minStat", 0)!, wt: n("wt") || 0,
    };
    const p = fuelPlan(inp);
    const even = p.total ? (sel != null && sel >= 0 && sel <= p.maxStops ? (full ? p.full(sel) : p.even(sel)) : full && p.best ? p.full(p.best.n) : p.best ?? p.options[0]) : null;
    const drivers = Math.max(1, Math.min(10, Math.round(n("drivers") ?? 1))), spd = Math.max(1, Math.min(10, Math.round(n("spd") ?? 1)));
    const who = (stint: number) => Math.floor((stint - 1) / spd) % drivers;
    const handmade = even && p.total && mine && mine.length === even.n && mine.every((x, k) => x >= 1 && x < p.total! && (k === 0 || x > mine[k - 1]!)) ? p.build(mine) : null;
    const pick = handmade ?? even;
    const me = c.me != null ? c.cars.get(c.me) : undefined, ref = st?.lap_ref_ms ?? 0;
    const rejoinAt = (lossS: number): number | null => {
      if (!me || me.gap == null || !(ref > 0) || ses?.kind !== "Race") return null;
      const mine = me.gap + me.gap_laps * ref + lossS * 1000;
      return 1 + [...c.cars.values()].filter((x) => x.i !== me.i && x.gap != null && x.loc === "track" && x.gap + x.gap_laps * ref < mine).length;
    };
    const shift = (k: number, d: number) => (pick && p.total ? shiftStop(pick.stints.slice(1).map((t) => t.from - 1), k, d, p.total, p.maxStint) : null);
    const move = (k: number, d: number) => { const to = shift(k, d); if (to) setMine(to); };
    const start = pick && pick.ok ? pick.start : null;

    const clear = () => update({ unit: "min", lap: "" }, { tyres: true, seq: null });
    const useRace = () => { if (liveRace) update({ ...v, unit: "laps", race: String(liveRace) }, f); };
    const autoFill = () => {
      const a = fromLaps([...c.past.flatMap((q) => q.laps as FillLap[]), ...(c.laps as FillLap[])]), nv = { ...v };
      if (liveRace) { nv.unit = "laps"; nv.race = String(liveRace); }
      if (a.lap) nv.lap = a.lap;
      if (a.fpl) nv.fpl = a.fpl;
      for (const k of ["cap", "reserve", "mand", "loss", "refuel", "tyreS", "minStat"]) if (!nv[k] && ph[k]) nv[k] = ph[k]!;
      update(nv, f);
      say((liveRace ? `Race length ${liveRace} laps. ` : "") + (a.n ? `Filled from ${plural(a.n, "clean lap")} of every session` : "No clean laps yet: filled the live figures only"));
    };
    const lapNow = c.r ? (c.r.session.lap_number ?? c.r.session.completed_laps + 1) : null, tankNow = c.r?.car.fuel_litres ?? null;
    const pickPlan = pick && pick.ok && p.total && inp.fpl ? { total: p.total, fpl: inp.fpl, tyres: inp.tyres, stints: pick.stints } : null;
    const same = !!shared && !!pickPlan && JSON.stringify(shared.stints) === JSON.stringify(pickPlan.stints);
    const setPlan = () => {
      if (!pickPlan) return;
      racePlan.set(pickPlan);
      const nx = nextStop(pickPlan, ((c.s?.stops as unknown[] | undefined) ?? []).length);
      if (nx) planStore.patch({ fuel: Math.ceil(nx.add) });
      say(nx ? `Race plan set. Next stop: lap ${nx.lap}, ${Math.ceil(nx.add)} L, now in the pit plan` : "Race plan set");
    };
    const exp = pickPlan ? expectedFuel(pickPlan, lapNow) : null, off = exp != null && tankNow != null ? tankNow - exp : null;
    const live2 = lapNow != null && pickPlan && lapNow <= pickPlan.total && tankNow != null ? (
      <div className="lv">
        <span className="lv-k">Now</span>
        <span>Lap <b>{lapNow}</b> of {pickPlan.total}</span>
        <span>Tank <b>{nf(tankNow, 1)} L</b></span>
        <span>Plan <b>{exp != null ? nf(exp, 1) + " L" : NONE}</b></span>
        {off == null ? null : <span className={"lv-d " + (off < -1 ? "up" : off > 1 ? "dn" : "")}>{Math.abs(off) <= 1 ? "On plan" : off < 0 ? `${nf(-off, 1)} L short: save fuel or box earlier` : `${nf(off, 1)} L ahead: a stint could run longer`}</span>}
      </div>
    ) : null;
    const toPlan = () => { if (start == null) return; const k = Math.ceil(start); planStore.patch({ fuel: k }); say(`Start fuel ${k} L put in the pit plan`); };

    const capKnown = inp.cap != null && inp.cap > 0;
    const wide = size.w >= 9;
    const large = size.w >= 6 && size.h >= 14;
    const ok = !!(p.total && pick);
    const fld = (k: string, label: string, unit: string) => (
      <div className="r" key={k} title={TIPS[k] ?? ""}><span>{label}</span>
        <div className="f fi"><input className="inp sm" type="text" inputMode="decimal" autoComplete="off" value={v[k] ?? ""} placeholder={ph[k] ?? ""} aria-label={label} onChange={(e) => set(k, e.target.value)} /><span className="v di">{unit}</span></div></div>
    );
    const raceInput = (cls: string) => (
      <div className={cls}><input className="inp sm" type="text" inputMode="decimal" aria-label="Race length" value={v.race ?? ""} onChange={(e) => set("race", e.target.value)} />
        <div className="seg">{(["laps", "min"] as const).map((u) => <button key={u} type="button" aria-pressed={v.unit === u} onClick={() => update({ ...v, unit: u }, f)}>{u}</button>)}</div></div>
    );
    const dense = !!pick && pick.stints.length > 12;
    const curStop = pick && lapNow != null ? pick.stints.findIndex((t) => lapNow <= t.to) : -1;
    useEffect(() => { stopsRef.current?.querySelector("tr.cur")?.scrollIntoView({ block: "nearest" }); }, [curStop, pick?.n]);
    const longest = pick ? Math.max(...pick.stints.map((t) => t.laps)) : null;
    const cells = (
      <div className="cells h">
        <div className="c"><span className="lab">Start with</span><span className="big">{pick ? nf(Math.ceil(pick.start), 0) : NONE}<span className="u">L</span></span></div>
        <div className="c"><span className="lab">Stops</span><span className="big">{pick ? pick.n : NONE}</span></div>
        <div className="c"><span className="lab">Longest stint</span><span className="big">{longest ?? NONE}<span className="u">laps</span></span></div>
        {large ? <div className="c"><span className="lab">Race time</span><span className="big" style={{ fontSize: 24 }}>{pick ? hms(pick.timeS) : NONE}</span></div> : null}
      </div>
    );
    const miss = !ok ? [!(((laps ? inp.raceLaps : inp.raceMin) ?? 0) > 0) && "the race length", !((inp.lapS ?? 0) > 0) && "a lap time", !((inp.fpl ?? 0) > 0) && "the fuel per lap"].filter(Boolean) : [];

    const other = ok && p.best ? fuelPlan({ ...inp, reserve: inp.reserve + (safe ? -1 : 1) }).best : null;
    const safeCost = other && p.best ? Math.abs(other.timeS - p.best.timeS) : null;
    const stintTable = (cols: "small" | "large") => pick ? (
      <table className="t">
        <thead><tr><th className="l">Stint</th><th>Laps</th><th>Fuel in</th>{cols === "large" ? <th>Fuel at end</th> : null}<th>{cols === "large" ? "Add at stop" : "Add"}</th></tr></thead>
        <tbody>
          {pick.stints.map((t) => (
            <tr key={t.n} className={lapNow != null && lapNow >= t.from && lapNow <= t.to ? "cur" : undefined}>
              <td className="l">{t.n}</td><td>{t.from}–{t.to}</td><td>{nf(t.load, 1)} L</td>
              {cols === "large" ? <td>{nf(t.load - t.laps * (inp.fpl ?? 0), 1)} L</td> : null}
              <td className={t.add == null ? "" : "ac"}>{t.add == null ? NONE : "+" + nf(t.add, 1) + " L"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : null;

    if (!large) {
      return {
        flush: true,
        info: ok ? [`${p.total} LAPS`] : [],
        body: (
          <>
            <div className="g3" style={{ padding: 8, gap: 8 }}>
              <div className="fc"><span className="lab">Race</span>{raceInput("f")}</div>
              <div className="fc"><span className="lab">Lap time</span><input className="inp sm" style={{ width: "100%" }} placeholder={ph.lap} value={v.lap ?? ""} aria-label="Lap time" onChange={(e) => set("lap", e.target.value)} /></div>
              <div className="fc"><span className="lab">Fuel / lap</span><input className="inp sm" style={{ width: "100%" }} placeholder={ph.fpl} value={v.fpl ?? ""} aria-label="Fuel per lap" onChange={(e) => set("fpl", e.target.value)} /></div>
            </div>
            <div style={{ borderTop: "1px solid var(--ln)" }}>{cells}</div>
            {ok ? stintTable("small") : <div className="v mu" style={{ padding: 8 }}>Still needed: {miss.join(", ")}.</div>}
          </>
        ),
      };
    }
    return {
      flush: true,
      info: ["EMPTY FIELDS TAKE THE LIVE VALUE"],
      body: (
        <div className="fc-split" style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div className="fc fc-in" style={{ width: 330, flex: "none", padding: 12, borderRight: "1px solid var(--ln)", overflow: "auto" }}>
            <span className="lab">Inputs</span>
            <div className="r"><span>Race length</span>{raceInput("f fi")}</div>
            <div className="r"><span>Lap time</span><div className="f fi"><input className="inp sm" placeholder={ph.lap} value={v.lap ?? ""} aria-label="Lap time" onChange={(e) => set("lap", e.target.value)} /><span className="v di">m:ss.xxx</span></div></div>
            {FIELDS.map(([k, l, u]) => fld(k, l, u))}
            <label className="f v mu" style={{ minHeight: 28 }}><input type="checkbox" className="sw" checked={f.tyres} onChange={(e) => update(v, { ...f, tyres: e.target.checked })} /> Tyres at every stop</label>
            <label className="f v mu" style={{ minHeight: 28 }}><input type="checkbox" className="sw" checked={seq} onChange={(e) => update(v, { ...f, seq: e.target.checked })} /> Fuel, then tyres</label>
            <div className="f" style={{ marginTop: 8 }}><button type="button" className="btn" title="Fuel per lap and lap time from the clean laps of practice, qualifying and this session; empty fields take the live figures." onClick={autoFill}>Auto-fill</button><button type="button" className="btn gh" onClick={clear}>Clear inputs</button></div>
            <span className="v di" style={{ marginTop: 8 }}>Auto-fill uses the clean laps of practice, qualifying and this session.</span>
          </div>
          <div className="fs-main">
            {!ok ? <div className="v mu" style={{ padding: 12 }}>Still needed: {miss.join(", ")}. Grey figures are live values; an empty field uses them.{liveRace && miss.includes("the race length") ? <div style={{ marginTop: 10 }}><button type="button" className="btn pr" onClick={useRace}>Use this race: {liveRace} laps</button></div> : null}</div> : (
              <>
                {!p.best ? <div className="v up" style={{ padding: "8px 12px" }}>▲ No plan fits: the tank ({capKnown ? nf(inp.cap, 0) + " L" : NONE}) holds {plural(Math.max(0, p.maxStint.rest), "lap")} of fuel after the reserve, and the race needs {p.nMin > 0 ? `at least ${plural(p.nMin, "stop")} and ` : ""}stints of {plural(Math.ceil((p.total ?? 0) / (p.nMin + 1)), "lap")}.</div> : null}
                <div className="fs-top">
                  <div><span className="lab">Start with</span><b>{pick ? nf(Math.ceil(pick.start), 0) : NONE}<i>L</i></b></div>
                  <div><span className="lab">Stops</span>{pick ? <span className="stp"><button type="button" className="btn" aria-label="One stop fewer" disabled={pick.n <= 0} onClick={() => { setSel(pick.n - 1); setMine(null); }}>−</button><b>{pick.n}</b><button type="button" className="btn" aria-label="One stop more" disabled={pick.n >= p.maxStops} onClick={() => { setSel(pick.n + 1); setMine(null); }}>+</button></span> : <b>{NONE}</b>}</div>
                  <div><span className="lab">Longest stint</span><b>{longest ?? NONE}<i>laps</i></b></div>
                  <div><span className="lab">Race time</span><b>{pick ? hms(pick.timeS) : NONE}</b></div>
                </div>
                <div className="fs-opts">
                  {p.options.map((e) => {
                    const o = full ? p.full(e.n) : e, bt = full && p.best ? p.full(p.best.n) : p.best;
                    return (
                      <button key={o.n} type="button" className="pwb-chip" aria-pressed={o.n === pick?.n} onClick={() => { setSel(o.n); setMine(null); }} title={`Start with ${nf(o.start, 1)} L`}>
                        {o.n} stop{o.n === 1 ? "" : "s"} · {!o.ok ? (!o.tank ? "tank too small" : "too few") : o.n === bt?.n ? "fastest" : bt ? `${sgn(o.timeS - bt.timeS, 0)} s` : ""}
                      </button>
                    );
                  })}
                  <button type="button" className="pwb-chip" aria-pressed={safe} title="Keep one more lap of fuel at every stop and at the flag" onClick={() => { setSafe(!safe); setSel(null); setMine(null); }}>Extra lap of fuel{safeCost != null ? ` · ${safeCost < 1 ? "free" : (safe ? "+" : "") + nf(safeCost, 0) + " s"}` : ""}</button>
                  <button type="button" className="pwb-chip" aria-pressed={full} title="Every stint as long as the tank and the max driver stint allow, the last one takes what is left. Off: stints of equal length." onClick={() => { setFull(!full); setMine(null); }}>Full stints</button>
                </div>
                {p.save ? <div className="fs-note" title={`Burn ${nf(p.save.fpl, 2)} L a lap instead of ${nf(inp.fpl ?? 0, 2)} and you need one stop fewer`}>Save a stop: {nf(p.save.fpl, 2)} L/lap ({nf(-p.save.pct, 1)} %), about {nf(Math.abs(p.save.gainS), 0)} s quicker</div> : null}
                {live2}
                {pick ? (
                  <>
                    <div className={"fs-bar" + (dense ? " dense" : "")}>{pick.stints.map((t) => <div key={t.n} title={`Stint ${t.n}: laps ${t.from}–${t.to}`} className={"fs-seg" + (lapNow != null && lapNow >= t.from && lapNow <= t.to ? " now" : lapNow != null && lapNow > t.to ? " done" : "")} style={{ flex: t.laps }}>{dense ? null : <><b>{t.laps} laps</b><span>{t.from}–{t.to}</span></>}</div>)}</div>
                    <div className="fs-scroll" ref={stopsRef}><table className="t fx">
                      <thead><tr><th className="l s">Stint</th>{drivers > 1 ? <th className="s">Driver</th> : null}<th>Laps</th><th className="fs-t">Time</th><th className="d">Pit at end of lap</th><th>Fuel</th>{wide && pick.n <= 12 ? <th className="fs-t">Rejoin</th> : null}</tr></thead>
                      <tbody>
                        {pick.stints.map((t, k) => {
                          const last = k === pick.stints.length - 1;
                          return (
                            <tr key={t.n} className={lapNow != null && lapNow >= t.from && lapNow <= t.to ? "cur" : lapNow != null && lapNow > t.to ? "done" : undefined}>
                              <td className="l">{t.n}</td>
                              {drivers > 1 ? <td>D{who(t.n) + 1}</td> : null}
                              <td>{t.from}–{t.to} <span className="di">({t.laps})</span></td>
                              <td className="fs-t">{inp.lapS ? hms(t.laps * inp.lapS) : NONE}</td>
                              <td>{last ? <span className="di">flag</span> : <span className="stpc"><button type="button" className="btn" aria-label={`Pit ${t.n} one lap earlier`} disabled={!shift(k, -1)} onClick={() => move(k, -1)}>−</button><b>{t.to}</b><button type="button" className="btn" aria-label={`Pit ${t.n} one lap later`} disabled={!shift(k, 1)} onClick={() => move(k, 1)}>+</button></span>}</td>
                              <td className={t.add == null ? "" : "ac"} title={t.add == null ? "Fuel at the start" : `Arrive with ${nf(t.load - t.add, 1)} L, leave with ${nf(t.load, 1)} L`}>{t.add == null ? `start ${nf(Math.ceil(t.load), 0)} L` : `+${nf(t.add, 1)} L`}</td>
                              {wide && pick.n <= 12 ? <td className="fs-t" title="Where this stop would put you if nobody else stopped, from the gaps now">{(() => { const r = t.n > 1 ? rejoinAt(inp.lossS + t.stat) : null; return r == null ? NONE : "P" + r; })()}</td> : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table></div>
                    {drivers > 1 && inp.lapS ? (
                      <div className="fs-drv">
                        {Array.from({ length: drivers }, (_, d) => {
                          const mine = pick.stints.filter((t) => who(t.n) === d);
                          return <span key={d} title={`${mine.length} stints`}><b>D{d + 1}</b> {hms(mine.reduce((a, t) => a + t.laps, 0) * inp.lapS!)}</span>;
                        })}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
            <div className="f fs-act"><button type="button" className="btn" disabled={start == null} onClick={toPlan}>Put start fuel in pit plan</button><button type="button" className={"btn " + (same ? "gh" : "pr")} disabled={!pickPlan || same} title="Fuel to the flag shows it, and the pit plan can take each stop from it" onClick={setPlan}>{same ? "This is the race plan" : "Set as race plan"}</button>{shared ? <button type="button" className="btn gh" onClick={() => racePlan.clear()}>Clear race plan</button> : null}<span className="sp" />{handmade ? <button type="button" className="lnk" title="Back to the plan before you moved any stop" onClick={() => setMine(null)}>Reset moved stops</button> : null}</div>
          </div>
        </div>
      ),
    };
  },
});
