import { ReactNode, useEffect, useRef, useState } from "react";
import { defineModule } from "../engine/registry";
import type { Ctx } from "../feed/store";
import type { Json } from "../feed/types";
import { MINUS, nf, NONE } from "../lib/format";
import { pressState, stateGlyph } from "../lib/states";
import { fv, unit, UnitChoice } from "../lib/units";
import { accessKey, post, say } from "../state/bridge";
import { feed } from "../feed/store";
import { usePrefs } from "../state/prefs";
import {
  Block, BLOCK_OF, changes, CORNERS, GROUPS, nowOf, OK_RES, PitPlan, planStore, pv, resOf, same, sentVal, show, usePlan, usePlanFlash,
} from "../state/plan";

const clock = (d: Date) => d.toLocaleTimeString([], { hour12: false });
const isPress = (k: string) => /^p\d$/.test(k);

const pstep = (u: UnitChoice) => ({ psi: 0.1, bar: 0.01, kpa: 1 } as Record<string, number>)[u.press] ?? 0.1;
const toInput = (psi: number, u: UnitChoice) => +unit("press", u).f(psi).toFixed(unit("press", u).d);

// ---------- a number with − and + ----------
function Num({ value, onValue, min, max, step, label, disabled, title }: {
  value: number; onValue: (v: number) => void; min?: number; max?: number; step: number; label: string; disabled?: boolean; title?: string;
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
    <span className="stp" title={title}>
      <button type="button" className="step" aria-label={`Decrease ${label}`} disabled={disabled} onClick={() => nudge(-1)}>−</button>
      <input type="number" min={min} max={max} step={step} aria-label={label} disabled={disabled} value={text}
        onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; setText(String(value)); }}
        onChange={(e) => { setText(e.target.value); const v = parseFloat(e.target.value); if (isFinite(v)) onValue(v); }} />
      <button type="button" className="step" aria-label={`Increase ${label}`} disabled={disabled} onClick={() => nudge(1)}>+</button>
    </span>
  );
}

// ---------- the plan ----------
interface Row {
  key: string; label: string; kind: "number" | "check" | "select" | "press"; min?: number; max?: number; step?: number; unit?: string; choices?: [string, string][];
}

interface SendProps { send: (only?: Block) => void; off: boolean; title: string }

