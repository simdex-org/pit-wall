import { useEffect, useRef, useState } from "react";
import { useFeed } from "../feed/useFeed";
import { AdviceList, Debrief, SEV, sevOf, sortAdvice } from "../lib/advice";
import { Icon } from "../lib/icons";
import { accessKey, useSay } from "../state/bridge";
import { prefs } from "../state/prefs";
import { useNav } from "../state/nav";

let audio: AudioContext | null = null;
function beep(): void {
  if (!prefs.get().sound) return;
  try {
    audio = audio ?? new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.18);
  } catch { /* no audio device */ }
}

export function EngineerBar({ open, onToggle }: { open: boolean; onToggle: (on?: boolean) => void }) {
  const c = useFeed();
  const { tpl } = useNav();
  const say = useSay();
  const adv = sortAdvice(c.s?.advice);
  const w = adv[0];
  const seen = useRef<{ ids: Set<string>; summary: boolean }>({ ids: new Set(), summary: false });

  // A new critical line sounds once.
  useEffect(() => {
    if (!c.s) return;
    const ids = new Set(adv.map((a) => a.id || a.text));
    if (seen.current.summary && adv.some((a) => a.severity >= 2 && !seen.current.ids.has(a.id || a.text))) beep();
    seen.current = { ids, summary: true };
  }, [c.s]); // eslint-disable-line react-hooks/exhaustive-deps

  const sv = w ? sevOf(w.severity) : 0;
  const m = w ? /^(.*?[.:])\s+(.*)$/.exec(w.text) : null, head = m ? m[1]! : w?.text ?? "", rest = m ? m[2]! : "";
  const fieldOn = !!(c.field && c.bc?.state === "live");
  const pit = !c.pit ? "pit off"
    : (c.pitJob?.state === "running" || c.pit.busy) ? (c.pit.waiting_lift ? "pit busy: driver must lift" : "pit busy")
    : !accessKey.value ? "pit: no key" : c.pit.status === "live" ? "pit ready" : "pit off";
  const status = `bridge ${location.host} · ${c.hz} Hz · ${fieldOn ? `field ${c.cars.size} cars` : "field off"} · ${pit} · ${tpl.name}`;

  return (
    <>
      <section id="engDrawer" aria-label="Engineer" hidden={!open}>
        <div className="ed-col"><h2 className="mt">Advice</h2><div id="engAdv"><AdviceList items={c.s?.advice} /></div></div>
        <div className="ed-col"><h2 className="mt">Debrief</h2><div id="engDeb"><Debrief laps={c.s?.debrief} /></div></div>
        <button type="button" className="btn icon" id="engClose" aria-label="Close the engineer drawer" title="Close (Esc)" onClick={() => onToggle(false)}><Icon name="x" /></button>
      </section>
      <footer id="eng">
        <button type="button" id="engMain" className={`eng-main sev${sv}`} aria-expanded={open} aria-controls="engDrawer" title="All advice and the debrief (A)" onClick={() => onToggle()}>
          {w ? (
            <>
              <span className={sv >= 2 ? "up" : sv === 1 ? "wn" : "di"} aria-label={SEV[sv]![1]}>{sv >= 2 ? "▲" : sv === 1 ? "!" : "i"}</span>
              <b className="eng-head">{head}</b><span className="eng-text mu">{rest}</span>
              <span className="sp" />
              {adv.length > 1 && <span className={"eng-more " + (adv.slice(1).some((a) => sevOf(a.severity) >= 2) ? "up" : "wn")}>! {adv.length - 1} more</span>}
              <span className="btn sm gh" aria-hidden="true">{open ? "Close ▴" : "Open ▾"}</span>
            </>
          ) : (
            <><span className="di">i</span><span className="eng-text mu">{c.s ? "Nothing to report." : "Waiting for the driver's engineer."}</span></>
          )}
        </button>
        <span id="engInfo" className={`eng-info${say ? ` say s-${["dim", "warn", "bad"][say.sev] ?? "dim"}` : ""}`} aria-live="polite" title={status} hidden={!say}>{say ? say.text : ""}</span>
      </footer>
    </>
  );
}

export function useDrawer(): [boolean, (on?: boolean) => void] {
  const [open, setOpen] = useState(false);
  return [open, (on) => setOpen((o) => (on == null ? !o : on))];
}
