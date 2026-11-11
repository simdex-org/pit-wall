import { useEffect, useMemo, useReducer, useState } from "react";
import { loadTracks, tracksLoaded } from "../draw/map";
import { defineModule } from "../engine/registry";
import type { Ctx } from "../feed/store";
import { buildReport, CornerReport, PHASE_NAME, PHASES, Report } from "../lib/coach/report";
import { fmtLap, NONE, plural } from "../lib/format";
import { Basis, DriverPace, driversOf, pairOf } from "../lib/teammates";
import { unit } from "../lib/units";
import { coachLaps, cornerNamer } from "../state/coach";
import { editor } from "../state/editor";
import { usePrefs } from "../state/prefs";
import { recorder } from "../state/recorder";
import { selection } from "../state/selection";
import { Delta } from "./delta";
import { autoSel } from "./lapsel";

const s3 = (ms: number) => (Math.abs(ms) / 1000).toFixed(3);
const BASIS: [Basis, string][] = [["best", "BEST"], ["typical", "TYPICAL"]];
// read by screen readers, not shown
const SR = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

// the benchmark lap as REF and the other driver's as CMP, so Traces, Lap map and Lap coach show the same two laps
function compare(bench: DriverPace, other: DriverPace, corner: number | null = null): void {
  autoSel.ref = autoSel.cmp = false;
  selection.select("ref", "lap-" + bench.pick!.n);
  selection.select("cmp", "lap-" + other.pick!.n);
  selection.setCorner(corner);
}

