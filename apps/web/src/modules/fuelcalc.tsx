import { ReactNode, useState } from "react";
import { defineModule } from "../engine/registry";
import { FillLap, fromLaps } from "../lib/fuelfill";
import { fuelPlan, PlanInputs } from "../lib/fuelplan";
import { fmtLap, MINUS, nf, NONE, plural } from "../lib/format";
import { lsGet, lsSet } from "../lib/storage";
import { say } from "../state/bridge";
import { planStore } from "../state/plan";
import { expectedFuel, nextStop, racePlan, useRacePlan } from "../state/racePlan";

type Values = Record<string, string> & { unit?: "min" | "laps" };
type Flags = { tyres: boolean; seq: boolean | null };

const NUMS = ["race", "extra", "fpl", "cap", "reserve", "formL", "mand", "maxStint", "loss", "refuel", "tyreS", "minStat", "wt"];

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


/** [key, label, unit]; what each field means is in its title. An empty field uses the live figure shown as its placeholder. */
const FIELDS: [string, string, string][] = [
  ["fpl", "Fuel per lap", "L"], ["cap", "Tank", "L"], ["reserve", "Reserve", "laps"], ["extra", "Extra laps", "laps"], ["formL", "Formation", "L"],
  ["mand", "Mandatory stops", ""], ["maxStint", "Max driver stint", "min"], ["loss", "Pit loss", "s"], ["refuel", "Refuelling", "s/L"],
  ["tyreS", "Tyres", "s"], ["minStat", "Min. stationary", "s"], ["wt", "Weight / 10 L", "s/lap"],
];
const TIPS: Record<string, string> = {
  extra: "Laps driven after the timer reaches zero, on top of finishing the lap in progress (already counted).",
  reserve: "Laps of fuel left in the tank at the flag, and when you arrive at each stop.",
  formL: "Fuel burnt before lap 1 (formation lap, grid).",
  maxStint: "Longest time one driver may drive in a row: forces stops. Empty = no limit.",
  wt: "How much slower a lap is per 10 L of fuel carried (average over the lap). 0 = ignore; a stop then costs only its time.",
};

