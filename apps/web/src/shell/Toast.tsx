import { useSay } from "../state/bridge";

export function Toast() {
  const say = useSay();
  if (!say) return null;
  return <div id="toast" className={"s" + say.sev} role="status" aria-live="polite"><span className="dot" />{say.text}</div>;
}