function useReport(c: Ctx, bench: DriverPace | undefined, other: DriverPace | undefined, sp: (v: number) => number, su: string): Report | { msg: string } {
  const a = bench?.pick?.n, b = other?.pick?.n, track = c.r?.fixed.track ?? "", len = c.r ? c.r.fixed.track_length_m : 0;
  useEffect(() => { for (const n of [a, b]) if (n) void recorder.ensureLap(n); }, [a, b]);
  const loaded = !!a && !!b && !!recorder.lapById("lap-" + a)?.data && !!recorder.lapById("lap-" + b)?.data;
  const key = [loaded, a, b, recorder.ver, c.laps.length, len, su, track, tracksLoaded()].join("|");
  return useMemo(() => {
    if (!a || !b) return { msg: "" };
    const gone = [a, b].find((n) => recorder.failed.has(n));
    if (gone) return { msg: `Lap ${gone} has no trace on the bridge any more.` };
    if (!loaded) return { msg: "Loading both laps from the bridges…" };
    return buildReport({ laps: coachLaps(c), subject: "lap-" + b, bench: "lap-" + a, len, sp, su, name: cornerNamer(track) });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

function PaceTable({ ds, bench, basis }: { ds: DriverPace[]; bench: string | null; basis: Basis }) {
  return (
    <table className="t">
      <thead><tr><th className="l">Driver</th><th>Best</th><th>Typical</th><th title="Half the driver's laps are closer than this to their typical lap"><span aria-hidden="true">±</span><span style={SR}>Spread</span></th><th>Laps</th><th title={`The ${basis} lap with a trace, compared below`}>Lap</th></tr></thead>
      <tbody>
        {ds.map((d) => (
          <tr key={d.name}>
            <td className={"l" + (d.name === bench ? " p" : "")}>{d.name === bench ? <span aria-hidden="true">● </span> : null}{d.name}{d.name === bench ? <span style={SR}> (benchmark)</span> : null}</td>
            <td>{fmtLap(d.best?.ms)}</td>
            <td>{fmtLap(d.typical)}</td>
            <td>{d.spread == null ? NONE : s3(d.spread)}</td>
            <td>{d.laps}</td>
            <td className="mu">{d.pick ? `L${d.pick.n}` : NONE}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CornerTable({ rep, onPick }: { rep: Report; onPick: (n: number) => void }) {
  const mx = Math.max(1, ...rep.corners.map((x) => Math.abs(x.delta)));
  const where = (x: CornerReport) => PHASE_NAME[PHASES.reduce((a, p) => (Math.abs(x.phases[p]) > Math.abs(x.phases[a]) ? p : a))];
  return (
    <table className="t">
      <thead><tr><th className="l">Corner</th><th><span aria-hidden="true">Δ</span><span style={SR}>Time difference</span></th><th className="l" style={{ width: "28%" }}><span style={SR}>Size</span></th><th className="l">Mostly in</th><th className="l">Why</th></tr></thead>
      <tbody>
        {rep.corners.map((x) => (
          <tr key={x.corner.n} style={{ cursor: "pointer" }} onClick={() => onPick(x.corner.n)}>
            <td className="l"><button type="button" className="lnk" aria-label={`${x.name}: show it in Traces, Lap map and Lap coach`} onClick={(e) => { e.stopPropagation(); onPick(x.corner.n); }}>{x.name}</button></td>
            <td><Delta ms={x.kind === "even" ? 0 : x.delta} /></td>
            <td className="l" aria-hidden="true">
              <i style={{ display: "block", height: 6, borderRadius: 3, width: `${(Math.abs(x.delta) / mx) * 100}%`, background: x.kind === "loss" ? "var(--bad)" : x.kind === "gain" ? "var(--ok)" : "var(--ln)" }} />
            </td>
            <td className="l mu">{x.kind === "even" ? NONE : where(x)}</td>
            <td className="l mu" style={{ whiteSpace: "normal" }}>{x.kind === "loss" ? x.causes[0]?.short ?? "" : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

defineModule({
  type: "teammates", title: "Teammate laps", group: "Analysis",
  blurb: "Drivers sharing the car, side by side: each one's best and typical lap, and corner by corner where one gains or loses time on the other.",
  size: { w: 6, h: 16, minW: 4, minH: 6 }, needs: ["laps", "rec", "units"], rate: 2,
  options: [
    { key: "basis", label: "Compare", type: "select", choices: [["best", "Each driver's best lap"], ["typical", "Each driver's typical lap (race pace)"]], def: "best",
      hint: "Typical is the lap nearest the driver's middle time of their flying laps: closer to what a stint looks like than one best lap." },
  ],
  view({ ctx: c, opts, id, size }) {
    const p = usePrefs(), su = unit("speed", p.units);
    const [, bump] = useReducer((n: number) => n + 1, 0);
    const [want, setWant] = useState<[string, string] | null>(null);
    useEffect(() => { void loadTracks().then(bump); }, []);
    const basis: Basis = opts.basis === "typical" ? "typical" : "best";
    const ds = driversOf(c.laps, basis), pair = pairOf(ds, basis, want);
    const rep = useReport(c, pair?.bench, pair?.other, su.f, su.u);
    const setBasis = (b: Basis) => editor.setOpt((m) => { m.options = { ...m.options, basis: b }; }, id);
    const head = (
      <div className="seg" role="group" aria-label="Compare">{BASIS.map(([b, l]) => <button key={b} type="button" aria-pressed={basis === b} onClick={() => setBasis(b)}>{l}</button>)}</div>
    );

    if (!ds.length) return { state: { kind: "empty", msg: "Each driver's laps appear here once the car is shared: switch Solo to Team in the Pit Wall window on every driver's PC." } };
    if (!pair) return { state: { kind: "empty", msg: `Only ${ds[0]!.name} has driven so far (${plural(ds[0]!.laps, "lap")}). The comparison starts after the first driver swap.` } };
    const { bench, other } = pair, small = size.h < 10 || size.w < 5;
    const gap = basis === "best" ? (other.best && bench.best ? other.best.ms - bench.best.ms : null) : other.typical != null && bench.typical != null ? other.typical - bench.typical : null;
    const pickable = !!bench.pick && !!other.pick;
    const summary = gap == null ? null : (
      <span>{other.name} is <b className={gap > 0 ? "up" : ""}>{s3(gap)} s</b> {gap >= 0 ? "slower than" : "faster than"} {bench.name} on {basis} laps</span>
    );
    const choose = ds.length > 2 ? (
      <div className="f" role="group" aria-label="Drivers to compare" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {([0, 1] as const).map((k) => (
          <select key={k} aria-label={k ? "Second driver" : "First driver"} value={(want ?? [ds[0]!.name, ds[1]!.name])[k]}
            onChange={(e) => { const w: [string, string] = [...(want ?? [ds[0]!.name, ds[1]!.name])] as [string, string]; w[k] = e.target.value; setWant(w); }}>
            {ds.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </select>
        ))}
      </div>
    ) : null;

    return {
      flush: true,
      headExtra: size.w >= 5 ? head : null,
      info: [`${bench.name.toUpperCase()} VS ${other.name.toUpperCase()}`],
      body: (
        <div className="fc" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {choose ? <div style={{ padding: "8px 8px 0" }}>{choose}</div> : null}
          <PaceTable ds={ds} bench={bench.name} basis={basis} />
          {summary ? <div className="mu" style={{ padding: "6px 8px" }}>{summary}</div> : null}
          {small ? null : !pickable ? (
            <div className="mu" style={{ padding: "6px 8px" }}>No {basis} lap with a trace yet for {!bench.pick ? bench.name : other.name}: the corner comparison needs one whole flying lap from each driver.</div>
          ) : "msg" in rep ? (
            <div className="mu" style={{ padding: "6px 8px" }} role="status">{rep.msg}</div>
          ) : (
            <>
              <div className="f" style={{ padding: "4px 8px", gap: 8, alignItems: "center", borderTop: "1px solid var(--ln)" }}>
                <span className="lab">Corner by corner</span>
                <span className="mu"><span aria-hidden="true">▲ </span>{other.name} loses time, <span aria-hidden="true">▼ </span>gains time</span>
                <span style={{ flex: 1 }} />
                <button type="button" className="btn sm" onClick={() => compare(bench, other)} title="REF and CMP in Traces, Lap map and Lap coach">Open in Traces</button>
              </div>
              {rep.notes.length ? <div className="mu" style={{ padding: "0 8px 6px" }}>{rep.notes[0]}</div> : null}
              <CornerTable rep={rep} onPick={(n) => compare(bench, other, n)} />
            </>
          )}
        </div>
      ),
    };
  },
});