export const fuelCalc = defineModule({
  type: "fuel-calc", title: "Fuel & stints", group: "Strategy", blurb: "Plan the race: fuel to start with, stops, stint lengths and the fuel at each stop, from race length, lap time and consumption.",
  size: { w: 6, h: 20, minW: 4, minH: 10 }, needs: ["summary", "reading", "config", "laps"], rate: 2,
  view({ ctx: c, size }) {
    const [state, setState] = useState(load);
    const [sel, setSel] = useState<number | null>(null);
    const [mine, setMine] = useState<number[] | null>(null); // stop laps moved by hand
    const [safe, setSafe] = useState(false); // one more lap of fuel kept at every stop and at the flag
    const shared = useRacePlan();
    const { v, f } = state;
    const update = (nv: Values, nf: Flags) => { setState({ v: nv, f: nf }); setSel(null); setMine(null); lsSet("pitwall.calc", { ...nv, tyres: nf.tyres, ...(nf.seq == null ? {} : { seq: nf.seq }) }); };
    const set = (k: string, val: string) => update({ ...v, [k]: val.replace(k === "lap" ? /[^0-9.,:]/g : /[^0-9.,]/g, "") }, f);

    const st = c.st, cfg = (c.cfg?.strategy ?? {}) as Record<string, number | string | null>, fx = c.r?.fixed;
    // Live figures: the inputs' placeholders and the fallback of every empty field.
    const live: Record<string, number | null> = {
      fpl: st && st.fuel_per_lap > 0 ? st.fuel_per_lap : c.r && c.r.session.fuel_per_lap > 0 ? c.r.session.fuel_per_lap : null,
      lap: st && (st.my_pace_ms || st.lap_ref_ms) ? (st.my_pace_ms || st.lap_ref_ms) / 1000 : null,
      cap: fx && fx.max_fuel > 0 ? fx.max_fuel : null, reserve: cfg.reserve_laps as number | null, mand: cfg.mandatory_stops as number | null,
      loss: st ? st.drive_loss_s : (cfg.pit_loss_s as number | null), refuel: st ? st.refuel_s_per_l : (cfg.refuel_s_per_l as number | null),
      tyreS: st ? st.tyre_s : (cfg.tyre_s as number | null), minStat: cfg.min_stationary_s as number | null,
    };
    // The race length the game gives: the lap count, or the bridge's estimate from the time left and the leader's pace.
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
    const even = p.total ? p.options.find((o) => o.n === sel) ?? p.best ?? p.options[0] : null;
    // Stop laps moved by hand count only while they still fit the race and the chosen number of stops.
    const handmade = even && p.total && mine && mine.length === even.n && mine.every((x, k) => x >= 1 && x < p.total! && (k === 0 || x > mine[k - 1]!)) ? p.build(mine) : null;
    const pick = handmade ?? even;
    // How far a stop may move: the stints either side must still fit the tank.
    // Where a stop that costs this many seconds would put you, against the field as it is now (nobody else stops).
    const me = c.me != null ? c.cars.get(c.me) : undefined, ref = st?.lap_ref_ms ?? 0;
    const rejoinAt = (lossS: number): number | null => {
      if (!me || me.gap == null || !(ref > 0) || ses?.kind !== "Race") return null;
      const mine = me.gap + me.gap_laps * ref + lossS * 1000;
      return 1 + [...c.cars.values()].filter((x) => x.i !== me.i && x.gap != null && x.loc === "track" && x.gap + x.gap_laps * ref < mine).length;
    };
    const rejoins = (o: { stints: { stat: number }[] }) => o.stints.slice(1).map((t) => rejoinAt(inp.lossS + t.stat));
    const range = (k: number, stops: number[]) => {
      const prev = k ? stops[k - 1]! : 0, next = k < stops.length - 1 ? stops[k + 1]! : p.total!, mx = (j: number) => (j === 0 ? p.maxStint.first : p.maxStint.rest);
      return [Math.max(prev + 1, next - mx(k + 1)), Math.min(next - 1, prev + mx(k))] as const;
    };
    const move = (k: number, d: number) => {
      if (!pick || !p.total) return;
      const stops = pick.stints.slice(1).map((t) => t.from - 1), [lo, hi] = range(k, stops), v = Math.max(lo, Math.min(hi, stops[k]! + d));
      if (v !== stops[k]) setMine(stops.map((x, j) => (j === k ? v : x)));
    };
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

    // 13 + 13 + 13 + 10 reads as "13 L ×3, 10 L".
    const addsOf = (o: { stints: { add: number | null }[] }) => {
      const runs: [string, number][] = [];
      for (const t of o.stints.slice(1)) { const a = nf(t.add!, 0); if (runs.length && runs[runs.length - 1]![0] === a) runs[runs.length - 1]![1]++; else runs.push([a, 1]); }
      return runs.map(([a, n]) => (n > 1 ? `${a} L ×${n}` : `${a} L`)).join(", ");
    };
    // What one more lap of fuel at every stop and at the flag costs, whichever side of it the plan is on.
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
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div className="fc" style={{ width: 330, flex: "none", padding: 12, borderRight: "1px solid var(--ln)", overflow: "auto" }}>
            <span className="lab">Inputs</span>
            <div className="r"><span>Race length</span>{raceInput("f fi")}</div>
            <div className="r"><span>Lap time</span><div className="f fi"><input className="inp sm" placeholder={ph.lap} value={v.lap ?? ""} aria-label="Lap time" onChange={(e) => set("lap", e.target.value)} /><span className="v di">m:ss.xxx</span></div></div>
            {FIELDS.map(([k, l, u]) => fld(k, l, u))}
            <label className="f v mu" style={{ minHeight: 28 }}><input type="checkbox" className="sw" checked={f.tyres} onChange={(e) => update(v, { ...f, tyres: e.target.checked })} /> Tyres at every stop</label>
            <label className="f v mu" style={{ minHeight: 28 }}><input type="checkbox" className="sw" checked={seq} onChange={(e) => update(v, { ...f, seq: e.target.checked })} /> Fuel, then tyres</label>
            <div className="f" style={{ marginTop: 8 }}><button type="button" className="btn" title="Fuel per lap and lap time from the clean laps of practice, qualifying and this session; empty fields take the live figures." onClick={autoFill}>Auto-fill</button><button type="button" className="btn gh" onClick={clear}>Clear inputs</button></div>
            <span className="v di" style={{ marginTop: 8 }}>Auto-fill uses the clean laps of practice, qualifying and this session.</span>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
            {!ok ? <div className="v mu" style={{ padding: 12 }}>Still needed: {miss.join(", ")}. Grey figures are live values; an empty field uses them.{liveRace && miss.includes("the race length") ? <div style={{ marginTop: 10 }}><button type="button" className="btn pr" onClick={useRace}>Use this race: {liveRace} laps</button></div> : null}</div> : (
              <>
                {!p.best ? <div className="v up" style={{ padding: "8px 12px" }}>▲ No plan fits: the tank ({capKnown ? nf(inp.cap, 0) + " L" : NONE}) cannot carry a stint of {plural(Math.ceil((p.total ?? 0) / 10), "lap")} or more.</div> : null}
                {cells}
                {live2}
                {pick ? (
                  <>
                    <div className="fs-h">The plan <span>start with {nf(Math.ceil(pick.start), 0)} L{pick.n === 0 ? ", no stop needed" : ""}{handmade ? " · stop laps moved by hand" : ""}</span>{handmade ? <button type="button" className="btn sm gh" style={{ marginLeft: 12 }} onClick={() => setMine(null)}>Back to even stints</button> : null}</div>
                    <div className="fs">
                      <div className="fs-bar">{pick.stints.map((t) => <div key={t.n} className={"fs-seg" + (lapNow != null && lapNow >= t.from && lapNow <= t.to ? " now" : "")} style={{ flex: t.laps }}><b>{t.laps} laps</b><span>{t.from}–{t.to}</span></div>)}</div>
                      <div className="fs-add">{pick.stints.slice(1).map((t) => <span key={t.n} style={{ left: ((t.from - 1) / (p.total ?? 1)) * 100 + "%" }}>+{nf(t.add!, 0)} L</span>)}</div>
                    </div>
                    {pick.n > 0 ? (
                      <table className="t">
                        <thead><tr><th className="l">Stop</th><th>Box after lap</th><th>Can move</th><th>Arrive with</th><th>Add</th><th>Leave with</th><th>Rejoin</th></tr></thead>
                        <tbody>
                          {pick.stints.slice(1).map((t) => (
                            <tr key={t.n} className={lapNow != null && lapNow <= t.from - 1 && (t.n === 2 || lapNow > pick.stints[t.n - 2]!.from - 1) ? "cur" : undefined}>
                              <td className="l">{t.n - 1}</td>
                              <td><span className="f" style={{ justifyContent: "flex-end", gap: 6 }}><button type="button" className="btn sm" aria-label={`Stop ${t.n - 1} one lap earlier`} onClick={() => move(t.n - 2, -1)}>−</button><b style={{ minWidth: 22, textAlign: "center" }}>{t.from - 1}</b><button type="button" className="btn sm" aria-label={`Stop ${t.n - 1} one lap later`} onClick={() => move(t.n - 2, 1)}>+</button></span></td>
                              <td className="di">{(() => { const [lo, hi] = range(t.n - 2, pick.stints.slice(1).map((q) => q.from - 1)); return lo < hi ? `lap ${lo}–${hi}` : "fixed"; })()}</td><td>{nf(t.load - t.add!, 1)} L</td><td className="ac">+{nf(t.add!, 1)} L</td><td>{nf(t.load, 1)} L</td><td title="Where this stop would put you if nobody else stopped, from the gaps now">{(() => { const r = rejoinAt(inp.lossS + t.stat); return r == null ? NONE : "P" + r; })()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : null}
                  </>
                ) : null}
                <div className="fs-h">Smart pit <span>every stop count with the fuel for each stop; click a row to plan with it</span></div>
                <table className="t">
                  <thead><tr><th className="l">Stops</th><th>Start with</th><th className="l">Adds at the stops</th><th>Rejoins</th><th>Race time</th><th className="l">Verdict</th></tr></thead>
                  <tbody>
                    {p.options.map((o) => (
                      <tr key={o.n} className={o === pick ? "cur" : undefined} onClick={() => { setSel(o.n); setMine(null); }} style={{ cursor: "pointer" }}>
                        <td className="l">{o.n}{o === pick ? " · shown" : ""}</td><td>{nf(o.start, 1)} L</td><td className="l">{o.n ? addsOf(o) : NONE}</td><td title="Where each stop would put you if nobody else stopped, from the gaps now">{o.n ? rejoins(o).map((r) => (r == null ? NONE : "P" + r)).join(", ") : NONE}</td>
                        <td className={o.ok ? "" : "di"}>{o.ok ? hms(o.timeS) : NONE}</td>
                        <td className={"l " + (!o.ok ? "up" : o === p.best ? "p" : "wn")}>{!o.ok ? (!o.tank ? "Tank too small" : "Fewer than the mandatory stops") : o === p.best ? "● Fastest" : o === p.options.find((q) => q.ok) ? `Fewest stops, ${sgn(o.timeS - p.best!.timeS, 0)} s slower` : p.best ? `${sgn(o.timeS - p.best.timeS, 0)} s slower` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <label className="f v xl" title="Keep one more lap of fuel at every stop and at the flag">
                  <input type="checkbox" className="sw" checked={safe} onChange={(e) => { setSafe(e.target.checked); setSel(null); setMine(null); }} />
                  <span>Extra lap of fuel</span><span className="sp" />
                  {safeCost != null ? <span className="mu">{safeCost < 1 ? "no time lost" : (safe ? "+" : "would add ") + nf(safeCost, 0) + " s"}</span> : null}
                </label>
                {p.save ? <div className="v mu xl" title={`Burn ${nf(p.save.fpl, 2)} L a lap instead of ${nf(inp.fpl ?? 0, 2)} and you need one stop fewer`}>Save a stop: {nf(p.save.fpl, 2)} L/lap ({nf(-p.save.pct, 1)} %), about {nf(Math.abs(p.save.gainS), 0)} s quicker</div> : null}
              </>
            )}
            <div className="sp" />
            <div className="f" style={{ padding: 12, borderTop: "1px solid var(--ln)" }}><button type="button" className="btn" disabled={start == null} onClick={toPlan}>Put start fuel in pit plan</button><button type="button" className={"btn " + (same ? "gh" : "pr")} disabled={!pickPlan || same} title="Fuel to the flag shows it, and the pit plan can take each stop from it" onClick={setPlan}>{same ? "This is the race plan" : "Set as race plan"}</button>{shared ? <button type="button" className="btn gh" onClick={() => racePlan.clear()}>Clear race plan</button> : null}<span className="v mu">{start != null ? nf(Math.ceil(start), 0) + " L" : ""}</span></div>
          </div>
        </div>
      ),
    };
  },
});
