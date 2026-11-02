import { ReactNode, useEffect, useRef, useState } from "react";
import { nextStop, useRacePlan } from "../state/racePlan";
import { defineModule } from "../engine/registry";
import type { Ctx } from "../feed/store";
import type { Json } from "../feed/types";
import { angleOf, arcPath, polar } from "../lib/arc";
import { clamp, MINUS, nf, NONE } from "../lib/format";
import { pressState } from "../lib/states";
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

function PitPlanBody({ c, confirmDefault }: { c: Ctx; confirmDefault: boolean }) {
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

  // ----- the figures the page shows -----
  const st = c.st, car = c.r?.car, max = c.r && c.r.fixed.max_fuel > 0 ? (c.r.fixed.max_fuel as number) : 0;
  const fpl = st?.fuel_per_lap || 0;
  const nowL = car?.fuel_litres ?? 0;
  const tankAfter = car ? Math.min(max || Infinity, nowL + plan.fuel) : null;
  const atFlag = st && st.spare_l != null ? st.spare_l + (plan.fuel - (st.add_at_box_l ?? 0)) : null;
  const pu = unit("press", units), pStep = pstep(units);
  const rp = useRacePlan(), planned = nextStop(rp, ((c.s?.stops as unknown[] | undefined) ?? []).length);
  const gMax = max || Math.max(120, nowL + plan.fuel);
  const aNow = angleOf(nowL, 0, gMax), aEnd = angleOf(Math.min(gMax, nowL + plan.fuel), 0, gMax);
  const [lo, hi] = wet ? c.th.wet_psi : c.th.dry_psi, pmin = lo - 3, pmax = hi + 4;
  const nowPct = clamp((nowL / gMax) * 100, 0, 100), addPct = clamp((plan.fuel / gMax) * 100, 0, 100 - nowPct);
  const bump = (d: number) => set({ fuel: clamp(plan.fuel + d, 0, 150) });

  const sendBtn = (blocks: Block[]) => <button type="button" className="btn sm" disabled={sendOff} title={sendTitle} onClick={() => send(blocks)}>Send</button>;
  const sw = (label: ReactNode, on: boolean, onSet: (v: boolean) => void) => <button type="button" className="pwb-sw" aria-pressed={on} onClick={() => onSet(!on)}><i />{label}</button>;
  const padSeg = (tag: string, k: "front_pad" | "rear_pad") => (
    <>
      <span className="lab">{tag}</span>
      <span className="seg pd">{PADS.map(([v]) => <button key={v} type="button" aria-pressed={String(plan[k]) === v} aria-label={`${tag === "F" ? "Front" : "Rear"} pad compound ${v}`} onClick={() => set({ [k]: +v } as Partial<PitPlan>)}>{v}</button>)}</span>
    </>
  );
  const pill = (
    <span className="pwb-fp">
      <button type="button" aria-label="Less fuel" title="1 L less" onClick={() => bump(-1)}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" /></svg></button>
      <button type="button" aria-label="More fuel" title="1 L more" onClick={() => bump(1)}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8M5 1v8" /></svg></button>
    </span>
  );
  const dial = (i: number) => {
    const now = nowOf(p, "p" + i) as number | null | undefined, planV = plan.pressures[i]!;
    const d = now != null ? planV - now : null;
    const cls = planV < lo ? "lo" : planV > hi ? "hi" : "ok";
    const aTick = now != null ? angleOf(now, pmin, pmax) : null;
    const t1 = aTick != null ? polar(60, 50, 34, aTick) : null, t2 = aTick != null ? polar(60, 50, 46, aTick) : null;
    return (
      <div key={i} className="pwb-dc">
        <div className="pwb-dial">
          <svg viewBox="0 0 120 94" aria-hidden="true">
            <path className="trk" d={arcPath(60, 50, 40, -135, 135)} strokeWidth="8" />
            <path className="win" d={arcPath(60, 50, 40, angleOf(lo, pmin, pmax), angleOf(hi, pmin, pmax))} strokeWidth="8" />
            <path className="val" d={arcPath(60, 50, 33, -135, angleOf(planV, pmin, pmax))} strokeWidth="3" />
            {t1 && t2 ? <line className="tick" x1={t1[0]} y1={t1[1]} x2={t2[0]} y2={t2[1]} strokeWidth="2" /> : null}
          </svg>
          <div className="pwb-dn"><b>{CORNERS[i]}</b><span className={d != null && d < 0 ? "dn2" : "up2"}>{d != null && Math.abs(d) >= 0.05 ? `${d < 0 ? "▼" : "▲"} ${Math.abs(pu.f(d) - pu.f(0)).toFixed(pu.d)}` : ""}</span></div>
        </div>
        <div className="pwb-ds">
          <span className={"pwb-st " + cls}>{cls === "lo" ? "Below" : cls === "hi" ? "Above" : "In window"}</span>
          <Stepper cls="sm" value={toInput(planV, units)} step={pStep} label={`${CORNERS[i]} cold pressure`}
            onValue={(v) => { const q = plan.pressures.slice(); q[i] = +pu.b(v).toFixed(2); planStore.set({ ...plan, pressures: q }); }} />
          <span className="mu pwb-ml" title={`The MFD shows ${now != null ? fv("press", now, units) : NONE} now`}>MFD {now != null ? fv("press", now, units) : NONE}</span>
        </div>
      </div>
    );
  };
  const winTxt = `${pu.f(lo).toFixed(pu.d)} to ${pu.f(hi).toFixed(pu.d)} ${pu.u}`;

  return (
    <div className="pw">
      <div className="pwb">
        <section className="pwb-fuel">
          <header className="pwb-h"><span className="lab">Fuel</span>{sendBtn(["fuel"])}</header>
          <div className="pwb-gauge" title={max ? `Tank ${nf(max, 0)} L` : ""}>
            <svg viewBox="0 0 240 190" aria-hidden="true">
              <path className="trk" d={arcPath(120, 105, 92, -135, 135)} strokeWidth="14" />
              {nowL > 0 ? <path className="now" d={arcPath(120, 105, 92, -135, aNow)} strokeWidth="14" /> : null}
              {plan.fuel > 0 ? <path className="add" d={arcPath(120, 105, 92, aNow, aEnd)} strokeWidth="14" /> : null}
            </svg>
            <div className="pwb-gc">
              <span className="lab">Add</span>
              <span className="pwb-gn">{plan.fuel}<small> L</small></span>
              <span className="mu pwb-tl">{car ? <>tank {nf(nowL, 1)} → <b>{nf(tankAfter ?? 0, 1)} L</b></> : null}</span>
            </div>
            <div className="pwb-pin">{pill}</div>
          </div>
          <div className="pwb-pr">{pill}</div>
          <div className="pwb-xs">
            <div className="pwb-xn"><span className="pwb-gn">{plan.fuel}<small> L</small></span>{pill}</div>
            <div className="pwb-bar" title={max ? `Tank ${nf(max, 0)} L` : ""}><i className="now" style={{ width: nowPct + "%" }} /><i className="add" style={{ width: addPct + "%" }} /></div>
          </div>
          <div className="pwb-pre">
            {[5, 10, 20].map((d) => <button key={d} type="button" className="pwb-chip" onClick={() => bump(d)}>+{d}</button>)}
            <button type="button" className="pwb-chip" disabled={!max || !car} title="Fill the tank" onClick={() => set({ fuel: Math.max(0, Math.floor(max - nowL)) })}>Fill</button>
          </div>
          <div className="pwb-pick">
            <button type="button" className="pwb-chip" disabled={st?.add_at_box_l == null} aria-pressed={st?.add_at_box_l != null && plan.fuel === Math.ceil(st.add_at_box_l)} title="What the strategy says to add" onClick={() => planStore.patch({ fuel: Math.ceil(st!.add_at_box_l) })}>Strategy {st?.add_at_box_l != null ? nf(st.add_at_box_l, 1) : NONE}</button>
            <button type="button" className="pwb-chip" disabled={!planned} aria-pressed={!!planned && plan.fuel === Math.ceil(planned.add)} title={planned ? `Your race plan, stop ${planned.n}: box after lap ${planned.lap}` : "No race plan"} onClick={() => planStore.patch({ fuel: Math.ceil(planned!.add) })}>Plan {planned ? nf(planned.add, 0) : NONE}</button>
          </div>
          <div className="pwb-figs">
            <div><span className="lab">Laps added</span><span className="v">{fpl > 0 ? "+" + nf(plan.fuel / fpl, 1) : NONE}</span></div>
            <div><span className="lab">At the flag</span><span className={"v " + (atFlag != null ? (atFlag < 0 ? "up" : "dn") : "")}>{atFlag != null ? (atFlag >= 0 ? "+" : MINUS) + nf(Math.abs(atFlag), 1) + " L" : NONE}</span></div>
          </div>
        </section>

        <section className="pwb-tyres">
          <header className="pwb-h pwb-th">
            <span className="lab">Tyres</span>
            <span className="pwb-ctl">
            {sw("Change tyres", plan.tyres, (v) => set({ tyres: v }))}
            <span className="pwb-dv" />
            <span className="pwb-grp" style={plan.tyres ? undefined : { opacity: 0.5 }}>
              <span className="seg">{(["dry", "wet"] as const).map((k) => <button key={k} type="button" aria-pressed={plan.compound === k} onClick={() => { const [l, h] = k === "wet" ? c.th.wet_psi : c.th.dry_psi, mid = +((l + h) / 2).toFixed(1); planStore.set({ ...plan, compound: k, pressures: [mid, mid, mid, mid] }, ["p0", "p1", "p2", "p3"]); }}>{k === "dry" ? "Dry" : "Wet"}</button>)}</span>
              <span className="pwb-set" style={wet ? { opacity: 0.4 } : undefined} title={wet ? "Wet tyres have no sets in ACC" : undefined}>
                <span className="lab">Set</span>
                <Stepper cls="sm" value={plan.tyre_set} min={1} max={50} step={1} label="Tyre set" disabled={wet} onValue={(v) => set({ tyre_set: v })} />
                <span className="mu pwb-oc">on car {live ? nf(p!.current_set, 0) : NONE}</span>
              </span>
            </span>
            </span>
            <span className="sp" />
            {sendBtn(["tyres", "pressures"])}
          </header>
          <div className="pwb-dials">{[0, 1, 2, 3].map(dial)}</div>
          <div className="pwb-legend"><span><i className="w" />window {winTxt}</span><span><i className="m" />MFD now</span><span><i className="p" />plan</span></div>
        </section>
      </div>

      <div className="pwb-svc">
        <span className="lab pwb-sl">Service</span>
        {sw("Brake pads", plan.brakes, (v) => set({ brakes: v }))}
        <span className="pwb-slot">{plan.brakes ? <>{padSeg("F", "front_pad")}{padSeg("R", "rear_pad")}</> : null}</span>
        <span className="pwb-dv" />
        {sw(<><span className="pwb-long">Repair suspension</span><span className="pwb-short">Suspension</span></>, plan.flip_suspension, (v) => set({ flip_suspension: v }))}
        {sw(<><span className="pwb-long">Repair bodywork</span><span className="pwb-short">Bodywork</span></>, plan.flip_bodywork, (v) => set({ flip_bodywork: v }))}
        <span className="sp" />
        {sendBtn(["brakes", "repairs"])}
      </div>
      {pending ? (
        <div className="f" style={{ padding: 8, gap: 8, borderTop: "1px solid var(--warn)", background: "color-mix(in srgb, var(--warn) 14%, transparent)", flex: "none" }}>
          <span style={{ flex: 1 }}>{pending.text}</span>
          <button type="button" className="btn pr" disabled={sendOff} autoFocus onClick={() => void doSend(pending.only)}>Send</button>
          <button type="button" className="btn" onClick={() => setPending(null)}>Cancel</button>
        </div>
      ) : null}
      <div className="pwb-foot">
        <button type="button" className="btn pr" disabled={sendOff} title={sendTitle} onClick={() => send()}>Send whole plan</button>
        <button type="button" className="btn" disabled={!live} onClick={copyMfd}>Copy MFD into plan</button>
        <button type="button" className="btn" disabled={closeDisabled} title={noKey ? "Needs the access key: Settings › Connection" : closing ? "The pit page is being closed" : CLOSE_TITLE} onClick={closePage}>Close pit page</button>
        <label className="f v mu" style={{ gap: 6, marginLeft: 6 }}><Switch label="Confirm before sending" on={confirm} onSet={setConfirm} />Confirm</label>
        <span className="sp" />
        <span className={"v " + (job && job.state === "error" && !msg ? "up" : busy ? "wn" : "mu")} role="status">{stateText || (n ? `${n} change${n === 1 ? "" : "s"}` : "No changes")}</span>
      </div>
    </div>
  );
}