function PlanRows({ c, plan, wet, results, flash, units, sendProps }: { c: Ctx; plan: PitPlan; wet: boolean; results: Record<string, ReactNode>; flash: ReadonlySet<string>; units: UnitChoice; sendProps: SendProps }) {
  const set = (patch: Partial<PitPlan>) => planStore.set({ ...plan, ...patch });
  const onCompound = (compound: "dry" | "wet") => {
    // A compound change resets the pressures to the middle of that compound's window.
    const [lo, hi] = compound === "wet" ? c.th.wet_psi : c.th.dry_psi, mid = +((lo + hi) / 2).toFixed(1);
    planStore.set({ ...plan, compound, pressures: [mid, mid, mid, mid] }, ["p0", "p1", "p2", "p3"]);
  };
  const input = (r: Row): ReactNode => {
    const k = r.key;
    if (r.kind === "check") return <input type="checkbox" aria-label={r.label} checked={!!pv(plan, k)} onChange={(e) => set({ [k]: e.target.checked } as Partial<PitPlan>)} />;
    if (r.kind === "select") {
      return (
        <select aria-label={r.label} value={String(pv(plan, k))}
          onChange={(e) => k === "compound" ? onCompound(e.target.value as "dry" | "wet") : set({ [k]: /^\d+$/.test(e.target.value) ? +e.target.value : e.target.value } as Partial<PitPlan>)}>
          {r.choices!.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>
      );
    }
    if (r.kind === "press") {
      const i = +k[1]!, u = unit("press", units);
      return (
        <>
          <Num value={toInput(plan.pressures[i]!, units)} step={pstep(units)} label={`Pressure ${r.label}`}
            onValue={(v) => { const q = plan.pressures.slice(); q[i] = +u.b(v).toFixed(2); planStore.set({ ...plan, pressures: q }); }} />
          <span className="u"> {u.u}</span>
        </>
      );
    }
    const dis = wet && k === "tyre_set";
    return (
      <>
        <Num value={pv(plan, k) as number} min={r.min} max={r.max} step={r.step!} label={r.label} disabled={dis} title={dis ? "Wet tyres have no sets in ACC" : undefined} onValue={(v) => set({ [k]: v } as Partial<PitPlan>)} />
        {r.unit ? <span className="u"> {r.unit}</span> : null}
      </>
    );
  };
  return (
    <>
      {GROUPS.map((g) => (
        <section className={`pc pc-${g.block}`} key={g.block}>
          <h3><span>{g.title}</span><button type="button" className="btn send" disabled={sendProps.off} title={sendProps.title} onClick={() => sendProps.send(g.block)}>Send</button></h3>
          <div className="pc-rows">
            {g.rows.map((r) => {
              const k = r.key, v = nowOf(c.pit, k), pl = pv(plan, k);
              const u = k === "fuel" ? " L" : "";
              const diff = !(wet && k === "tyre_set") && v != null && pl != null && !same(k, v, pl);
              const matters = typeof pl === "boolean" ? pl : BLOCK_OF[k] === "tyres" ? plan.tyres : BLOCK_OF[k] === "brakes" ? plan.brakes : true; // pads only matter with a brake change
              const sv = v === null ? sentVal(c.pitLog, k) : undefined, sent = sv !== undefined && pl != null && same(k, sv, pl);
              return (
                <div className={"pr" + (flash.has(k) ? " pp-new" : "")} data-row={k} key={k}>
                  <span className="pr-l">{r.label}</span>
                  <span className="pp-in">{input(r as Row)}</span>
                  <span className="pr-meta">
                    <span className="pr-now" title={isPress(k) || k === "fuel" || k === "tyre_set" ? "In the MFD now" : "ACC does not publish this field"}>
                      MFD <span className={v == null ? "s-dim" : ""} title={v === null ? "ACC does not publish this field" : ""}>{v == null ? NONE : show(k, v, units) + u}</span>
                    </span>
                    <span className="pr-chg">
                      {diff ? <span className="diff"><s>{show(k, v, units)}</s>→<b>{show(k, pl, units)}</b>{u}</span> : v === null && matters && !sent ? <span className="s-dim">→ {show(k, pl, units)}</span> : null}
                    </span>
                    <span className="pr-res">{results[k]}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

const CLOSE_TITLE = "Takes the pit page off the driver's screen (ACC's Cycle MFD: Insert, or vJoy button 6)";

function PitPlanBody({ c, confirmDefault }: { c: Ctx; confirmDefault: boolean }) {
  const plan = usePlan(), flash = usePlanFlash(), prefs = usePrefs(), units = prefs.units;
  const [confirm, setConfirm] = useState(confirmDefault);
  const [pending, setPending] = useState<{ only?: Block; text: string } | null>(null);
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

  const doSend = async (only: Block | undefined) => {
    if (sending) return; // one POST at a time: a double click would only earn a 409
    setPending(null);
    setMsg(only ? `Sending ${only}…` : "Sending the whole plan…");
    setSending(true);
    const n0 = jobsDone.current;
    const r = await post("/pit", only ? { ...plan, only: [only] } : plan);
    setSending(false);
    if (r.status === 202 && (!only || only === "repairs")) planStore.set({ ...plan, flip_suspension: false, flip_bodywork: false }); // a repair switch is one-shot
    // A job that ended while the POST was in flight already shows its outcome.
    setMsg((r.status === 202 || r.status === 409) && jobsDone.current !== n0 ? ""
      : r.status === 0 ? r.text : r.status === 202 ? "Sent. Typing it into the driver's pit page; keep ACC focused on the driver's PC."
      : r.status === 403 ? "Wrong or missing access key: Settings › Connection." : r.status === 409 ? "Busy (409): " + r.text + "." : "Refused: " + r.text);
  };
  const send = (only?: Block) => {
    if (sending) return;
    if (confirm) {
      const ch = changes(plan, c.pit, only, c.pitLog, units);
      setPending({ only, text: (only ? `Send ${only}: ` : "Send the whole plan: ") + (ch.length ? ch.join(" · ") : "nothing differs from the MFD") });
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

  // Rows that differ from the MFD, and what the last job did to each.
  let n = 0;
  const results: Record<string, ReactNode> = {};
  for (const g of GROUPS) {
    for (const r of g.rows) {
      const k = r.key, v = nowOf(p, k), pl = pv(plan, k);
      const diff = !(wet && k === "tyre_set") && v != null && pl != null && !same(k, v, pl);
      if (diff || (v === null && pl === true && !(sentVal(c.pitLog, k) !== undefined && same(k, sentVal(c.pitLog, k), pl)))) n++; // a switch ACC does not publish counts until a send typed it
      const res = wet && k === "tyre_set" ? { txt: "n/a (wet)", cls: "s-dim", title: "Wet tyres have no sets in ACC" } : resOf(job, k, plan, units);
      results[k] = res ? <span className={res.cls} title={res.title}>{res.txt}</span> : null;
    }
  }
  const res = job && job.state === "done" ? (job.res as Record<string, string> | undefined) ?? {} : {};
  const vals = Object.values(res), verified = vals.length > 0 && vals.every((x) => OK_RES.includes(x));
  const when = job && job.t ? clock(new Date(job.t * 1000)) : "";
  const stateText = !p ? "No pit control"
    : busy ? (closing ? "Closing the pit page" : "Applying") + (p.waiting_lift ? ": waiting for the driver to lift" : "…")
    : msg ? msg
    : job && job.state === "error" ? "Failed: " + job.msg
    : job && job.state === "done" ? `Applied ${when}${job.by ? ` by ${job.by}` : ""}${verified ? " · verified" : " · check the results"}${n ? ` · draft: ${n} change${n === 1 ? "" : "s"}` : ""}`
    : `Draft (${n} change${n === 1 ? "" : "s"})`;
  const stateCls = "pp-state" + (job && job.state === "error" && !msg ? " s-bad" : busy ? " s-warn" : "");
  const closeDisabled = !live || busy || noKey || closeUntil > performance.now();

  return (
    <div className="pp">
      <header className="pp-head">
        <div className="pp-hl">
          <p className={stateCls} role="status">{stateText}</p>
          <dl className="pp-sets kv">
            {live ? <><dt>Tyre set on the car</dt><dd className="n">{nf(p!.current_set, 0)}</dd><dt>Strategy tyre set</dt><dd className="n">{nf(p!.strategy_set, 0)}</dd></> : null}
          </dl>
        </div>
        <div className="pp-acts">
          <button type="button" className="btn" disabled={!live} onClick={copyMfd}>Copy MFD into plan</button>
          <button type="button" className="btn" disabled={closeDisabled} title={noKey ? "Needs the access key: Settings › Connection" : closing ? "The pit page is being closed" : CLOSE_TITLE} onClick={closePage}>Close pit page</button>
          <button type="button" className="btn primary" disabled={sendOff} title={sendTitle} onClick={() => send()}>Send whole plan</button>
        </div>
      </header>
      {pending ? (
        <div className="pp-confirm">
          <p>{pending.text}</p>
          <div className="pp-acts">
            <button type="button" className="btn primary" disabled={sendOff} autoFocus onClick={() => void doSend(pending.only)}>Send</button>
            <button type="button" className="btn" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
      <div className="pp-cards"><PlanRows c={c} plan={plan} wet={wet} results={results} flash={flash} units={units} sendProps={{ send, off: sendOff, title: sendTitle }} /></div>
      <footer className="pp-foot">
        <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> Confirm before sending</label>
        <p className="note">Each block sends on its own; only what is sent is touched on the driver's pit page. Fuel, tyre set and pressures are read back from the game. “MFD –” means ACC does not publish that field: it is typed in, but cannot be verified.</p>
      </footer>
    </div>
  );
}

export const pitPlan = defineModule({
  type: "pit-plan", title: "Pit stop", group: "Pit", blurb: "The next stop, typed into the driver's MFD: the whole plan or one block.",
  size: { w: 7, h: 22, minW: 6, minH: 12 }, multi: false, needs: ["pit", "reading", "config", "units"], requires: ["pit"], rate: 4,
  options: [{ key: "confirm", label: "Confirm before sending", type: "toggle", def: true }],
  view({ ctx: c, opts }) {
    const p = c.pit;
    return {
      info: p && p.status === "live" ? "ACC live" + (p.in_pit_lane ? " · in pit lane" : "") + (accessKey.value ? "" : " · no key") : p ? `ACC ${p.status}` : "",
      body: <PitPlanBody c={c} confirmDefault={!!opts.confirm} />,
    };
  },
});

// ---------- pit sends log ----------
export const pitLog = defineModule({
  type: "pit-log", title: "Pit sends", group: "Pit", blurb: "Every plan sent to the MFD: when, by whom, which blocks, and what came back.",
  size: { w: 5, h: 8, minW: 4, minH: 4 }, needs: ["pit"],
  view({ ctx: c }) {
    const list = c.pitLog.slice().reverse();
    if (!list.length) return { state: { kind: "empty", msg: "No plans sent yet." } };
    return {
      info: `${list.length} send${list.length > 1 ? "s" : ""}`,
      body: (
        <div className="pl">
          {list.map((e, i) => {
            const r = (e.res ?? {}) as Record<string, string>, v = Object.values(r);
            const ok = v.filter((x) => x === "ok").length, sent = v.filter((x) => x === "sent").length, bad = v.filter((x) => !OK_RES.includes(x)).length;
            const sum: ReactNode = e.state === "done"
              ? [ok > 0 && <span className="s-ok" key="o">✓ {ok} ok</span>, sent > 0 && <span key="s">sent {sent}</span>, bad > 0 && <span className="s-bad" key="b">✗ {bad}</span>].filter(Boolean).flatMap((x, j) => (j ? [" · ", x] : [x]))
              : <span className="s-bad">✗ {e.msg || "failed"}</span>;
            return (
              <details className="pl-e" key={i}>
                <summary>
                  <span className="n">{e.t ? clock(new Date(e.t * 1000)) : NONE}</span> <span>{e.by || "?"}</span> <span className="note">{((e.only as string[] | undefined) ?? []).join(", ")}</span> <span className="pl-r">{sum}</span>
                </summary>
                <dl className="kv">
                  {Object.keys(r).length ? Object.entries(r).map(([k, x]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd className={x === "ok" ? "s-ok" : OK_RES.includes(x) ? "s-dim" : "s-bad"}>{x}</dd></div>) : <><dt>{NONE}</dt><dd /></>}
                </dl>
              </details>
            );
          })}
        </div>
      ),
    };
  },
});

// ---------- pressure correction ----------
export const pressFix = defineModule({
  type: "press-fix", title: "Pressure correction", group: "Pit", blurb: "Hot pressures at the line against the window, and the cold pressures to set at the next stop.",
  size: { w: 4, h: 5, minW: 3, minH: 5 }, needs: ["summary", "config", "pit", "units"],
  view({ ctx: c }) {
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
    const d = pl.track_c_delta, tu = unit("temp", units);
    const use = () => {
      planStore.patch({ pressures: prop });
      feed.log(0, "PLAN", "Pressure corrections put in the pit plan");
      say("Pressure corrections put in the pit plan");
    };
    const rows: [ReactNode, ReactNode[]][] = [
      [<>Avg at line <span className="note">{pl.laps} lap{pl.laps > 1 ? "s" : ""}</span></>, (pl.psi as number[]).map((v) => {
        const s = pressState(v, sc);
        return <span className={s === "ok" ? "" : "s-" + (s === "bad" ? "bad" : s === "cold" ? "cold" : "warn")}>{pu(v)}{stateGlyph(s)}</span>;
      })],
      ["Correction", corr.map(dp)],
      [<>Cold to set <span className="note">{live ? "MFD" : "plan"} + corr.</span></>, prop.map((v) => <b>{pu(v)}</b>)],
    ];
    return {
      info: `window mid ${pu(mid)} ${u.u} · hot ≈ cold 1:1`,
      alert: [all ? 0 : 1],
      body: (
        <>
          <table className="tt pf">
            <thead><tr><th />{CORNERS.map((x) => <th className="n" key={x}>{x}</th>)}</tr></thead>
            <tbody>{rows.map(([l, v], i) => <tr key={i}><td>{l}</td>{v.map((x, j) => <td className="n" key={j}>{x}</td>)}</tr>)}</tbody>
          </table>
          <div className="pf-acts">
            <div className="sub pf-sub">
              <span>{all ? <b className="s-ok">● In the window</b> : `Window ${pu(lo)}–${pu(hi)} ${u.u}`}</span>
              {d != null && isFinite(d) && Math.abs(d) >= 0.5 ? <span>Track {d > 0 ? "+" : MINUS}{(Math.abs(d) * (tu.u === "°F" ? 1.8 : 1)).toFixed(1)}{tu.u} since stint start</span> : null}
            </div>
            <button type="button" className="btn" onClick={use}>Use in pit plan</button>
          </div>
        </>
      ),
    };
  },
});

