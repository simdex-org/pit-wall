import { useEffect, useRef } from "react";
import { defineModule } from "../engine/registry";
import { evaluate, flatten, FormulaError, level, Level } from "../lib/formula";
import { nf, NONE } from "../lib/format";
import { say } from "../state/bridge";

const COLOR = ["var(--txt)", "var(--warn)", "var(--bad)"];

defineModule({
  type: "custom", title: "Custom figure", group: "Custom",
  blurb: "Your own figure from a formula over the live data, with warning and critical thresholds: laps of fuel, tyre spread, anything.",
  size: { w: 2, h: 4, minW: 2, minH: 3, maxW: 12, maxH: 12 }, needs: ["reading", "summary"], requires: ["reading"],
  options: [
    { key: "formula", label: "Formula", type: "text", max: 200, def: "fuel_litres / fuel_per_lap", hint: "Names from the live data, + - * / ( ), min max abs round. Example: max(tyre_pressure_psi_fl, tyre_pressure_psi_fr) - min(tyre_pressure_psi_fl, tyre_pressure_psi_fr)" },
    { key: "label", label: "Label", type: "text", def: "Laps of fuel" },
    { key: "unit", label: "Unit", type: "text", def: "laps" },
    { key: "decimals", label: "Decimals", type: "number", min: 0, max: 3, step: 1, def: 1 },
    { key: "dir", label: "Alert when the figure is", type: "select", choices: [["off", "Never"], ["below", "Low (at or under the thresholds)"], ["above", "High (at or over the thresholds)"]], def: "below" },
    { key: "warn", label: "Warning at", type: "number", min: -100000, max: 100000, step: 0.01, def: 3 },
    { key: "crit", label: "Critical at", type: "number", min: -100000, max: 100000, step: 0.01, def: 1 },
    { key: "toast", label: "Message when it turns critical", type: "toggle", def: true },
  ],
  view({ ctx: c, opts }) {
    const was = useRef<Level>(0);
    const r = c.r;
    const vars = flatten([c.s, r?.fixed, r?.session, r?.car]);
    let v = NaN, err = "";
    try { v = evaluate(String(opts.formula), vars); } catch (e) { err = e instanceof FormulaError ? e.message : "cannot work this out"; }
    const lv = err ? 0 : level(v, String(opts.dir), opts.warn as number, opts.crit as number);
    const text = `${opts.label || "Custom figure"}: ${nf(v, opts.decimals as number)} ${opts.unit}`.trim();
    useEffect(() => {
      if (lv === 2 && was.current < 2 && opts.toast) say(text, 2);
      was.current = lv;
    }, [lv]); // eslint-disable-line react-hooks/exhaustive-deps
    if (err) {
      return {
        body: (
          <div className="fc" style={{ gap: 8, overflow: "auto", flex: 1 }}>
            <span style={{ color: "var(--warn)" }}>Formula: {err}.</span>
            <details className="mu" style={{ fontSize: 12 }}>
              <summary>Names you can use ({Object.keys(vars).length})</summary>
              <div style={{ columns: "14em", marginTop: 6, overflowWrap: "anywhere" }}>{Object.keys(vars).sort().map((k) => <div key={k}>{k}</div>)}</div>
            </details>
          </div>
        ),
      };
    }
    return {
      alert: [lv],
      body: (
        <div className="fc" style={{ justifyContent: "center", flex: 1, gap: 8 }}>
          <span className="lab">{String(opts.label) || "Custom figure"}</span>
          <span className="big" style={{ fontSize: 34, color: COLOR[lv] }}>{Number.isFinite(v) ? nf(v, opts.decimals as number) : NONE}{opts.unit ? <span className="u">{String(opts.unit)}</span> : null}</span>
          <span className="mu" style={{ fontSize: 11, overflowWrap: "anywhere" }}>{String(opts.formula)}</span>
        </div>
      ),
    };
  },
});
