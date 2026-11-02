import { fmtDelta, NONE } from "../lib/format";

/** A lap or sector difference: a gain is ▼ in green, a loss ▲ in red. The arrow has its own slot so the figures line up. */
export function Delta({ ms }: { ms: number | null | undefined }) {
  if (ms == null || !isFinite(ms)) return <>{NONE}</>;
  if (Math.abs(ms) < 0.5) return <span className="dl"><i />{fmtDelta(ms)}</span>;
  return <span className={"dl " + (ms < 0 ? "s-ok" : "s-bad")}><i>{ms < 0 ? "▼" : "▲"}</i>{fmtDelta(ms)}</span>;
}
