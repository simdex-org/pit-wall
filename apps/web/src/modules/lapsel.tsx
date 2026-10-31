import { recorder, lapNo, RecLap } from "../state/recorder";
import { Sel, selection } from "../state/selection";

export const lapName = (l: RecLap): string => (l.src === "import" ? `${l.label} L${l.n}` : `L${l.n}`);

/** The lap picker keeps choosing REF and CMP until the person picks one by hand. */
export const autoSel = { ref: true, cmp: true };

export function pick(which: "ref" | "cmp", id: string): void {
  autoSel[which] = false;
  selection.select(which, selection.get()[which] === id ? null : id);
  const n = lapNo(id);
  if (n) void recorder.ensureLap(n);
}

/** The REF and CMP laps, or the reason they cannot be drawn. */
export function selState(sel: Sel): { ref: RecLap; cmp: RecLap | null } | { msg: string } {
  const ref = recorder.lapById(sel.ref), cmp = recorder.lapById(sel.cmp);
  if (!sel.ref && !sel.cmp) return { msg: "Pick a reference and a comparison lap in the lap picker or the Laps table." };
  for (const id of [sel.ref, sel.cmp]) {
    if (!id || recorder.lapById(id)) continue;
    const n = lapNo(id);
    return { msg: recorder.failed.has(n) ? `Lap ${n} has no trace on the bridge any more.` : `Loading lap ${n} from the bridge…` };
  }
  if (!ref) return { msg: "Pick a reference lap (REF)." };
  return { ref, cmp };
}
