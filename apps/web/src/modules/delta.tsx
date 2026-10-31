import { fmtDelta, NONE } from "../lib/format";

/** A lap or sector difference: a gain is ▼ in green, a loss ▲ in red. */
export function Delta({ ms }: { ms: number | null | undefined }) {
  if (ms == null || !isFinite(ms)) return <>{NONE}</>;
  if (Math.abs(ms) < 0.5) return <>{fmtDelta(ms)}</>;
  return <span className={ms < 0 ? "s-ok" : "s-bad"}>{ms < 0 ? "▼" : "▲"} {fmtDelta(ms)}</span>;
}
