import { useState } from "react";
import { useFeed } from "../feed/useFeed";

/** The box call: this lap or next lap. Closing it hides it until the call changes. */
export function PitCall() {
  const c = useFeed();
  const [closed, setClosed] = useState("");
  const st = c.st;
  const n = st?.box_in_laps;
  if (!st || st.stops_needed === 0 || n == null || n > 1) return null;
  const now = n <= 0;
  const key = `${c.r?.session.lap_number}:${now}`;
  if (closed === key) return null;
  return (
    <div id="pitCall" className={now ? "now" : ""} role="alert">
      <b>BOX</b>
      <span>{now ? "Box this lap" : "Box next lap"}{st.add_at_box_l ? ` · add ${st.add_at_box_l.toFixed(1)} L` : ""}</span>
      <button type="button" className="btn sm gh" onClick={() => setClosed(key)}>Dismiss</button>
    </div>
  );
}
