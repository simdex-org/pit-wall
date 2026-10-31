import { useRef, useState } from "react";
import { defineModule } from "../engine/registry";
import { fmtLap, nf } from "../lib/format";
import { sevOf, sortAdvice } from "../lib/advice";
import { lsRaw, lsSet } from "../lib/storage";
import { recorder } from "../state/recorder";

const CATEGORIES = ["LAP", "PIT", "FLAG", "CAR", "ENG", "PLAN", "CFG", "RC", "FIELD"];
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour12: false });
/** The tag colour of an event type: pits and flags amber, a lap that went well green, a problem red. */
const TAG: Record<string, string> = { PIT: "wn", FLAG: "wn", LAP: "p", CAR: "up", ENG: "n", PLAN: "n", CFG: "n", RC: "n", FIELD: "n" };
const GROUPS: [string, string[]][] = [["ALL", []], ["LAPS", ["LAP"]], ["PITS", ["PIT", "PLAN"]], ["FLAGS", ["FLAG", "RC"]]];

export const eventLog = defineModule({
  type: "event-log", title: "Events", group: "Log", blurb: "Everything logged: laps, pits, flags, race control, the field, plans sent.",
  size: { w: 8, h: 22, minW: 4, minH: 6 }, needs: ["log"],
  view({ ctx, size }) {
    const [off, setOff] = useState(() => new Set(["FIELD"]));
    const [group, setGroup] = useState(0);
    const [q, setQ] = useState("");
    const all = ctx.log;
    const only = GROUPS[group]![1];
    const shown = all.filter((e) => (only.length ? only.includes(e.cat) : !off.has(e.cat)) && (!q || String(e.text).toLowerCase().includes(q)));
    const large = size.w >= 6 && size.h >= 12;
    const toggle = (k: string) => setOff((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    return {
      flush: true,
      headExtra: large ? <div className="seg">{GROUPS.map(([l], i) => <button key={l} type="button" aria-pressed={group === i} onClick={() => setGroup(i)}>{l}</button>)}</div> : null,
      info: [large ? `${all.length} EVENTS` : ""],
      body: (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          {large ? (
            <div className="f" style={{ padding: "6px var(--pad)", gap: 6, borderBottom: "1px solid var(--ln)", flex: "none", flexWrap: "wrap" }}>
              {CATEGORIES.map((k) => <button key={k} type="button" className="chip" style={{ height: 20, fontSize: 9.5 }} aria-pressed={!off.has(k)} onClick={() => toggle(k)}>{k}</button>)}
              <input type="search" className="inp w sm" placeholder="Filter text" aria-label="Filter the events by text" onChange={(e) => setQ(e.target.value.trim().toLowerCase())} />
              <span className="sp" />
              <button type="button" className="btn sm" onClick={() => recorder.exportSession()}>Export session</button>
            </div>
          ) : null}
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <table className="t">
              {large ? <thead><tr><th className="l">Time</th><th>Lap</th><th className="l">Type</th><th className="l">What happened</th></tr></thead> : null}
              <tbody>
                {shown.length ? shown.slice(0, 300).map((e) => (
                  <tr key={`${e.seq}-${e.t}`}>
                    <td className="l mu" style={{ fontFamily: "var(--mono)" }}>{clock(e.t)}</td>
                    {large ? <td>{nf(e.lap, 0)}</td> : null}
                    <td className="l"><span className={"tag fx " + (e.sev >= 2 ? "up" : TAG[e.cat] ?? "n")}>{e.cat}</span></td>
                    <td className={"l" + (sevOf(e.sev) >= 2 ? " up" : "")} style={{ fontFamily: "var(--sans)" }}>{e.text}</td>
                  </tr>
                )) : <tr><td className="l di" colSpan={4}>{all.length ? "Nothing matches the filter." : "Events appear here as they happen."}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ),
    };
  },
});

export const notes = defineModule({
  type: "notes", title: "Notes", group: "Log", blurb: "Session notes, kept in this browser.", size: { w: 4, h: 14, minW: 3, minH: 5 }, multi: false,
  view({ ctx, size }) {
    const area = useRef<HTMLTextAreaElement>(null);
    const timer = useRef(0);
    const [saved, setSaved] = useState("");
    const save = () => {
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setSaved(lsSet("pitwall.notes", area.current?.value ?? "") ? "saved" : "not saved: this browser blocks storage"), 300);
    };
    const insertTime = () => {
      const t = area.current;
      if (!t) return;
      const d = new Date(), lap = ctx.r ? ctx.r.session.lap_number : null;
      t.focus();
      t.setRangeText(`[${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}${lap ? " L" + lap : ""}] `, t.selectionStart, t.selectionEnd, "end");
      save();
    };
    const large = size.h >= 8;
    return {
      flush: true,
      info: [saved ? saved.toUpperCase() : ""],
      body: (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          {large ? <div className="f" style={{ padding: "6px var(--pad)", borderBottom: "1px solid var(--ln)", flex: "none" }}><button type="button" className="btn sm" title="Insert the time and lap at the cursor" onClick={insertTime}>Insert time</button></div> : null}
          <textarea ref={area} aria-label="Session notes" placeholder="Session notes" defaultValue={lsRaw("pitwall.notes") ?? ""} onInput={save}
            style={{ flex: 1, width: "100%", border: 0, background: "var(--p1)", color: "var(--tx)", font: "400 11.5px/1.5 var(--sans)", padding: 8, resize: "none", outline: 0, minHeight: 0 }} />
        </div>
      ),
    };
  },
});

export const advice = defineModule({
  type: "advice", title: "Engineer advice", group: "Log", blurb: "The engineer's advice, worst first.", size: { w: 4, h: 10, minW: 3, minH: 5 }, needs: ["summary"],
  view({ ctx, size }) {
    const a = sortAdvice(ctx.s?.advice);
    if (!a.length) return { state: { kind: "empty", msg: "Nothing to report." } };
    const large = size.h >= 8;
    const n2 = a.filter((x) => sevOf(x.severity) >= 2).length, n1 = a.filter((x) => sevOf(x.severity) === 1).length, n0 = a.length - n1 - n2;
    const glyph = (s: number) => (s >= 2 ? ["▲", "up"] : s === 1 ? ["!", "wn"] : ["i", "di"]);
    // "Right side damage 112. Aero loss likely." the first sentence is the headline, the rest is what to do
    const split = (t: string): [string, string] => { const m = /^(.*?[.:])\s+(.*)$/.exec(t); return m ? [m[1]!, m[2]!] : [t, ""]; };
    return {
      flush: true,
      info: large ? [n2 ? <span key="a" className="up">▲ {n2}</span> : "", n1 ? <span key="b" className="wn">! {n1}</span> : "", n0 ? `${n0} INFO` : ""] : [],
      body: (
        <table className="t">
          <tbody>
            {a.map((x) => { const [g, cls] = glyph(sevOf(x.severity)), [h, rest] = split(x.text); return <tr key={x.id + x.text}><td style={{ width: 28 }} className={cls}>{g}</td><td className="l">{large ? <><b style={{ fontWeight: 600 }}>{h}</b> <span className="mu">{rest}</span></> : x.text}</td></tr>; })}
          </tbody>
        </table>
      ),
    };
  },
});

void fmtLap;