export const pitPlan = defineModule({
  type: "pit-plan", title: "Pit stop", group: "Pit", blurb: "The next stop, typed into the driver's MFD: the whole plan or one block.",
  size: { w: 7, h: 13, minW: 6, minH: 9, maxH: 24 }, multi: false, needs: ["pit", "reading", "summary", "config", "units"], requires: ["pit"], rate: 4,
  options: [{ key: "confirm", label: "Confirm before sending", type: "toggle", def: true }],
  view({ ctx: c, opts }) {
    const p = c.pit, lap = c.st?.box_by_lap;
    return {
      flush: true,
      info: [p && p.status === "live" ? <span key="o" className="p">● MFD OPEN</span> : p ? `ACC ${p.status}` : "", p && p.status === "live" && p.in_pit_lane ? "IN PIT LANE" : "", lap != null ? `BOX LAP ${lap}` : "", accessKey.value ? "" : "NO KEY"],
      body: <PitPlanBody c={c} confirmDefault={!!opts.confirm} />,
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
const NAMES = ["Front left", "Front right", "Rear left", "Rear right"];
export const pressFix = defineModule({
  type: "press-fix", title: "Pressure correction", group: "Pit", blurb: "Hot pressures at the line against the window, and the cold pressures to set at the next stop.",
  size: { w: 4, h: 6, minW: 2, minH: 3, maxW: 5, maxH: 7 }, needs: ["summary", "config", "pit", "units"],
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
    const line = size.h < 5, fs = size.h >= 7 ? 24 : size.h >= 5 ? 20 : 16;
    return {
      flush: true,
      quick: <button type="button" className="btn sm" onClick={use}>Use in pit plan</button>,
      alert: [all ? 0 : 1],
      info: size.w >= 3 ? [`WINDOW ${pu(lo)}–${pu(hi)} ${u.u.toUpperCase()}`] : [],
      body: (
        <div className="fc" style={{ flex: 1, minHeight: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: line ? "1fr 1fr" : "auto auto", alignContent: line ? "stretch" : "center", gap: 4, padding: 6, flex: 1, minHeight: 0 }}>
            {[0, 1, 2, 3].map((i) => {
              const v =(pl.psi as number[])[i]!, s = pressState(v, sc), out = v > hi ? v - hi : v < lo ? v - lo : 0, cl = s === "ok" ? "" : s === "cold" ? "cd" : "wn";
              return (
                <div className={"dk " + (s === "ok" ? "o" : s === "bad" ? "b" : "w")} key={i} style={{ padding: line ? "2px 10px" : "9px 10px 6px", gap: line ? 2 : 3, justifyContent: line ? "space-between" : "center", flexDirection: line ? "row" : "column", alignItems: line ? "center" : undefined, minWidth: 0, overflow: "hidden" }}>
                  <div style={{ height: line ? undefined : 16, lineHeight: "16px", whiteSpace: "nowrap", overflow: "hidden", flex: "none" }}><span className="lab" style={{ color: "var(--t2)" }}>{size.h >= 5 ? NAMES[i] : CORNERS[i]}</span>{!line && out ? <span className="v up">{dp(out)}</span> : null}</div>
                  {line ? <span className="big ac" style={{ fontSize: fs }}>{pu(prop[i]!)}</span> : <>
                    <span className={"big " + cl} style={{ display: "block", flex: "none", height: Math.round(fs * 1.15), fontSize: fs, whiteSpace: "nowrap", lineHeight: 1.15, overflow: "hidden" }}><span style={{ display: "inline-block", minWidth: "3.4ch" }}>{pu(v)}</span><span className="u" style={{ fontSize: 11, marginLeft: 3 }}>{u.u}</span></span>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 4, whiteSpace: "nowrap", alignItems: "baseline", height: 16, flex: "none" }}><span className="v ac" style={{ fontSize: 12 }}>set {pu(prop[i]!)}</span>{size.h >= 6 ? <span className="v di" style={{ fontSize: 12 }}>now {pu(base[i]!)}</span> : null}</div></>}
                </div>
              );
            })}
          </div>
          {size.w >= 4 ? <div className="f" style={{ padding: "6px var(--pad)", flex: "none" }}><span className="v di">{all ? "● In the window" : "Set = MFD or plan + correction"}</span></div> : null}
        </div>
      ),
    };
  },
});
