import { useState } from "react";
import { defineModule } from "../engine/registry";
import { fuelPlan, PlanInputs } from "../lib/fuelplan";
import { fmtLap, MINUS, nf, NONE, plural } from "../lib/format";
import { lsGet, lsSet } from "../lib/storage";
import { say } from "../state/bridge";
import { planStore } from "../state/plan";
import { Kv } from "./cars";

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
const Litres = ({ v }: { v: number | null | undefined }) => <>{nf(v, 1)}<span className="u"> L</span></>;

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
  size: { w: 6, h: 20, minW: 4, minH: 10 }, needs: ["summary", "reading", "config"], rate: 2,
  view({ ctx: c }) {
    const [state, setState] = useState(load);
    const [sel, setSel] = useState<number | null>(null);
    const { v, f } = state;
    const update = (nv: Values, nf: Flags) => { setState({ v: nv, f: nf }); setSel(null); lsSet("pitwall.calc", { ...nv, tyres: nf.tyres, ...(nf.seq == null ? {} : { seq: nf.seq }) }); };
    const set = (k: string, val: string) => update({ ...v, [k]: val.trim() }, f);

    const st = c.st, cfg = (c.cfg?.strategy ?? {}) as Record<string, number | string | null>, fx = c.r?.fixed;
    // Live figures: the inputs' placeholders and the fallback of every empty field.
    const live: Record<string, number | null> = {
      fpl: st && st.fuel_per_lap > 0 ? st.fuel_per_lap : c.r && c.r.session.fuel_per_lap > 0 ? c.r.session.fuel_per_lap : null,
      lap: st && (st.my_pace_ms || st.lap_ref_ms) ? (st.my_pace_ms || st.lap_ref_ms) / 1000 : null,
      cap: fx && fx.max_fuel > 0 ? fx.max_fuel : null, reserve: cfg.reserve_laps as number | null, mand: cfg.mandatory_stops as number | null,
      loss: st ? st.drive_loss_s : (cfg.pit_loss_s as number | null), refuel: st ? st.refuel_s_per_l : (cfg.refuel_s_per_l as number | null),
      tyreS: st ? st.tyre_s : (cfg.tyre_s as number | null), minStat: cfg.min_stationary_s as number | null,
    };
    const ph: Record<string, string> = { race: "", extra: "0", formL: "0", maxStint: "none", wt: "0", lap: live.lap != null ? fmtLap(live.lap * 1000) : "m:ss.xxx" };
    for (const k of ["fpl", "cap", "reserve", "mand", "loss", "refuel", "tyreS", "minStat"]) ph[k] = live[k] == null ? "" : String(+(+live[k]!).toFixed(2));

    const n = (k: string) => num(v[k]);
    const or = (k: string, d: number | null): number | null => (n(k) != null ? n(k) : live[k] != null ? +live[k]! : d);
    const laps = v.unit === "laps";
    const seq = f.seq != null ? f.seq : cfg.fuel_and_tyres === "sequential";
    const inp: PlanInputs = {
      raceMin: laps ? null : n("race"), raceLaps: laps ? n("race") : null, extra: n("extra") || 0, lapS: v.lap ? lapSecs(v.lap) : live.lap ?? null,
      fpl: or("fpl", null), cap: or("cap", null), reserve: or("reserve", 1)!, formL: n("formL") || 0, mand: Math.round(or("mand", 0)!), maxStintMin: n("maxStint"),
      lossS: or("loss", 25)!, refuelSpl: or("refuel", 0.25)!, tyreS: or("tyreS", 30)!, tyres: f.tyres, seq, minStat: or("minStat", 0)!, wt: n("wt") || 0,
    };
    const p = fuelPlan(inp);
    const pick = p.total ? p.options.find((o) => o.n === sel) ?? p.best ?? p.options[0] : null;
    const start = pick && pick.ok ? pick.start : null;

    const clear = () => update({ unit: "min", lap: "" }, { tyres: true, seq: null });
    const toPlan = () => { if (start == null) return; const k = Math.ceil(start); planStore.patch({ fuel: k }); say(`Start fuel ${k} L put in the pit plan`); };

    let result: React.ReactNode;
    if (!p.total || !pick) {
      const miss = [!(((laps ? inp.raceLaps : inp.raceMin) ?? 0) > 0) && "the race length", !((inp.lapS ?? 0) > 0) && "a lap time", !((inp.fpl ?? 0) > 0) && "the fuel per lap"].filter(Boolean);
      result = <p className="note fc-miss">Still needed: {miss.join(", ")}. Grey figures are live values; an empty field uses them.</p>;
    } else {
      const capKnown = inp.cap != null && inp.cap > 0;
      const forced = inp.maxStintMin != null && inp.maxStintMin > 0 && Math.ceil((p.total * inp.lapS!) / (inp.maxStintMin * 60) - 1e-6) - 1 > (inp.mand || 0);
      const what: [string, React.ReactNode][] = [];
      if (p.save) what.push(["To save a stop", <>≤ {nf(p.save.fpl, 2)}<span className="u"> L/lap</span> <span className="note">{MINUS}{nf(p.save.pct, 1)} % of {nf(inp.fpl, 2)}, worth ≈ {nf(p.save.gainS, 0)} s</span></>]);
      for (const m of [0.95, 1.05, 1.1]) {
        const q = fuelPlan({ ...inp, fpl: inp.fpl! * m }).options.find((o) => o.n === pick.n);
        if (q) what.push([`${m < 1 ? MINUS : "+"}${Math.round(Math.abs(1 - m) * 100)} % consumption`, q.tank ? <><Litres v={q.start} /> to start</> : <span className="s-bad">■ no longer fits the tank</span>]);
      }
      result = (
        <>
          {!p.best ? <p className="s-bad">■ No plan fits: the tank ({capKnown ? nf(inp.cap, 0) + " L" : NONE}) cannot carry a stint of {plural(Math.ceil(p.total / 10), "lap")} or more. Check the fuel per lap and the tank.</p> : null}
          <div className="lbl">Start with</div>
          <div className="big">{nf(Math.ceil(pick.start), 0)}<span className="u"> L</span>{pick.tank ? null : <> <b className="tag low">TANK</b></>}</div>
          <div className="sub"><span><b>{pick.n}</b> {pick.n === 1 ? "stop" : "stops"}{pick === p.best ? " (fastest)" : ""}</span><span><b>{p.total}</b> laps</span><span>≈ <b>{hms(pick.timeS)}</b></span></div>
          {p.nMin > 0 ? <p className="note">Rules force at least {plural(p.nMin, "stop")}{forced ? " (the driver stint limit)" : ""}.</p> : null}
          <div className="fc-bar" role="img" aria-label={`${pick.stints.length} stints`}>
            {pick.stints.map((t) => (
              <div className="fc-seg" key={t.n} style={{ flex: `${t.laps} 1 0` }} title={`Stint ${t.n}: L${t.from}–${t.to}, ${nf(t.load, 0)} L loaded`}><b>S{t.n}</b> {t.laps} L<br /><span>{nf(t.load, 0)} L</span></div>
            ))}
          </div>
          <table className="tt fc-st">
            <thead><tr><th>Stint</th><th className="n">Laps</th><th className="n">Tank at start</th><th className="n">Add at stop</th><th className="n">Stationary</th></tr></thead>
            <tbody>
              {pick.stints.map((t) => (
                <tr key={t.n}><td>S{t.n} <span className="note">L{t.from}–{t.to}</span></td><td className="n">{t.laps}</td><td className="n">{nf(t.load, 1)}</td><td className="n">{t.add == null ? NONE : nf(t.add, 1)}</td><td className="n">{t.add == null ? NONE : nf(t.stat, 1) + " s"}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="lbl fc-h">Compare stop counts</div>
          <table className="tt fc-op">
            <thead><tr><th>Stops</th><th className="n">Start fuel</th><th className="n">Longest stint</th><th className="n">Race time</th><th>Check</th></tr></thead>
            <tbody>
              {p.options.map((o) => (
                <tr key={o.n} className={[o === pick && "so-best", !o.ok && "so-off"].filter(Boolean).join(" ") || undefined} onClick={() => setSel(o.n)}>
                  <td>{o === pick ? "▶ " : ""}{o.n}</td><td className="n">{nf(o.start, 0)} L</td><td className="n">{Math.max(...o.stints.map((t) => t.laps))} L</td>
                  <td className="n">{hms(o.timeS)}{p.best && o.ok && o !== p.best ? <span className="note"> {sgn(o.timeS - p.best.timeS, 0)} s</span> : null}</td>
                  <td>{o.ok ? (o === p.best ? "◆ fastest" : "ok") : !o.tank ? <span className="s-bad">■ over the tank</span> : <span className="s-warn">▲ below the rules</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="lbl fc-h">What if</div>
          <Kv rows={what} />
          <p className="note">Total fuel burnt {nf(p.total * inp.fpl!, 0)} L{capKnown ? "" : " (no tank size known: set it above)"}. Each stop is the pit loss ({nf(inp.lossS, 0)} s) plus the refuel or tyre time.</p>
        </>
      );
    }

    const field = (k: string, label: string, unit: string) => (
      <label className="fc-f" key={k} title={TIPS[k] ?? ""}>
        <span>{label}</span>
        <span className="fc-in"><input type="text" inputMode="decimal" autoComplete="off" value={v[k] ?? ""} placeholder={ph[k] ?? ""} onChange={(e) => set(k, e.target.value)} />{unit ? <i>{unit}</i> : null}</span>
      </label>
    );

    return {
      info: p.total && pick ? `${p.total} laps · ${pick.n} ${pick.n === 1 ? "stop" : "stops"}` : "",
      body: (
        <>
          <div className="fc-form">
            <label className="fc-f" title="Empty fields use the live value shown in grey.">
              <span>Race length</span>
              <span className="fc-in">
                <input type="text" inputMode="decimal" value={v.race ?? ""} onChange={(e) => set("race", e.target.value)} />
                <select value={v.unit} onChange={(e) => update({ ...v, unit: e.target.value as "min" | "laps" }, f)}><option value="min">min</option><option value="laps">laps</option></select>
              </span>
            </label>
            <label className="fc-f"><span>Lap time</span><span className="fc-in"><input type="text" value={v.lap ?? ""} placeholder={ph.lap} onChange={(e) => set("lap", e.target.value)} /></span></label>
            {FIELDS.map(([k, l, u]) => field(k, l, u))}
            <label className="fc-c"><input type="checkbox" checked={f.tyres} onChange={(e) => update(v, { ...f, tyres: e.target.checked })} /> Tyres at every stop</label>
            <label className="fc-c"><input type="checkbox" checked={seq} onChange={(e) => update(v, { ...f, seq: e.target.checked })} /> Fuel, then tyres</label>
          </div>
          <div className="rp-acts">
            <button type="button" className="btn" disabled={start == null} onClick={toPlan}>Put start fuel in pit plan</button>
            <button type="button" className="btn" onClick={clear}>Clear inputs</button>
          </div>
          <div className="fc-res">{result}</div>
        </>
      ),
    };
  },
});
