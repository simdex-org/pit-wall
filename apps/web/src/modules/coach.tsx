import { useEffect, useReducer, useRef, useState } from "react";
import { drawZone } from "../draw/coachplot";
import { loadTracks } from "../draw/map";
import { defineModule } from "../engine/registry";
import { fmtLap } from "../lib/format";
import { CornerReport, PHASES, progress, Report, snapshot, Snap } from "../lib/coach/report";
import { unit } from "../lib/units";
import { CoachMode, coachReport, isReport } from "../state/coach";
import { usePrefs } from "../state/prefs";
import { recorder } from "../state/recorder";
import { selection, useSelection } from "../state/selection";
import { lapName } from "./lapsel";

type Tab = "work" | "corners" | "habits";
const s2 = (ms: number) => (Math.abs(ms) / 1000).toFixed(2);
const PHASE_NAME: Record<(typeof PHASES)[number], string> = { entry: "Braking", mid: "Middle", exit: "Exit", straight: "Straight" };
const Delta = ({ ms, cls = "co-dv" }: { ms: number; cls?: string }) => <span className={`${cls} ${ms > 0 ? "up" : "dn"}`}>{ms > 0 ? "▲" : "▼"}{s2(ms)}</span>;

function ZoneCanvas({ rep, r, sp }: { rep: Report; r: CornerReport; sp: (v: number) => number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const bench = recorder.lapById(r.bench);
  useEffect(() => { if (cv.current && bench?.data) drawZone(cv.current, rep.subject.data, bench.data, r.corner, sp); });
  return <div className="cv" style={{ height: 96, flex: "none" }}><canvas ref={cv} aria-label={`${r.name}: speed and pedals, benchmark against this lap`} /></div>;
}

function Detail({ rep, r, sp, su, best }: { rep: Report; r: CornerReport; sp: (v: number) => number; su: string; best: boolean }) {
  const lap = r.bestLap ? recorder.lapById(r.bestLap) : null;
  const habit = r.kind === "loss" && r.matched
    ? r.matched.n >= 2 ? `Within reach of your best here in ${r.matched.n} of ${r.matched.of} laps: it is about repeating it.` : `Only ${r.matched.n} of ${r.matched.of} laps got this corner right: the approach has to change.`
    : "";
  return (
    <div className="co-det">
      {r.causes.length || r.unexplained >= 15 ? (
        <div className="fc" style={{ gap: 4 }}>
          {r.causes.map((c) => <div key={c.id} className="co-c"><span>{c.text}{c.external ? " (not the driving)" : ""}</span><span>{c.ms >= 5 ? `≈${s2(c.ms)} s` : ""}</span></div>)}
          {r.unexplained >= 15 ? <div className="co-c di"><span>Not explained by the pedals or steering</span><span>≈{s2(r.unexplained)} s</span></div> : null}
        </div>
      ) : null}
      {habit ? <span className="mu">{habit}</span> : null}
      {best && lap && r.potential >= 15 ? <span className="mu">Your best here: {lapName(lap)}, {s2(r.potential)} s faster in this corner.</span> : null}
      <ZoneCanvas rep={rep} r={r} sp={sp} />
      <div className="co-f">
        <span className="h">{r.name}</span><span className="h">{best ? "Best here" : "REF"}</span><span className="h">This lap</span>
        {r.facts.flatMap((f) => [<span key={f.label}>{f.label}</span>, <span key={f.label + "b"}>{f.b}</span>, <span key={f.label + "s"}>{f.s}</span>])}
      </div>
      <span className="di">Speed in {su}. REF solid, this lap dashed.</span>
    </div>
  );
}

export const coach = defineModule({
  type: "coach", title: "Lap coach", group: "Analysis", blurb: "Why a lap lost time, corner by corner, against another lap or against your best of each corner: the cause, what to try, the habits across the lap.",
  size: { w: 4, h: 22, minW: 3, minH: 8 }, needs: ["rec", "sel", "laps", "theme", "resize", "units"], rate: 5,
  options: [{ key: "against", label: "Compare the lap with", type: "select", choices: [["lap", "The REF lap"], ["best", "My best of each corner"]], def: "lap" }],
  view({ ctx: c, opts }) {
    const sel = useSelection();
    const p = usePrefs();
    const [ov, setOv] = useState<CoachMode | null>(null);
    const [tab, setTab] = useState<Tab | null>(null);
    const [all, setAll] = useState(false);
    const [, bump] = useReducer((n: number) => n + 1, 0);
    const mem = useRef<{ cur: Snap | null; prev: Snap | null }>({ cur: null, prev: null });
    useEffect(() => { void loadTracks().then(bump); }, []);
    const su = unit("speed", p.units), mode: CoachMode = ov ?? (opts.against === "best" ? "best" : "lap");
    const rep = coachReport(c, sel, sel.cmp ? mode : "best", su.f, su.u);
    if (!isReport(rep)) return { state: { kind: "empty", msg: rep.msg } };
    if (!mem.current.cur || mem.current.cur.lap !== rep.subject.id) { mem.current.prev = mem.current.cur; mem.current.cur = snapshot(rep); }
    const since = progress(mem.current.prev, rep);
    const loss = rep.corners.filter((x) => x.kind === "loss").sort((a, b) => b.delta - a.delta), gain = rep.corners.filter((x) => x.kind === "gain").sort((a, b) => a.delta - b.delta);
    const even = rep.corners.filter((x) => x.kind === "even"), shown = [...loss, ...gain, ...even.filter((x) => all || x.corner.n === sel.corner)];
    const at = tab ?? (rep.focus.length ? "work" : "corners"), best = !rep.bench;
    const sub = lapName(recorder.lapById(rep.subject.id)!), against = rep.bench ? lapName(recorder.lapById(rep.bench.id)!) : "your best of each corner";
    const mx = Math.max(1, ...PHASES.map((k) => Math.abs(rep.byPhase[k]))), mxc = Math.max(1, ...rep.corners.map((x) => Math.abs(x.delta)));
    const pick = (n: number) => selection.setCorner(sel.corner === n ? null : n);
    const det = (x: CornerReport) => (sel.corner === x.corner.n ? <Detail rep={rep} r={x} sp={su.f} su={su.u} best={best} /> : null);
    const focusCorners = rep.focus.map((f) => rep.corners.find((x) => x.corner.n === f.n)!);

    return {
      flush: true,
      headExtra: sel.cmp ? (
        <div className="seg">
          <button type="button" aria-pressed={mode === "lap"} onClick={() => setOv("lap")}>VS REF</button>
          <button type="button" aria-pressed={mode === "best"} onClick={() => setOv("best")}>VS MY BEST</button>
        </div>
      ) : null,
      info: `${sub} AGAINST ${against.toUpperCase()}`,
      body: (
        <div className="co">
          <div className="co-top">
            <div className="co-hd">
              <span className="lab">{best ? "On the table" : "Lap difference"}</span>
              <span className="sp" />
              <span className="mu v">{fmtLap(rep.subject.ms)}{rep.bench ? ` · ${fmtLap(rep.bench.ms)}` : ""}</span>
            </div>
            <div className="co-hd" style={{ marginTop: -4 }}>
              {best ? <span className={"big " + (rep.table > 0 ? "up" : "")}>{s2(rep.table)}<span className="u">s</span></span> : <span className={"big " + (rep.total > 0 ? "up" : "dn")}>{rep.total > 0 ? "▲" : "▼"} {s2(rep.total)}<span className="u">s</span></span>}
            </div>
            <div className="co-phs">
              {PHASES.map((k) => (
                <div className="co-ph" key={k} title={`${PHASE_NAME[k]}: ${rep.byPhase[k] > 0 ? "lost" : "gained"} ${s2(rep.byPhase[k])} s`}>
                  <span className="lab">{PHASE_NAME[k]}</span>
                  <b className={Math.abs(rep.byPhase[k]) < 10 ? "di" : rep.byPhase[k] > 0 ? "up" : "dn"}>{Math.abs(rep.byPhase[k]) < 10 ? "–" : `${rep.byPhase[k] > 0 ? "▲" : "▼"}${s2(rep.byPhase[k])}`}</b>
                  <i className={rep.byPhase[k] > 0 ? "" : "g"} style={{ width: (Math.abs(rep.byPhase[k]) / mx) * 100 + "%" }} />
                </div>
              ))}
            </div>
            {rep.notes.length ? <span className="co-note" title={rep.notes.join("\n")}>{rep.notes[0]}{rep.notes.length > 1 ? ` (+${rep.notes.length - 1} more)` : ""}</span> : null}
          </div>
          <div className="co-tabs" role="tablist">
            {([["work", "Work on", rep.focus.length], ["corners", "Corners", loss.length], ["habits", "Habits", rep.patterns.length]] as const).map(([k, l, n]) => (
              <button key={k} type="button" role="tab" aria-pressed={at === k} onClick={() => setTab(k)}>{l}<em>{n}</em></button>
            ))}
          </div>
          <div className="co-body">
            {at === "work" ? (
              <>
                {since.length ? <div className="co-sec"><span className="lab">Since the last tips</span><div className="fc" style={{ gap: 3, marginTop: 6 }}>{since.map((x) => <span key={x}>{x}</span>)}</div></div> : null}
                {focusCorners.length ? focusCorners.map((x, i) => (
                  <div key={x.corner.n}>
                    <div className={"co-card" + (sel.corner === x.corner.n ? " on" : "")} role="button" tabIndex={0} onClick={() => pick(x.corner.n)} onKeyDown={(e) => { if (e.key === "Enter") pick(x.corner.n); }}>
                      <div className="co-r1"><span className="co-n">{i + 1}</span><span className="co-nm">{x.name}</span><span className="sp" /><Delta ms={x.delta} /></div>
                      <span className="co-why">{x.causes[0]?.text}</span>
                      <span className="co-try"><b>Try</b>{x.tip}</span>
                    </div>
                    {det(x)}
                  </div>
                )) : <div className="co-empty">Nothing to work on: no corner is slower than your normal spread, or the cause is not clear enough to name.</div>}
              </>
            ) : at === "corners" ? (
              <>
                {shown.map((x) => (
                  <div key={x.corner.n}>
                    <div className={"co-row" + (sel.corner === x.corner.n ? " on" : "")} role="button" tabIndex={0} onClick={() => pick(x.corner.n)} onKeyDown={(e) => { if (e.key === "Enter") pick(x.corner.n); }}>
                      <div><span className="co-nm">{x.name}</span><span className="co-why">{x.kind === "gain" ? "Faster here" : x.kind === "even" ? "Within your normal spread" : x.causes[0]?.text ?? "Line or grip"}{x.kind === "loss" && x.conf === "low" ? " (unsure)" : ""}</span></div>
                      <div className="co-bar"><i className={x.delta > 0 ? "" : "g"} style={{ width: (Math.abs(x.delta) / mxc) * 100 + "%" }} /></div>
                      {x.kind === "even" ? <span className="co-dv di" style={{ textAlign: "right" }}>–</span> : <Delta ms={x.delta} />}
                    </div>
                    {det(x)}
                  </div>
                ))}
                {even.length ? <div className="co-more" role="button" tabIndex={0} onClick={() => setAll(!all)}>{all ? "Hide" : "Show"} {even.length} corner{even.length > 1 ? "s" : ""} within your normal spread</div> : null}
              </>
            ) : (
              rep.patterns.length ? <div className="co-sec fc" style={{ gap: 10 }}>{rep.patterns.map((q) => <span key={q.id}>{q.text}</span>)}</div>
                : <div className="co-empty">No habit yet: a cause needs to show in at least three corners before it counts as one.</div>
            )}
          </div>
        </div>
      ),
    };
  },
});
