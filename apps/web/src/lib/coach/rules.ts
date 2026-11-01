// Why a corner was slower: one rule per cause. A rule reads the benchmark's and the subject's measurements in the corner and,
// when the difference is larger than the noise, names it with the numbers, a tip and a short phrase.
import type { Metrics } from "./measure";

export type Phase = "entry" | "mid" | "exit" | "straight";

export interface RuleIn {
  r: Metrics; s: Metrics; binM: number;
  /** Metres the subject's line lies outside the benchmark's at the slowest point (negative: inside); null without both lines. */
  line: number | null;
  /** The time the subject lost in the middle and on the way out: a later brake that cost more than it gave. */
  laterLoss: number;
  /** Speed in the user's unit. */
  sp: (kmh: number) => number; su: string;
}

export interface Cause {
  id: string; phase: Phase;
  /** How many times over its threshold the difference is; at least 1. */
  ratio: number;
  text: string; tip: string; short: string;
  /** The measured quantity and its unit (metres, speed or percent) for patterns and the next lap's check. */
  val: number; unit: string; metric: (m: Metrics) => number;
  /** Not something the driver did: drafting, wind, fuel. */
  external?: boolean;
}

const n0 = (x: number) => String(Math.round(Math.abs(x)));
const step = (x: number, min: number) => Math.max(min, Math.round(Math.abs(x) / 2));

type Rule = (i: RuleIn) => Cause | null;

