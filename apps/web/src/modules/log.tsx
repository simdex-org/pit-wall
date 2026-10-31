import { useRef, useState } from "react";
import { defineModule } from "../engine/registry";
import { AdviceList, SevLine } from "../lib/advice";
import { nf } from "../lib/format";
import { lsRaw, lsSet } from "../lib/storage";
import { recorder } from "../state/recorder";

const CATEGORIES = ["LAP", "PIT", "FLAG", "CAR", "ENG", "PLAN", "CFG", "RC", "FIELD"];
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour12: false });

export const eventLog = defineModule({
  type: "event-log", title: "Events", group: "Log", blurb: "Everything logged: laps, pits, flags, race control, the field, plans sent.",
  size: { w: 8, h: 22, minW: 4, minH: 6 }, needs: ["log"],
  view({ ctx }) {
    const [off, setOff] = useState(() => new Set(["FIELD"]));
    const [q, setQ] = useState("");
    const all = ctx.log;
    const shown = all.filter((e) => !off.has(e.cat) && (!q || String(e.text).toLowerCase().includes(q)));
    const toggle = (k: string) => setOff((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    return {
      info: `${shown.length}${shown.length !== all.length ? ` of ${all.length}` : ""} events`,
      body: (
        <>
          <div className="ev-bar">
            <span className="ev-chips" role="group" aria-label="Categories">
              {CATEGORIES.map((k) => <button key={k} type="button" className="chip ev-chip" aria-pressed={!off.has(k)} onClick={() => toggle(k)}>{k}</button>)}
            </span>
            <input type="search" placeholder="Filter text" aria-label="Filter the events by text" onChange={(e) => setQ(e.target.value.trim().toLowerCase())} />
            <button type="button" className="btn" onClick={() => recorder.exportSession()}>Export session</button>
          </div>
          <table className="tt ev">
            <tbody>
              {shown.length ? shown.slice(0, 300).map((e) => (
                <tr key={`${e.seq}-${e.t}`}>
                  <td className="n">{clock(e.t)}</td><td className="n">L{nf(e.lap, 0)}</td><td><b className="tag">{e.cat}</b></td>
                  <td className="ev-t"><SevLine sev={e.sev} text={e.text} /></td>
                </tr>
              )) : <tr><td className="note">{all.length ? "Nothing matches the filter." : "Events appear here as they happen."}</td></tr>}
            </tbody>
          </table>
        </>
      ),
    };
  },
});

export const notes = defineModule({
  type: "notes", title: "Notes", group: "Log", blurb: "Session notes, kept in this browser.", size: { w: 4, h: 14, minW: 3, minH: 5 }, multi: false,
  view({ ctx }) {
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
    return {
      body: (
        <>
          <div className="nt-bar"><button type="button" className="btn" title="Insert the time and lap at the cursor" onClick={insertTime}>Insert time</button><span className="note" role="status">{saved}</span></div>
          <textarea ref={area} className="notes" aria-label="Session notes" placeholder="Session notes" defaultValue={lsRaw("pitwall.notes") ?? ""} onInput={save} />
        </>
      ),
    };
  },
});

export const advice = defineModule({
  type: "advice", title: "Engineer advice", group: "Log", blurb: "The engineer's advice, worst first.", size: { w: 4, h: 10, minW: 3, minH: 5 }, needs: ["summary"],
  view: ({ ctx }) => ({ body: <AdviceList items={ctx.s?.advice} /> }),
});
