import { useEffect, useRef, useState } from "react";
import { useLink } from "../feed/connection";
import { useFeed } from "../feed/useFeed";

type Step = "done" | "wait" | "";

function StepRow({ state, title, text }: { state: Step; title: string; text: string }) {
  return (
    <li className={state}><span className="w-mark" /><div><b>{title}</b><span>{text}</span></div></li>
  );
}

/** The first screen: what is connected, and in a moment the dashboard. */
export function Welcome({ onEnter }: { onEnter: () => void }) {
  const up = useLink();
  const c = useFeed();
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(0);
  const r = c.r;

  const enter = () => {
    clearTimeout(timer.current);
    setLeaving(true);
    setTimeout(onEnter, 250);
  };

  useEffect(() => {
    if (r && !timer.current) timer.current = window.setTimeout(enter, 1800);
  }, [r]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = r?.fixed, s = r?.session;
  return (
    <section id="welcome" className={leaving ? "leaving" : ""} aria-labelledby="wTitle">
      <div className="w-inner">
        <div className="w-brand">PIT WALL</div>
        <h1 id="wTitle">Race engineering for Assetto Corsa Competizione</h1>
        <p className="w-lead">The field, the car, fuel and stops, the engineer's advice and the next pit stop, for the driver you are watching.</p>
        <ol className="w-steps" aria-live="polite">
          <StepRow state={up ? "done" : "wait"} title="Driver's PC" text={up ? "Connected" : "Connecting to the driver's PC"} />
          <StepRow state={r ? "done" : up ? "wait" : ""} title="ACC" text={r ? `${c.from || "The driver"} is on track` : "Waiting for ACC on the driver's PC"} />
          <StepRow state={r ? "done" : ""} title="Session" text={r ? [f.car_model, f.track, s.kind].filter(Boolean).join(" · ") : "Waiting for a session"} />
        </ol>
        <div className="w-actions">
          <button type="button" className="btn primary" onClick={enter}>Open the pit wall</button>
          <span id="wNote">{r ? "Opening automatically" : ""}</span>
        </div>
        <details className="w-help">
          <summary>Not receiving anything?</summary>
          <ul>
            <li>ACC must be in a session (on track or in the pits) on the driver's PC, the same PC that runs Pit Wall.</li>
            <li>The Pit Wall window on that PC says when it sees ACC and which car and track.</li>
            <li>If this page does not load at all: check the VPN shows the driver online, and that Pit Wall is allowed through the driver's Windows firewall on <b>Private</b> networks only.</li>
          </ul>
        </details>
      </div>
    </section>
  );
}