export const RULES: Rule[] = [
  ({ r, s, binM }) => {
    const d = (r.e - s.e) * binM, thr = Math.max(5, 0.8 * binM);
    if (!r.braked || !s.braked || d < thr) return null;
    return { id: "brake-early", phase: "entry", ratio: d / thr, text: `Braked ${n0(d)} m earlier`, tip: `Brake about ${n0(step(d, 3))} m later, then keep moving it until the slowest point stops dropping.`, short: `brake ${n0(step(d, 3))} m later`, val: s.e * binM, unit: "m", metric: (m) => m.e * binM };
  },
  ({ r, s, binM, laterLoss }) => {
    const d = (s.e - r.e) * binM, thr = Math.max(5, 0.8 * binM);
    if (!r.braked || !s.braked || d < thr || laterLoss <= 0) return null;
    return { id: "brake-late", phase: "mid", ratio: d / thr, text: `Braked ${n0(d)} m later, which cost more after the corner than it gained`, tip: `Brake about ${n0(step(d, 3))} m earlier and release smoothly: the late brake costs more after the corner than it gains before it.`, short: `brake ${n0(step(d, 3))} m earlier`, val: s.e * binM, unit: "m", metric: (m) => m.e * binM };
  },
  ({ r, s, binM }) => {
    const dp = r.peak - s.peak, dl = s.brakeM - r.brakeM, thr = Math.max(5, 0.8 * binM);
    if (!r.braked || !s.braked || dp < 0.12 || dl < thr) return null;
    return { id: "brake-soft", phase: "entry", ratio: dp / 0.12, text: `Less brake pressure (peak ${n0(100 * s.peak)} % against ${n0(100 * r.peak)} %) and a braking zone ${n0(dl)} m longer`, tip: `Press harder at the start of braking, up to ${n0(100 * r.peak)} %, and the zone shortens.`, short: `brake harder at the start`, val: 100 * s.peak, unit: "%", metric: (m) => 100 * m.peak };
  },
  ({ r, s, binM }) => {
    const d = s.brakeM - r.brakeM, thr = Math.max(5, 0.8 * binM), dp = r.peak - s.peak;
    if (!r.braked || !s.braked || d < 1.5 * thr || Math.abs(s.e - r.e) * binM >= thr || dp >= 0.12) return null;
    return { id: "brake-long", phase: "entry", ratio: d / (1.5 * thr), text: `On the brakes ${n0(d)} m longer`, tip: `Let the brake go ${n0(step(d, 3))} m sooner; the car can turn in with less brake.`, short: `release the brake ${n0(step(d, 3))} m sooner`, val: s.brakeM, unit: "m", metric: (m) => m.brakeM };
  },
  ({ r, s, binM }) => {
    if (r.absM == null || s.absM == null || s.absM - r.absM < Math.max(10, binM)) return null;
    return { id: "abs", phase: "entry", ratio: (s.absM - r.absM) / Math.max(10, binM), text: `ABS working for ${n0(s.absM - r.absM)} m longer`, tip: `Lower the initial pressure a little: the wheels were locking and the ABS was limiting the braking.`, short: `ease the first brake pressure`, val: s.absM, unit: "m", metric: (m) => m.absM ?? 0 };
  },
  ({ r, s, binM }) => {
    const d = r.trailM - s.trailM, thr = Math.max(5, 0.8 * binM) * 1.5;
    if (!r.braked || d < thr || s.vMin >= r.vMin - 0.5) return null;
    return { id: "less-trail", phase: "mid", ratio: d / thr, text: `Left the brake ${n0(d)} m earlier before turning (trail braking ${n0(s.trailM)} m against ${n0(r.trailM)} m)`, tip: `Carry the brake ${n0(step(d, 3))} m further into the turn, easing off as the steering builds.`, short: `stay on the brake ${n0(step(d, 3))} m longer into the turn`, val: s.trailM, unit: "m", metric: (m) => m.trailM };
  },
  ({ r, s, sp, su }) => {
    const d = sp(r.vMin) - sp(s.vMin);
    if (d < sp(1.5) - sp(0)) return null;
    return { id: "low-min", phase: "mid", ratio: d / (sp(1.5) - sp(0)), text: `Slowest point ${n0(d)} ${su} lower (${n0(sp(s.vMin))} against ${n0(sp(r.vMin))})${r.gLat != null && s.gLat != null && r.gLat - s.gLat >= 0.08 ? `, with ${s.gLat.toFixed(2)} g of cornering force against ${r.gLat.toFixed(2)} g: grip left unused` : ""}`, tip: `Carry about ${n0(step(d, 1))} ${su} more through the middle: turn in more smoothly and keep the speed up.`, short: `carry ${n0(step(d, 1))} ${su} more through the middle`, val: sp(s.vMin), unit: su, metric: (m) => sp(m.vMin) };
  },
  ({ r, s }) => {
    if (r.gLat == null || s.gLat == null || r.gLat - s.gLat < 0.08 || s.vMin >= r.vMin - 0.5) return null;
    return { id: "unused-grip", phase: "mid", ratio: (r.gLat - s.gLat) / 0.08, text: `Peak cornering force ${s.gLat.toFixed(2)} g against ${r.gLat.toFixed(2)} g: grip left unused`, tip: `The car had more to give here: turn in with more commitment and carry more speed.`, short: `more commitment at the turn-in`, val: s.gLat, unit: "g", metric: (m) => m.gLat ?? 0 };
  },
  ({ r, s }) => {
    if (r.steerPerG == null || s.steerPerG == null || s.steerPerG < r.steerPerG * 1.12 || s.steerPeak < r.steerPeak * 1.08) return null;
    const p = (100 * (s.steerPerG / r.steerPerG - 1));
    return { id: "front-push", phase: "mid", ratio: p / 12, text: `${n0(p)} % more steering for the same cornering force: the front was pushing`, tip: `Turn in smoothly and a little slower, and do not add steering when the front washes out: wait for it to bite.`, short: `smoother turn-in, the front is pushing`, val: s.steerPerG, unit: "", metric: (m) => m.steerPerG ?? 0 };
  },
  ({ line }) => {
    if (line == null || Math.abs(line) < 1.5) return null;
    const d = Math.abs(line), out = line > 0;
    return out
      ? { id: "wide-line", phase: "mid", ratio: d / 1.5, text: `${n0(d)} m wider than the benchmark at the slowest point`, tip: `Aim closer to the inside of the corner at the slowest point.`, short: `closer to the apex`, val: d, unit: "m", metric: () => d }
      : { id: "tight-line", phase: "mid", ratio: d / 1.5, text: `${n0(d)} m tighter than the benchmark at the slowest point`, tip: `Turn in a little later so the slowest point is further round and the exit is straighter.`, short: `turn in later`, val: d, unit: "m", metric: () => d };
  },
  ({ r, s, binM }) => {
    const d = (s.p - r.p) * binM, thr = Math.max(5, 0.8 * binM);
    if (d < thr) return null;
    return { id: "late-throttle", phase: "exit", ratio: d / thr, text: `On the throttle ${n0(d)} m later`, tip: `Pick the throttle up about ${n0(step(d, 3))} m sooner.`, short: `throttle ${n0(step(d, 3))} m sooner`, val: s.p * binM, unit: "m", metric: (m) => m.p * binM };
  },
  ({ r, s, binM }) => {
    const d = s.rampM - r.rampM, thr = Math.max(5, 0.8 * binM) * 1.5;
    if (d < thr) return null;
    return { id: "slow-ramp", phase: "exit", ratio: d / thr, text: `${n0(s.rampM)} m to reach full throttle against ${n0(r.rampM)} m`, tip: `Roll onto the throttle faster once the car is pointing out of the corner.`, short: `faster onto the throttle`, val: s.rampM, unit: "m", metric: (m) => m.rampM };
  },
  ({ r, s }) => {
    if (s.lifts <= r.lifts) return null;
    return { id: "lift", phase: "exit", ratio: s.lifts - r.lifts, text: `Lifted ${n0(s.lifts - r.lifts)} time${s.lifts - r.lifts > 1 ? "s" : ""} more on the way out`, tip: `Stay on the throttle once you are on it. If the car was stepping out, a smoother application keeps it down.`, short: `no lift on the exit`, val: s.lifts, unit: "", metric: (m) => m.lifts };
  },
  ({ r, s, binM }) => {
    if (r.tcM == null || s.tcM == null || s.tcM - r.tcM < Math.max(15, 1.2 * binM)) return null;
    const d = s.tcM - r.tcM;
    return { id: "tc", phase: "exit", ratio: d / Math.max(15, 1.2 * binM), text: `Traction control cut in for ${n0(d)} m longer`, tip: `The rears were spinning: ease the throttle in more gradually, and get the wheel straight earlier.`, short: `ease onto the throttle, the rears are spinning`, val: s.tcM, unit: "m", metric: (m) => m.tcM ?? 0 };
  },
  ({ r, s }) => {
    if (s.steerWork < r.steerWork * 1.3 || s.steerWork - r.steerWork < 0.15) return null;
    const p = 100 * (s.steerWork - r.steerWork);
    return { id: "steer-work", phase: "exit", ratio: p / 30, text: `Steering corrections on the way out: ${n0(100 * s.steerWork)} % of the movement against ${n0(100 * r.steerWork)} %`, tip: `Smoother hands on the exit: the car was busy, and every correction costs speed.`, short: `calmer hands on the exit`, val: s.steerWork, unit: "", metric: (m) => m.steerWork };
  },
  ({ r, s, binM }) => {
    const d = s.coastM - r.coastM, thr = 2 * Math.max(5, 0.8 * binM);
    if (d < thr) return null;
    return { id: "coast", phase: "entry", ratio: d / thr, text: `Coasting for ${n0(d)} m more with neither pedal pressed`, tip: `Go from throttle to brake, and from brake to throttle, without a gap.`, short: `no coasting between the pedals`, val: s.coastM, unit: "m", metric: (m) => m.coastM };
  },
  ({ r, s }) => {
    if (s.gear === r.gear || s.gear <= 0 || r.gear <= 0) return null;
    return { id: "gear", phase: "mid", ratio: 1.5, text: `Gear ${s.gear} at the slowest point against ${r.gear}`, tip: `Try gear ${r.gear} here.`, short: `gear ${r.gear} at the slowest point`, val: s.gear, unit: "", metric: (m) => m.gear };
  },
  ({ r, s, sp, su }) => {
    const d = sp(r.vExit) - sp(s.vExit), one = sp(2) - sp(0);
    if (d < one) return null;
    return { id: "exit-speed", phase: "straight", ratio: d / one, text: `Left the corner ${n0(d)} ${su} slower and carried it down the straight`, tip: `The straight is lost on the way out: work on the throttle point and the line out of the corner.`, short: `a faster exit`, val: sp(s.vExit), unit: su, metric: (m) => sp(m.vExit) };
  },
  ({ r, s, sp, su }) => {
    const d = sp(r.vTop) - sp(s.vTop), one = sp(2) - sp(0);
    if (d < one || Math.abs(r.vExit - s.vExit) >= 2) return null;
    return { id: "top-speed", phase: "straight", ratio: d / one, external: true, text: `${n0(d)} ${su} slower at the end of the straight though the exit speed was the same`, tip: `Not the corner: look at the slipstream, wind, fuel load or the car.`, short: `check the straight, not the corner`, val: sp(s.vTop), unit: su, metric: (m) => sp(m.vTop) };
  },
];

export function causesOf(i: RuleIn): Cause[] {
  const all = RULES.map((f) => f(i)).filter((c): c is Cause => c != null);
  // A slow exit speed is the result of whatever came before it; it is a cause only when nothing else was found.
  const late = (i.s.p - i.r.p) * i.binM, coastD = i.s.coastM - i.r.coastM;
  const keep = all.filter((c) => !(c.id === "coast" && all.some((k) => k.id === "late-throttle") && coastD <= 1.2 * late) && !(c.id === "unused-grip" && all.some((k) => k.id === "low-min"))); // the gap before a late throttle is the same metres
  return keep.some((c) => c.phase !== "straight") ? keep.filter((c) => c.id !== "exit-speed") : keep;
}
