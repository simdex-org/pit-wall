import type { Metrics } from "./measure";

export type Phase = "entry" | "mid" | "exit" | "straight";

export interface RuleIn {
  r: Metrics; s: Metrics; binM: number;
  line: number | null;
  laterLoss: number;
  sp: (kmh: number) => number; su: string;
}

export interface Cause {
  id: string; phase: Phase;
  ratio: number;
  text: string; tip: string; short: string;
  val: number; unit: string; metric: (m: Metrics) => number;
  external?: boolean;
}

const n0 = (x: number) => String(Math.round(Math.abs(x)));
const amt = (m: number) => (m < 10 ? "a touch" : m < 25 ? "a little" : m < 60 ? "a good bit" : "a lot");
const pct = (a: number, b: number) => `${Math.round((100 * a) / b)} %`;

type Rule = (i: RuleIn) => Cause | null;

export const RULES: Rule[] = [
  ({ r, s, binM }) => {
    const d = (r.e - s.e) * binM, thr = Math.max(5, 0.8 * binM);
    if (!r.braked || !s.braked || d < thr) return null;
    return { id: "brake-early", phase: "entry", ratio: d / thr, text: `You got on the brake ${amt(d)} earlier than the reference`, tip: `Brake a touch later. Wait until the corner is really coming at you, then go a little deeper each lap until the slowest point stops dropping.`, short: `brake a touch later`, val: s.e * binM, unit: "m", metric: (m) => m.e * binM };
  },
  ({ r, s, binM, laterLoss }) => {
    const d = (s.e - r.e) * binM, thr = Math.max(5, 0.8 * binM);
    if (!r.braked || !s.braked || d < thr || laterLoss <= 0) return null;
    return { id: "brake-late", phase: "mid", ratio: d / thr, text: `You braked ${amt(d)} later than the reference, and the car paid for it after the corner`, tip: `Brake a touch earlier and let the brake off smoothly. Going in too deep leaves the car running wide and slow on the way out.`, short: `brake a touch earlier`, val: s.e * binM, unit: "m", metric: (m) => m.e * binM };
  },
  ({ r, s, binM }) => {
    const dp = r.peak - s.peak, dl = s.brakeM - r.brakeM, thr = Math.max(5, 0.8 * binM);
    if (!r.braked || !s.braked || dp < 0.12 || dl < thr) return null;
    return { id: "brake-soft", phase: "entry", ratio: dp / 0.12, text: `You were too gentle when you first hit the brake, so the car took longer to slow down`, tip: `Hit the brake firmly at the start, then ease off as the speed drops. The stop gets shorter.`, short: `hit the brake harder`, val: 100 * s.peak, unit: "%", metric: (m) => 100 * m.peak };
  },
  ({ r, s, binM }) => {
    const d = s.brakeM - r.brakeM, thr = Math.max(5, 0.8 * binM), dp = r.peak - s.peak;
    if (!r.braked || !s.braked || d < 1.5 * thr || Math.abs(s.e - r.e) * binM >= thr || dp >= 0.12) return null;
    return { id: "brake-long", phase: "entry", ratio: d / (1.5 * thr), text: `You stayed on the brake ${amt(d)} longer than needed`, tip: `Let the brake go sooner. The car can turn in with less brake than you think.`, short: `release the brake sooner`, val: s.brakeM, unit: "m", metric: (m) => m.brakeM };
  },
  ({ r, s, binM }) => {
    if (r.absM == null || s.absM == null || s.absM - r.absM < Math.max(10, binM)) return null;
    return { id: "abs", phase: "entry", ratio: (s.absM - r.absM) / Math.max(10, binM), text: `The ABS was working ${amt(s.absM - r.absM)} longer: the wheels were on the edge of locking`, tip: `Squeeze the first bit of brake a little less hard, then build it. Locking up costs more than it saves.`, short: `ease the first brake pressure`, val: s.absM, unit: "m", metric: (m) => m.absM ?? 0 };
  },
  ({ r, s, binM }) => {
    const d = r.trailM - s.trailM, thr = Math.max(5, 0.8 * binM) * 1.5;
    if (!r.braked || d < thr || s.vMin >= r.vMin - 0.5) return null;
    return { id: "less-trail", phase: "mid", ratio: d / thr, text: `You let go of the brake too early, before the car was turning`, tip: `Keep a little brake on as you turn in and release it slowly as you add steering. It keeps the nose planted and the front biting.`, short: `stay on the brake into the turn`, val: s.trailM, unit: "m", metric: (m) => m.trailM };
  },
  ({ r, s, sp, su }) => {
    const d = sp(r.vMin) - sp(s.vMin);
    if (d < sp(1.5) - sp(0)) return null;
    const grip = r.gLat != null && s.gLat != null && r.gLat - s.gLat >= 0.08 ? `, using only ${pct(s.gLat, r.gLat)} of the grip the reference found` : "";
    return { id: "low-min", phase: "mid", ratio: d / (sp(1.5) - sp(0)), text: `You slowed to ${n0(sp(s.vMin))} ${su} in the middle, the reference held ${n0(sp(r.vMin))}${grip}`, tip: `Carry more speed into the middle. Turn in more smoothly and trust the grip: the car had more to give.`, short: `carry more speed through the middle`, val: sp(s.vMin), unit: su, metric: (m) => sp(m.vMin) };
  },
  ({ r, s }) => {
    if (r.gLat == null || s.gLat == null || r.gLat - s.gLat < 0.08 || s.vMin >= r.vMin - 0.5) return null;
    return { id: "unused-grip", phase: "mid", ratio: (r.gLat - s.gLat) / 0.08, text: `You used only ${pct(s.gLat, r.gLat)} of the grip the reference found here`, tip: `The car had more to give. Turn in with more commitment and carry more speed.`, short: `more commitment at the turn-in`, val: s.gLat, unit: "g", metric: (m) => m.gLat ?? 0 };
  },
  ({ r, s }) => {
    if (r.steerPerG == null || s.steerPerG == null || s.steerPerG < r.steerPerG * 1.12 || s.steerPeak < r.steerPeak * 1.08) return null;
    const p = (100 * (s.steerPerG / r.steerPerG - 1));
    return { id: "front-push", phase: "mid", ratio: p / 12, text: `The front was pushing: you needed more steering for the same turn`, tip: `Turn in more gently and a touch slower. If the front washes out, do not add more steering: ease off and wait for it to bite.`, short: `smoother turn-in, the front is pushing`, val: s.steerPerG, unit: "", metric: (m) => m.steerPerG ?? 0 };
  },
  ({ line }) => {
    if (line == null || Math.abs(line) < 1.5) return null;
    const d = Math.abs(line), out = line > 0;
    return out
      ? { id: "wide-line", phase: "mid", ratio: d / 1.5, text: `You ran wider than the reference through the middle`, tip: `Aim closer to the inside of the corner and clip the apex.`, short: `closer to the apex`, val: d, unit: "m", metric: () => d }
      : { id: "tight-line", phase: "mid", ratio: d / 1.5, text: `You cut inside the reference line too early`, tip: `Turn in a little later and let the car run on to a later apex. The exit gets straighter.`, short: `turn in later`, val: d, unit: "m", metric: () => d };
  },
  ({ r, s, binM }) => {
    const d = (s.p - r.p) * binM, thr = Math.max(5, 0.8 * binM);
    if (d < thr) return null;
    return { id: "late-throttle", phase: "exit", ratio: d / thr, text: `You waited ${amt(d)} longer to get back on the power`, tip: `Get on the throttle earlier. As soon as the car points out of the corner and the wheel starts to unwind, begin to squeeze.`, short: `back on the power sooner`, val: s.p * binM, unit: "m", metric: (m) => m.p * binM };
  },
  ({ r, s, binM }) => {
    const d = s.rampM - r.rampM, thr = Math.max(5, 0.8 * binM) * 1.5;
    if (d < thr) return null;
    return { id: "slow-ramp", phase: "exit", ratio: d / thr, text: `You were timid building up to full power`, tip: `Roll onto the throttle faster once the car is pointing out of the corner.`, short: `faster onto the throttle`, val: s.rampM, unit: "m", metric: (m) => m.rampM };
  },
  ({ r, s }) => {
    if (s.lifts <= r.lifts) return null;
    return { id: "lift", phase: "exit", ratio: s.lifts - r.lifts, text: `You came off the power ${s.lifts - r.lifts > 1 ? "several times" : "once"} on the way out`, tip: `Once you are on the throttle, stay on it. If the car steps out, a smoother squeeze keeps it down.`, short: `no lift on the exit`, val: s.lifts, unit: "", metric: (m) => m.lifts };
  },
  ({ r, s, binM }) => {
    if (r.tcM == null || s.tcM == null || s.tcM - r.tcM < Math.max(15, 1.2 * binM)) return null;
    const d = s.tcM - r.tcM;
    return { id: "tc", phase: "exit", ratio: d / Math.max(15, 1.2 * binM), text: `The rear wheels were spinning and the traction control had to step in`, tip: `Ease onto the throttle more gradually and get the wheel straighter before you go to full power.`, short: `ease onto the throttle, the rears are spinning`, val: s.tcM, unit: "m", metric: (m) => m.tcM ?? 0 };
  },
  ({ r, s }) => {
    if (s.steerWork < r.steerWork * 1.3 || s.steerWork - r.steerWork < 0.15) return null;
    const p = 100 * (s.steerWork - r.steerWork);
    return { id: "steer-work", phase: "exit", ratio: p / 30, text: `You were busy with the wheel on the way out: the car was unsettled`, tip: `Calmer hands on the exit. Every correction scrubs speed.`, short: `calmer hands on the exit`, val: s.steerWork, unit: "", metric: (m) => m.steerWork };
  },
  ({ r, s, binM }) => {
    const d = s.coastM - r.coastM, thr = 2 * Math.max(5, 0.8 * binM);
    if (d < thr) return null;
    return { id: "coast", phase: "entry", ratio: d / thr, text: `You were off both pedals ${amt(d)} longer than the reference`, tip: `Go from throttle to brake, and from brake to throttle, with no gap in between.`, short: `no coasting between the pedals`, val: s.coastM, unit: "m", metric: (m) => m.coastM };
  },
  ({ r, s }) => {
    if (s.gear === r.gear || s.gear <= 0 || r.gear <= 0) return null;
    return { id: "gear", phase: "mid", ratio: 1.5, text: `You were in gear ${s.gear} at the slowest point, the reference in ${r.gear}`, tip: `Try gear ${r.gear} here.`, short: `gear ${r.gear} at the slowest point`, val: s.gear, unit: "", metric: (m) => m.gear };
  },
  ({ r, s, sp, su }) => {
    const d = sp(r.vExit) - sp(s.vExit), one = sp(2) - sp(0);
    if (d < one) return null;
    return { id: "exit-speed", phase: "straight", ratio: d / one, text: `You came out of the corner ${n0(d)} ${su} slower and carried it all down the straight`, tip: `The straight is lost on the way out. Work on getting on the power earlier and on the line out of the corner.`, short: `a faster exit`, val: sp(s.vExit), unit: su, metric: (m) => sp(m.vExit) };
  },
  ({ r, s, sp, su }) => {
    const d = sp(r.vTop) - sp(s.vTop), one = sp(2) - sp(0);
    if (d < one || Math.abs(r.vExit - s.vExit) >= 2) return null;
    return { id: "top-speed", phase: "straight", ratio: d / one, external: true, text: `You were ${n0(d)} ${su} slower at the end of the straight, though you left the corner just as fast`, tip: `Not the corner. Look at the slipstream, wind, fuel load or the car.`, short: `check the straight, not the corner`, val: sp(s.vTop), unit: su, metric: (m) => sp(m.vTop) };
  },
];

export function causesOf(i: RuleIn): Cause[] {
  const all = RULES.map((f) => f(i)).filter((c): c is Cause => c != null);
  const late = (i.s.p - i.r.p) * i.binM, coastD = i.s.coastM - i.r.coastM;
  const keep = all.filter((c) => !(c.id === "coast" && all.some((k) => k.id === "late-throttle") && coastD <= 1.2 * late) && !(c.id === "unused-grip" && all.some((k) => k.id === "low-min")));
  return keep.some((c) => c.phase !== "straight") ? keep.filter((c) => c.id !== "exit-speed") : keep;
}
