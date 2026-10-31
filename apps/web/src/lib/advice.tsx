import { clamp, fmtLap, fmtSector } from "./format";
import { Icon } from "./icons";
import type { Advice } from "../feed/types";

/** Severity 0 to 2: icon name and word. */
export const SEV: [icon: string, word: string][] = [["info", "NOTE"], ["triangle-alert", "WARN"], ["octagon-alert", "CRIT"]];
export const sevOf = (s: number): number => clamp(s | 0, 0, 2);

// Most severe first; a tie goes to the topic that matters first (running dry before a pressure note), so bar and drawer agree.
const PRIORITY = ["fuel_box", "fuel_low", "fuel_flag", "penalty", "damage", "window_closing", "stint_limit", "rain_coming", "brakes_hot", "pads_low", "press_front", "press_rear", "tyres_cold"];
const rank = (a: Advice): number => { const i = PRIORITY.indexOf(a.id); return i < 0 ? 99 : i; };
export const sortAdvice = (items: Advice[] | null | undefined): Advice[] => (items ?? []).slice().sort((a, b) => b.severity - a.severity || rank(a) - rank(b));

export function SevLine({ sev, text }: { sev: number; text: string }) {
  const s = sevOf(sev), [icon, word] = SEV[s]!;
  return <div className={`sev sev${s}`}><Icon name={icon} /><b>{word}</b> {text}</div>;
}

export function AdviceList({ items }: { items: Advice[] | null | undefined }) {
  const a = sortAdvice(items);
  return a.length ? <>{a.map((x) => <SevLine key={x.id + x.text} sev={x.severity} text={x.text} />)}</> : <div className="empty">Nothing to report.</div>;
}

interface DebriefLap { lap_number: number; lap_time_ms: number; sectors_ms?: number[]; lines?: { severity: number; text: string }[] }

export function Debrief({ laps }: { laps: DebriefLap[] | null | undefined }) {
  if (!laps?.length) return <div className="empty">The last laps' analysis appears here after the first lap.</div>;
  return (
    <>
      {laps.map((l) => (
        <div className="lap" key={l.lap_number}>
          <h3>Lap {l.lap_number} <span className="n">{fmtLap(l.lap_time_ms)}</span> <span className="note">{(l.sectors_ms ?? []).map(fmtSector).join(" · ")}</span></h3>
          {(l.lines ?? []).map((x, i) => <SevLine key={i} sev={x.severity} text={x.text} />)}
        </div>
      ))}
    </>
  );
}
