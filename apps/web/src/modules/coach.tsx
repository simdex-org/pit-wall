import { defineModule } from "../engine/registry";
import { nf } from "../lib/format";
import { unit } from "../lib/units";
import { coachReport, isReport } from "../state/coach";
import { usePrefs } from "../state/prefs";
import { selection, useSelection } from "../state/selection";

export const coach = defineModule({
  type: "coach", title: "Lap coach", group: "Analysis", blurb: "Where the reference lap loses time against the best of the session's laps, corner by corner, and what to change.",
  size: { w: 4, h: 14, minW: 3, minH: 6 }, multi: false, needs: ["rec", "sel", "laps", "units"],
  view({ ctx: c }) {
    const sel = useSelection(), p = usePrefs(), su = unit("speed", p.units);
    const rep = coachReport(c, sel, "lap", su.f, su.u);
    if (!isReport(rep)) return { state: { kind: "empty", msg: rep.msg } };
    const open = rep.corners.find((r) => r.corner.n === sel.corner) ?? null;
    return {
      flush: true,
      info: `${nf(rep.total, 2)} s to find`,
      body: (
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          {open ? <div className="v" style={{ padding: "var(--pad)", borderBottom: "1px solid var(--ln)" }}><b>Turn {open.corner.n}</b>: {open.cause ?? "Within the noise of your own laps."}{open.tip ? <><br />{open.tip}</> : null}</div> : null}
          <table className="t">
            <thead><tr><th>Turn</th><th className="r2">Zone</th><th className="r2">Best</th><th className="r2">Loss</th><th>Cause</th></tr></thead>
            <tbody>
              {rep.corners.map((r) => (
                <tr key={r.corner.n} aria-selected={r.corner.n === sel.corner} onClick={() => selection.setCorner(r.corner.n === sel.corner ? null : r.corner.n)} style={{ cursor: "pointer" }}>
                  <td>{r.corner.n}</td><td className="r2">{nf(r.ref, 2)}</td><td className="r2">{nf(r.best, 2)}</td>
                  <td className={"r2" + (r.loss ? " up" : "")}>{r.loss ? "▲ " + nf(r.loss, 2) : "–"}</td><td>{r.cause ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    };
  },
});
