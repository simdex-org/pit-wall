// One lap coach report, shared by the coach, the lap map and the traces; rebuilt only when the laps or the choice of laps change.
import type { Ctx } from "../feed/store";
import { findCorners } from "../lib/coach/measure";
import { buildReport, Report } from "../lib/coach/report";
import { recorder, RecLap } from "./recorder";
import type { Sel } from "./selection";

export const isReport = (r: Report | { msg: string }): r is Report => "corners" in r;

let memo: { key: string; report: Report | { msg: string } } | null = null;

const usable = (l: RecLap) => l.valid && l.data !== null;

/** `speed` converts km/h to the person's unit and `unit` names it. */
export function coachReport(_c: Ctx, sel: Sel, _basis: "lap", speed: (kmh: number) => number, unit: string): Report | { msg: string } {
  const laps = recorder.laps.filter(usable), ref = recorder.lapById(sel.ref) ?? laps.reduce<RecLap | null>((a, l) => (!a || l.ms < a.ms ? l : a), null);
  const key = [ref?.id, unit, ...laps.map((l) => l.id)].join("|");
  if (memo?.key === key) return memo.report;
  let report: Report | { msg: string };
  if (laps.length < 2) report = { msg: "The coach needs two clean laps to compare." };
  else if (!ref?.data) report = { msg: "The reference lap has no trace yet." };
  else {
    const bins = laps.map((l) => l.data!), corners = findCorners(bins);
    report = corners.length ? buildReport(corners, ref.data, bins, speed, unit) : { msg: "No corners found yet: drive a few more laps." };
  }
  memo = { key, report };
  return report;
}
