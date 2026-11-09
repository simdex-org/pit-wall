import { useEffect, useRef, useState } from "react";
import { useAuth, useLink } from "../feed/connection";
import { useFeed } from "../feed/useFeed";

export function Welcome({ onEnter }: { onEnter: () => void }) {
  const up = useLink();
  const auth = useAuth();
  const c = useFeed();
  const [leaving, setLeaving] = useState(false);
  const [help, setHelp] = useState(false);
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
  const row = (k: string, state: "ok" | "wait" | "off" | "bad", text: string) => <div className="r" key={k}><span>{k}</span><span className={state === "ok" ? "p" : state === "wait" ? "wn" : state === "bad" ? "bd" : "di"}>{state === "ok" ? "●" : "○"} {text}</span></div>;
  const [keyState, keyText]: ["ok" | "wait" | "off" | "bad", string] = auth === "ok" ? ["ok", "accepted"] : auth === "wrong" ? ["bad", "wrong key: open the link from the driver's PC again"]
    : auth === "blocked" ? ["bad", "too many wrong keys: wait a minute"] : auth === "none" ? (up ? ["off", "not needed on this bridge"] : ["wait", "missing: open the link from the driver's PC"]) : ["wait", "checking"];
  return (
    <section id="welcome" className={leaving ? "leaving" : ""} aria-labelledby="wTitle">
      <div className="wc">
        <div className="wc-h"><span className="wm">PIT WALL</span></div>
        <div className="wc-b">
          <h1 id="wTitle">{r ? `${c.from || "The driver"} is on track` : "Waiting for the driver"}</h1>
          <p>{r ? [f.car_model, f.track, s.kind].filter(Boolean).join(" · ") : "The page connects as soon as the bridge is running on the driver's PC. Nothing to type except the access key."}</p>
          <div aria-live="polite">
            {row("Bridge address", up || auth === "wrong" || auth === "blocked" ? "ok" : "wait", up || auth === "wrong" || auth === "blocked" ? "found" : "searching")}
            {row("Access key", keyState, keyText)}
            {row("Game", r ? "ok" : "wait", r ? "connected" : "waiting")}
          </div>
          {help ? (
            <ul className="wc-help">
              <li>The game must be in a session (on track or in the pits) on the driver's PC, the same PC that runs Pit Wall.</li>
              <li>The Pit Wall window on that PC says when it sees the game and which car and track.</li>
              <li>If this page does not load at all: check the VPN shows the driver online, and that Pit Wall is allowed through the driver's Windows firewall on <b>Private</b> networks only.</li>
            </ul>
          ) : null}
        </div>
        <div className="wc-f">
          <button type="button" className="btn primary lg" onClick={enter}>Open workspace</button>
          <button type="button" className="btn lg" aria-expanded={help} onClick={() => setHelp((h) => !h)}>Help</button>
          <span id="wNote" className="v mu">{r ? "Opening automatically" : ""}</span>
        </div>
      </div>
    </section>
  );
}
