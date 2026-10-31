import { ReactNode, useEffect, useRef, useState } from "react";
import { nextStop, useRacePlan } from "../state/racePlan";
import { defineModule } from "../engine/registry";
import type { Ctx } from "../feed/store";
import type { Json } from "../feed/types";
import { clamp, MINUS, nf, NONE } from "../lib/format";
import { pressState, stateGlyph } from "../lib/states";
import { fv, unit, UnitChoice } from "../lib/units";
import { accessKey, post, say } from "../state/bridge";
import { feed } from "../feed/store";
import { usePrefs } from "../state/prefs";
import {
  Block, changes, CORNERS, nowOf, OK_RES, PitPlan, planStore, pv, resOf, same, sentVal, show, usePlan, usePlanFlash,
} from "../state/plan";

const clock = (d: Date) => d.toLocaleTimeString([], { hour12: false });

const pstep = (u: UnitChoice) => ({ psi: 0.1, bar: 0.01, kpa: 1 } as Record<string, number>)[u.press] ?? 0.1;
const toInput = (psi: number, u: UnitChoice) => +unit("press", u).f(psi).toFixed(unit("press", u).d);

// ---------- a number with − and + (the design's stepper) ----------
function Stepper({ value, onValue, min, max, step, label, disabled, title, cls = "" }: {
  value: number; onValue: (v: number) => void; min?: number; max?: number; step: number; label: string; disabled?: boolean; title?: string; cls?: string;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(value)); }, [value]);
  const commit = (v: number) => {
    const x = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    setText(String(+x.toFixed(4)));
    onValue(x);
  };
  const nudge = (d: number) => commit((Number.isFinite(+text) ? +text : value) + d * step);
  return (
    <div className={"step " + cls} title={title}>
      <button type="button" aria-label={`Less ${label}`} disabled={disabled} onClick={() => nudge(-1)}>−</button>
      <input type="number" min={min} max={max} step={step} aria-label={label} disabled={disabled} value={text}
        onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; setText(String(value)); }}
        onChange={(e) => { setText(e.target.value); const v = parseFloat(e.target.value); if (isFinite(v)) onValue(v); }} />
      <button type="button" aria-label={`More ${label}`} disabled={disabled} onClick={() => nudge(1)}>+</button>
    </div>
  );
}

const Switch = ({ label, on, onSet }: { label: string; on: boolean; onSet: (v: boolean) => void }) => <input type="checkbox" className="sw" aria-label={label} checked={on} onChange={(e) => onSet(e.target.checked)} />;

const CLOSE_TITLE = "Takes the pit page off the driver's screen (ACC's Cycle MFD: Insert, or vJoy button 6)";
const PADS: [string, string][] = [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]];

