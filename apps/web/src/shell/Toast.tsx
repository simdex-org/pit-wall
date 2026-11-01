import { useSay } from "../state/bridge";

/** What the page just did, in one line at the bottom left, for a few seconds. */
export function Toast() {
  const say = useSay();
  if (!say) return null;
  return <div id="toast" className={"s" + say.sev} role="status" aria-live="polite"><span className="dot" />{say.text}</div>;
}
