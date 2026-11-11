import { cornerNames, tracksLoaded, wholeLine } from "../draw/map";
import type { Ctx } from "../feed/store";
import type { Corner } from "../lib/coach/measure";
import { buildReport, CoachLap, pointAt, Report } from "../lib/coach/report";
import { NB, recorder } from "./recorder";
import type { Sel } from "./selection";

export type CoachMode = "lap" | "best";

let memo: { key: string; out: Report | { msg: string } } | null = null;

export function coachReport(c: Ctx, sel: Sel, mode: CoachMode, sp: (kmh: number) => number, su: string): Report | { msg: string } {
  const subject = sel.cmp ?? sel.ref, bench = mode === "lap" && sel.cmp ? sel.ref : null, track = c.r?.fixed.track ?? "", len = c.r ? c.r.fixed.track_length_m : 0;
  if (!subject) return { msg: "Pick a lap in the lap picker or the Laps table." };
  if (!recorder.lapById(subject) || (bench && !recorder.lapById(bench))) return { msg: "Loading the lap from the bridge…" };
  const key = [recorder.ver, recorder.laps.length, c.laps.length, subject, bench, len, su, sp(100), track, tracksLoaded(), recorder.lines.length, recorder.layout?.track].join("|");
  if (memo && memo.key === key) return memo.out;
  const out = buildReport({ laps: coachLaps(c), subject, bench, len, sp, su, name: cornerNamer(track) });
  memo = { key, out };
  return out;
}

// every lap with a loaded trace, with what the bridge knows about it (stint, tyres, driver)
export function coachLaps(c: Ctx): CoachLap[] {
  return recorder.laps.flatMap((l) => {
    if (!l.data) return [];
    const info = l.src === "import" ? null : c.laps.find((x) => x.n === l.n);
    return [{
      id: l.id, n: l.n, ms: l.ms, valid: l.valid, src: l.src, label: l.label, data: l.data,
      line: l.src === "import" ? null : wholeLine(recorder.lines.find((x) => x.n === l.n)?.pts as number[][] | undefined),
      out: !!info?.out, in: !!info?.in, wet: info ? !!info.wet : undefined, set: info?.set, stint: info?.stint, driver: info?.driver || undefined,
    }];
  });
}

// T3, or T3 with the track's name for the corner nearest its slowest point
export function cornerNamer(track: string): (k: Corner, line: ArrayLike<number[]> | null) => string {
  const labels = cornerNames(track);
  return (k, line) => {
    const base = `T${k.n}`;
    if (!labels || !line) return base;
    const [x, z] = pointAt(line, k.apex / (NB - 1));
    let best: string | null = null, d = 150 ** 2;
    for (const [lx, lz, nm] of labels) { const e = (lx - x) ** 2 + (lz - z) ** 2; if (e < d) { d = e; best = nm; } }
    return best ? `${base} ${best}` : base;
  };
}

export const isReport = (r: Report | { msg: string }): r is Report => !("msg" in r);