function PitPlanBody({ c, confirmDefault, w, h }: { c: Ctx; confirmDefault: boolean; w: number; h: number }) {
  const plan = usePlan(), flash = usePlanFlash(), prefs = usePrefs(), units = prefs.units;
  const [confirm, setConfirm] = useState(confirmDefault);
  const [pending, setPending] = useState<{ only?: Block[]; text: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [closeUntil, setCloseUntil] = useState(0);
  const jobsDone = useRef(0);
  const lastJob = useRef<Json | null>(null);
  const [, tick] = useState(0);

  const p = c.pit, job = c.pitJob, live = !!p && p.status === "live", running = !!job && job.state === "running", busy = running || !!(p && p.busy);
  const closing = busy && !running && !!p && p.busy === "close"; // a Close pit page holds the bridge, not a plan
  const noKey = !accessKey.value;

  useEffect(() => { planStore.seed(c); }, [c.pit, c.pitJob]); // eslint-disable-line react-hooks/exhaustive-deps
  // The job's own outcome replaces "Sent…": count endings rather than compare clocks on two PCs.
  useEffect(() => {
    if (job && job !== lastJob.current && job.state !== "running") { jobsDone.current++; setMsg(""); }
    lastJob.current = job;
  }, [job]);
  useEffect(() => { if (flash.size) setMsg(""); }, [flash]);

  const wet = plan.compound === "wet"; // wet tyres have no sets in ACC: the bridge skips the tyre set
  const set = (patch: Partial<PitPlan>) => planStore.set({ ...plan, ...patch });

  const doSend = async (only: Block[] | undefined) => {
    if (sending) return; // one POST at a time: a double click would only earn a 409
    setPending(null);
    setMsg(only ? `Sending ${only.join(" and ")}…` : "Sending the whole plan…");
    setSending(true);
    const n0 = jobsDone.current;
    const r = await post("/pit", only ? { ...plan, only } : plan);
    setSending(false);
    if (r.status === 202 && (!only || only.includes("repairs"))) planStore.set({ ...plan, flip_suspension: false, flip_bodywork: false }); // a repair switch is one-shot
    // A job that ended while the POST was in flight already shows its outcome.
    setMsg((r.status === 202 || r.status === 409) && jobsDone.current !== n0 ? ""
      : r.status === 0 ? r.text : r.status === 202 ? "Sent. Typing it into the driver's pit page; keep ACC focused on the driver's PC."
      : r.status === 403 ? "Wrong or missing access key: Settings › Connection." : r.status === 409 ? "Busy (409): " + r.text + "." : "Refused: " + r.text);
  };
  const send = (only?: Block[]) => {
    if (sending) return;
    if (confirm) {
      const ch = only ? only.flatMap((b) => changes(plan, c.pit, b, c.pitLog, units)) : changes(plan, c.pit, undefined, c.pitLog, units);
      setPending({ only, text: (only ? `Send ${only.join(" and ")}: ` : "Send the whole plan: ") + (ch.length ? ch.join(" · ") : "nothing differs from the MFD") });
      return;
    }
    void doSend(only);
  };

  const closePage = async () => {
    setCloseUntil(performance.now() + 2000); // one Cycle MFD per 2 s: a second one would move the driver's MFD on to another page
    setTimeout(() => tick((n) => n + 1), 2000);
    setMsg("Closing the pit page…");
    const r = await post("/mfd/close", {});
    const m = r.status === 202 ? `Cycle MFD queued ${clock(new Date())}: the event log confirms the press; ACC does not say which MFD page shows, check with the driver`
      : r.status === 403 ? "Wrong or missing access key: Settings › Connection." : r.status === 0 ? r.text : "Refused: " + r.text;
    setMsg(m);
    if (r.status === 202) setTimeout(() => setMsg((cur) => (cur === m ? "" : cur)), 8000); // shown for 8 s once the press is done
  };

  const copyMfd = () => {
    if (!p || p.status !== "live") return;
    planStore.set({ ...plan, fuel: Math.round(p.fuel), tyre_set: p.tyre_set || 1, pressures: p.pressures.map((v: number) => +v.toFixed(1)) });
    setMsg("MFD copied into the plan.");
  };

  const sendOff = !live || busy || noKey || sending;
  const sendTitle = noKey ? "Needs the access key: Settings › Connection" : !live ? "ACC is not live on the driver's PC" : closing ? "The pit page is being closed" : busy ? "A plan is still being typed" : "";

  // Rows that differ from the MFD.
  let n = 0;
  for (const k of ["fuel", "tyres", "tyre_set", "compound", "p0", "p1", "p2", "p3", "brakes", "front_pad", "rear_pad", "flip_suspension", "flip_bodywork"]) {
    const v = nowOf(p, k), pl = pv(plan, k);
    const diff = !(wet && k === "tyre_set") && v != null && pl != null && !same(k, v, pl);
    if (diff || (v === null && pl === true && !(sentVal(c.pitLog, k) !== undefined && same(k, sentVal(c.pitLog, k), pl)))) n++; // a switch ACC does not publish counts until a send typed it
  }
  const res = job && job.state === "done" ? (job.res as Record<string, string> | undefined) ?? {} : {};
  const vals = Object.values(res), verified = vals.length > 0 && vals.every((x) => OK_RES.includes(x));
  const when = job && job.t ? clock(new Date(job.t * 1000)) : "";
  const stateText = !p ? "No pit control"
    : busy ? (closing ? "Closing the pit page" : "Applying") + (p.waiting_lift ? ": waiting for the driver to lift" : "…")
    : msg ? msg
    : job && job.state === "error" ? "Failed: " + job.msg
    : job && job.state === "done" ? `Applied ${when}${job.by ? ` by ${job.by}` : ""}${verified ? " · verified" : " · check the results"}${n ? ` · draft: ${n} change${n === 1 ? "" : "s"}` : ""}`
    : "";
  const closeDisabled = !live || busy || noKey || closeUntil > performance.now();

  // ----- the figures the columns show -----
  const st = c.st, car = c.r?.car, max = c.r && c.r.fixed.max_fuel > 0 ? (c.r.fixed.max_fuel as number) : 0;
  const fpl = st?.fuel_per_lap || 0;
  const tankAfter = car ? Math.min(max || Infinity, car.fuel_litres + plan.fuel) : null;
  const atFlag = st && st.spare_l != null ? st.spare_l + (plan.fuel - (st.add_at_box_l ?? 0)) : null;
  const pu = unit("press", units), pStep = pstep(units);
  const pressRow = (i: number) => {
    const now = nowOf(p, "p" + i) as number | null | undefined, planV = plan.pressures[i]!;
    const d = now != null ? planV - now : null;
    return (
      <div key={i}>
        <span className="lab" style={{ width: 26, color: "var(--t2)" }}>{CORNERS[i]}</span>
        <span className="v di" style={{ whiteSpace: "nowrap" }}>{now != null ? `${fv("press", now, units)} →` : NONE}</span>
        <span className="sp" />
        <Stepper cls="sm" value={toInput(planV, units)} step={pStep} label={`${CORNERS[i]} cold pressure`}
          onValue={(v) => { const q = plan.pressures.slice(); q[i] = +pu.b(v).toFixed(2); planStore.set({ ...plan, pressures: q }); }} />
        {d == null || Math.abs(d) < 0.05
          ? <span className="v di" style={{ width: 104, flex: "none", boxSizing: "border-box", paddingRight: 10, textAlign: "right" }} title="The pressure you set is the same as the MFD shows now">unchanged</span>
          : <span className={"v " + (d < 0 ? "dn" : "up")} style={{ width: 104, flex: "none", boxSizing: "border-box", paddingRight: 10, textAlign: "right", whiteSpace: "nowrap" }} title={`The MFD shows ${fv("press", now!, units)} now; you set ${Math.abs(pu.f(d) - pu.f(0)).toFixed(pu.d)} ${pu.u} ${d < 0 ? "lower" : "higher"}`}>{d < 0 ? "▼" : "▲"} {Math.abs(pu.f(d) - pu.f(0)).toFixed(pu.d)} {d < 0 ? "lower" : "higher"}</span>}
      </div>
    );
  };
  const rp = useRacePlan(), planned = nextStop(rp, ((c.s?.stops as unknown[] | undefined) ?? []).length), raceTyres = !!rp?.tyres;
  const four = w >= 8;
  const big = h >= 14;
  const lg = big ? "lg" : "";
  const head = (t: string, blocks: Block[], extra?: ReactNode) => <div className="hh"><span className="t2">{t}</span>{extra}<span className="sp" /><button type="button" className="btn sm" disabled={sendOff} title={sendTitle} onClick={() => send(blocks)}>Send</button></div>;
  const sw = (label: string, k: keyof PitPlan, mfd?: string) => (
    <div><span className="mu">{label}</span><span className="sp" /><Switch label={label} on={!!pv(plan, k)} onSet={(v) => set({ [k]: v } as Partial<PitPlan>)} />{mfd ? <span className="v di">{mfd}</span> : null}</div>
  );
  const cols = four ? 4 : 3;
  const rowsCss = `${big ? 36 : 30}px ${four ? 104 : big ? 96 : 64}px repeat(4,1fr)${big ? " 44px" : ""}`;
  const cell = (inner: ReactNode, cls = "", key?: string) => <div key={key} className={cls}>{inner}</div>;
  const last = (i: number) => (i === cols - 1 ? " lc" : "");
  const flashed = (k: string) => flash.has(k);
  void flashed;

  const mfdRows: [string, ReactNode][] = [
    ["Cursor on", p && live ? (p.cursor ?? NONE) : NONE], ["Fuel to add", p && live ? nf(p.fuel, 1) + " L" : NONE], ["Tyre set", p && live ? nf(p.tyre_set, 0) : NONE],
    ["Pressures", p && live && Array.isArray(p.pressures) ? p.pressures.map((v: number) => fv("press", v, units)).join(" ") : NONE],
  ];

  const grid: ReactNode[] = [];
  // header row
  grid.push(head("Fuel to add", ["fuel"], planned ? <button type="button" className="btn sm gh" style={{ marginLeft: 8 }} title={`Your race plan, stop ${planned.n}: box after lap ${planned.lap}, add ${nf(planned.add, 1)} L. Click to put it in the plan.`} onClick={() => planStore.patch({ fuel: Math.ceil(planned.add) })}>Plan {nf(planned.add, 0)} L</button> : null), head("Tyres", ["tyres", "pressures"]), <div key="hs" className={"hh" + last(2)}><span className="t2">Service</span><button type="button" className="btn sm" disabled={sendOff} title={sendTitle} onClick={() => send(["brakes", "repairs"])}>Send</button></div>);
  if (four) grid.push(<div key="hm" className="hh lc"><span className="t2">The MFD now</span><span className={"v " + (live && p?.open !== false ? "p" : "di")}>{live ? "● open" : "○ closed"}</span></div>);
  // hero row
  grid.push(
    <div key="f0" className="hr0"><span className="lab">Litres to add</span>
      <Stepper cls="lg" value={plan.fuel} min={0} max={150} step={1} label="Fuel to add in litres" onValue={(v) => set({ fuel: v })} />
</div>,
    <div key="t0" className="hr0"><span className="lab">Tyre set · on the car: set {live ? nf(p!.current_set, 0) : NONE}</span>
      <Stepper cls={lg} value={plan.tyre_set} min={1} max={50} step={1} label="Tyre set" disabled={wet} title={wet ? "Wet tyres have no sets in ACC" : undefined} onValue={(v) => set({ tyre_set: v })} /></div>,
    <div key="s0" className={"hr0" + last(2)}><span className="lab">Change tyres</span>
      <div className="f" style={{ gap: 10 }}><Switch label="Change tyres" on={plan.tyres} onSet={(v) => set({ tyres: v })} /><span className="v mu">{plan.tyres ? "yes, new set" : "no"}</span></div></div>,
  );
  if (four) grid.push(<div key="m0" className="hr0 lc"><span className="lab">Page</span><span className="mid">{live ? "Pit strategy" : NONE}</span></div>);
  // four rows
  const rowsF = [
    <><span className="mu">Strategy says</span><span className="v" style={{ marginLeft: "auto" }}>{st?.add_at_box_l != null ? nf(st.add_at_box_l, 1) + " L" : NONE}</span></>,
    <><span className="mu">Tank after the stop</span><span className="v" style={{ marginLeft: "auto" }}>{tankAfter != null ? nf(tankAfter, 1) + " L" : NONE}</span></>,
    <><span className="mu">Laps added</span><span className="v" style={{ marginLeft: "auto" }}>{fpl > 0 ? "+" + nf(plan.fuel / fpl, 1) : NONE}</span></>,
    <><span className="mu">At the flag</span><span className={"v " + (atFlag != null && atFlag < 0 ? "up" : "dn")} style={{ marginLeft: "auto" }}>{atFlag != null ? (atFlag >= 0 ? "+" : MINUS) + nf(Math.abs(atFlag), 1) + " L" : NONE}</span></>,
  ];
  const rowsS = [
    <><span className="mu">Brake pads</span><span className="sp" /><Switch label="Brake pads" on={plan.brakes} onSet={(v) => set({ brakes: v })} />{plan.brakes ? <><select aria-label="Front pads" value={String(plan.front_pad)} onChange={(e) => set({ front_pad: +e.target.value })}>{PADS.map(([v, l]) => <option key={v} value={v}>F {l}</option>)}</select><select aria-label="Rear pads" value={String(plan.rear_pad)} onChange={(e) => set({ rear_pad: +e.target.value })}>{PADS.map(([v, l]) => <option key={v} value={v}>R {l}</option>)}</select></> : null}</>,
    <><span className="mu">Repair suspension</span><span className="sp" /><Switch label="Repair suspension" on={plan.flip_suspension} onSet={(v) => set({ flip_suspension: v })} /></>,
    <><span className="mu">Repair bodywork</span><span className="sp" /><Switch label="Repair bodywork" on={plan.flip_bodywork} onSet={(v) => set({ flip_bodywork: v })} /></>,
    <><span className="mu">Compound</span><span className="sp" /><div className="seg">{(["dry", "wet"] as const).map((k) => <button key={k} type="button" aria-pressed={plan.compound === k} onClick={() => { const [lo, hi] = k === "wet" ? c.th.wet_psi : c.th.dry_psi, mid = +((lo + hi) / 2).toFixed(1); planStore.set({ ...plan, compound: k, pressures: [mid, mid, mid, mid] }, ["p0", "p1", "p2", "p3"]); }}>{k === "dry" ? "Dry" : "Wet"}</button>)}</div></>,
  ];
  for (let r = 0; r < 4; r++) {
    grid.push(<div key={"fr" + r}>{rowsF[r]}</div>, pressRow(r), <div key={"sr" + r} className={four ? "" : "lc"}>{rowsS[r]}</div>);
    if (four) grid.push(<div key={"mr" + r} className="lc"><span className="mu">{mfdRows[r]![0]}</span><span className="v" style={{ marginLeft: "auto" }}>{mfdRows[r]![1]}</span></div>);
  }
  if (big) {
    const share = max ? clamp(((car?.fuel_litres ?? 0) / max) * 100, 0, 100) : 0, add = max ? clamp((plan.fuel / max) * 100, 0, 100 - share) : 0;
    grid.push(
      <div key="ff"><div style={{ flex: 1 }}><div className="pb" style={{ height: 8, gap: 0, background: "var(--ln)" }}><i style={{ flex: "none", width: share + "%", background: "var(--t2)", padding: 0 }} /><i style={{ flex: "none", width: add + "%", background: "var(--ac)", padding: 0 }} /></div></div><span className="v di" style={{ fontSize: 10.5 }}>of {max ? nf(max, 0) : NONE} L</span></div>,
      <div key="ft"><span className="mu">Strategy</span><span className="sp" /><span className="v">{st?.press_line ? `${fv("press", st.press_line.psi?.[0], units)}` : NONE}</span></div>,
      <div key="fs" className={four ? "" : "lc"}><span className="v di">Each toggle sends with its column</span></div>,
    );
    if (four) grid.push(<div key="fm" className="lc"><span className="v di">{when ? `Last send ${when}` : "No send yet"}</span></div>);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="pg" style={{ gridTemplateColumns: `repeat(${cols},1fr)`, gridTemplateRows: rowsCss }}>{grid}</div>
      {pending ? (
        <div className="f" style={{ padding: 8, gap: 8, borderTop: "1px solid var(--warn)", background: "color-mix(in srgb, var(--warn) 14%, transparent)", flex: "none" }}>
          <span style={{ flex: 1 }}>{pending.text}</span>
          <button type="button" className="btn pr" disabled={sendOff} autoFocus onClick={() => void doSend(pending.only)}>Send</button>
          <button type="button" className="btn" onClick={() => setPending(null)}>Cancel</button>
        </div>
      ) : null}
      <div className="f" style={{ padding: big ? 12 : 8, borderTop: "1px solid var(--ln)", gap: big ? 10 : 8, flex: "none", flexWrap: "wrap" }}>
        <button type="button" className={"btn pr " + lg} disabled={sendOff} title={sendTitle} onClick={() => send()}>Send whole plan</button>
        <button type="button" className={"btn " + lg} disabled={!live} onClick={copyMfd}>Copy MFD into plan</button>
        <button type="button" className={"btn gh " + lg} disabled={closeDisabled} title={noKey ? "Needs the access key: Settings › Connection" : closing ? "The pit page is being closed" : CLOSE_TITLE} onClick={closePage}>Close pit page</button>
        <label className="f v mu" style={{ gap: 6, marginLeft: 8 }}><Switch label="Confirm before sending" on={confirm} onSet={setConfirm} />Confirm</label>
        <span className="sp" />
        <span className={"v " + (job && job.state === "error" && !msg ? "up" : busy ? "wn" : "mu")} role="status">{stateText || (n ? `${n} change${n === 1 ? "" : "s"}` : "No changes")}</span>
      </div>
    </div>
  );
}

export const pitPlan = defineModule({
  type: "pit-plan", title: "Pit stop", group: "Pit", blurb: "The next stop, typed into the driver's MFD: the whole plan or one block.",
  size: { w: 7, h: 16, minW: 6, minH: 12 }, multi: false, needs: ["pit", "reading", "summary", "config", "units"], requires: ["pit"], rate: 4,
  options: [{ key: "confirm", label: "Confirm before sending", type: "toggle", def: true }],
  view({ ctx: c, opts, size }) {
    const p = c.pit, lap = c.st?.box_by_lap;
    return {
      flush: true,
      info: [p && p.status === "live" ? <span key="o" className="p">● MFD OPEN</span> : p ? `ACC ${p.status}` : "", p && p.status === "live" && p.in_pit_lane ? "IN PIT LANE" : "", lap != null ? `BOX LAP ${lap}` : "", accessKey.value ? "" : "NO KEY"],
      body: <PitPlanBody c={c} confirmDefault={!!opts.confirm} w={size.w} h={size.h} />,
    };
  },
});

// ---------- pit sends log ----------
export const pitLog = defineModule({
  type: "pit-log", title: "Pit sends", group: "Pit", blurb: "Every plan sent to the MFD: when, by whom, which blocks, and what came back.",
  size: { w: 5, h: 8, minW: 4, minH: 4 }, needs: ["pit"],
  view({ ctx: c, size }) {
    const list = c.pitLog.slice().reverse();
    if (!list.length) return { state: { kind: "empty", msg: "No plans sent yet." } };
    const large = size.w >= 5;
    return {
      flush: true,
      info: [`${list.length} TODAY`],
      body: (
        <table className="t">
          <thead><tr><th>Time</th><th className="l">By</th><th className="l">Blocks</th><th className="l">{large ? "What came back" : "Result"}</th></tr></thead>
          <tbody>
            {list.map((e, i) => {
              const r = (e.res ?? {}) as Record<string, string>, v = Object.values(r);
              const bad = Object.entries(r).filter(([, x]) => !OK_RES.includes(x));
              const only = ((e.only as string[] | undefined) ?? []).join(", ");
              const result = e.state !== "done" ? <td className="l up">▲ {e.msg || "failed"}</td>
                : bad.length ? <td className="l up">▲ {bad[0]![0].replace(/_/g, " ")} {bad[0]![1]}{bad.length > 1 ? ` +${bad.length - 1}` : ""}</td>
                : <td className="l p">● {large ? (v.length ? "MFD matches the plan" : "sent") : "MFD matches"}</td>;
              return <tr key={i}><td>{e.t ? clock(new Date(e.t * 1000)) : NONE}</td><td className="l">{e.by || "?"}</td><td className="l">{only || "whole plan"}</td>{result}</tr>;
            })}
          </tbody>
        </table>
      ),
    };
  },
});

// ---------- pressure correction ----------
export const pressFix = defineModule({
  type: "press-fix", title: "Pressure correction", group: "Pit", blurb: "Hot pressures at the line against the window, and the cold pressures to set at the next stop.",
  size: { w: 4, h: 5, minW: 3, minH: 5 }, needs: ["summary", "config", "pit", "units"],
  view({ ctx: c, size }) {
    const prefs = usePrefs(), units = prefs.units, plan = usePlan();
    const pl = c.s?.press_line;
    if (!pl || !Array.isArray(pl.psi)) return { state: { kind: "empty", msg: "Needs a green lap at the line." } };
    const [lo, hi] = c.wet ? c.th.wet_psi : c.th.dry_psi, mid = (lo + hi) / 2;
    const live = !!c.pit && c.pit.status === "live" && Array.isArray(c.pit.pressures);
    const base: number[] = live ? c.pit!.pressures : plan.pressures;
    const corr: number[] = (pl.psi as number[]).map((v) => mid - v);
    const prop = base.map((v, i) => +(v + corr[i]!).toFixed(1));
    const u = unit("press", units), pu = (v: number) => fv("press", v, units);
    const dp = (d: number) => { const x = u.f(d) - u.f(0); return Math.abs(d) < 0.05 ? "0" : `${d > 0 ? "▲ +" : "▼ " + MINUS}${Math.abs(x).toFixed(u.d)}`; };
    const sc = { th: c.th, wet: c.wet, fuelLowLaps: 3 };
    const all = (pl.psi as number[]).every((v) => pressState(v, sc) === "ok");
    const use = () => {
      planStore.patch({ pressures: prop });
      feed.log(0, "PLAN", "Pressure corrections put in the pit plan");
      say("Pressure corrections put in the pit plan");
    };
    const large = size.w >= 4;
    const names = ["Front left", "Front right", "Rear left", "Rear right"];
    return {
      flush: large,
      alert: [all ? 0 : 1],
      info: large ? [`WINDOW ${pu(lo)}–${pu(hi)} ${u.u.toUpperCase()} HOT`] : [],
      body: large ? (
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <table className="t">
          <thead><tr><th className="l">Tyre</th><th>Hot at line</th><th>Window</th><th>Cold now</th><th>Set cold</th></tr></thead>
          <tbody>
            {names.map((nm, i) => {
              const v = (pl.psi as number[])[i]!, s = pressState(v, sc), out = v > hi ? v - hi : v < lo ? v - lo : 0;
              return <tr key={nm}><td className="l">{nm}</td><td className={s === "ok" ? "" : s === "cold" ? "cd" : "wn"}>{pu(v)}{stateGlyph(s)}</td><td className={out ? "up" : "dn"}>{out ? dp(out) : "●"}</td><td>{pu(base[i]!)}</td><td className="ac">{pu(prop[i]!)}</td></tr>;
            })}
          </tbody>
        </table>
        <div className="f" style={{ padding: "6px var(--pad)", marginTop: "auto" }}><span className="v di">{all ? "● In the window" : "Cold = MFD or plan + correction"}</span><span className="sp" /><button type="button" className="btn sm" onClick={use}>Use in pit plan</button></div>
        </div>
      ) : (
        <>
          <div className="g2" style={{ gap: "6px 16px" }}>{CORNERS.map((x, i) => <div className="r" key={x}><span>{x} set</span><span className="ac">{pu(prop[i]!)}</span></div>)}</div>
          <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} onClick={use}>Use in pit plan</button>
        </>
      ),
    };
  },
});
