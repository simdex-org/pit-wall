import { Corner, LapBins, measure, zoneTime } from "./measure";

export interface CornerReport {
  corner: Corner;
  /** Seconds in the zone on the reference lap, the best of the session's laps, and the difference. */
  ref: number; best: number; loss: number;
  /** The most likely cause of the loss and what to try, or null when it is within the noise. */
  cause: string | null; tip: string | null;
}
export interface Report { corners: CornerReport[]; total: number; focus: CornerReport[] }

const NOISE_S = 0.03;

/** Compares the reference lap with the best time anyone's lap set in each corner zone, and names what differs. */
export function buildReport(corners: Corner[], ref: LapBins, laps: LapBins[], mph: (kmh: number) => number, unit: string): Report {
  const rows = corners.map((corner): CornerReport => {
    const rt = zoneTime(ref, corner);
    let best = rt, bl = ref;
    for (const l of laps) { const t = zoneTime(l, corner); if (t > 0 && t < best) { best = t; bl = l; } }
    const loss = rt - best;
    if (loss < NOISE_S) return { corner, ref: rt, best, loss: 0, cause: null, tip: null };
    const a = measure(ref, corner), b = measure(bl, corner);
    const diffs: [number, string, string][] = [];
    if (a.brake !== null && b.brake !== null && a.brake < b.brake - 2) diffs.push([(b.brake - a.brake) * 1.5, "Braking too early", "Brake later: the best lap brakes closer to the corner"]);
    if (a.throttle !== null && b.throttle !== null && a.throttle > b.throttle + 2) diffs.push([(a.throttle - b.throttle) * 1.5, "Late back on the throttle", "Get on the power earlier, as soon as the car points out of the corner"]);
    if (a.minSpeed < b.minSpeed - 3) diffs.push([(b.minSpeed - a.minSpeed) * 0.8, `Slow at the apex (${Math.round(mph(a.minSpeed))} against ${Math.round(mph(b.minSpeed))} ${unit})`, "Carry more speed to the apex; brake a little less deep"]);
    diffs.sort((x, y) => y[0] - x[0]);
    const top = diffs[0];
    return { corner, ref: rt, best, loss, cause: top?.[1] ?? "Time lost, no single cause", tip: top?.[2] ?? "Compare the traces of the two laps through this corner" };
  });
  const total = rows.reduce((s, r) => s + r.loss, 0);
  return { corners: rows, total, focus: rows.filter((r) => r.loss > 0).sort((x, y) => y.loss - x.loss).slice(0, 3) };
}
