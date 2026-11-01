// The lap coach: a subject lap against a benchmark (one chosen lap, or the best of each corner over the session), cut into
// corners that tile the lap, with where the time went, why, what to try, and what the pattern across corners says.
import { LapData, NB } from "../../state/recorder";
import { binMOf, Corner, findCorners, measure, Metrics, timeAt } from "./measure";
import { Cause, causesOf, Phase } from "./rules";

export interface CoachLap {
  id: string; n: number; ms: number; valid: boolean; src: "live" | "bridge" | "import"; label: string; data: LapData;
  /** The racing line, [x, z, lap fraction] a point every 1.5 m, when the lap was driven here and whole. */
  line?: ArrayLike<number[]> | null;
  out?: boolean; in?: boolean; wet?: boolean; set?: number; stint?: number;
}

export interface CoachIn {
  laps: CoachLap[]; subject: string;
  /** Another lap to compare against, or null for the best of each corner over the session. */
  bench: string | null;
  len: number;
  sp?: (kmh: number) => number; su?: string;
  name?: (c: Corner, line: ArrayLike<number[]> | null) => string;
}

export const PHASES: Phase[] = ["entry", "mid", "exit", "straight"];
export interface Fact { label: string; s: string; b: string }
export interface Found extends Cause { ms: number }
export interface CornerReport {
  corner: Corner; name: string; delta: number; noise: number; kind: "loss" | "gain" | "even";
  phases: Record<Phase, number>; causes: Found[]; unexplained: number; facts: Fact[]; tip: string; short: string; conf: "high" | "medium" | "low";
  /** In how many of the session's laps this corner was within reach of the best, and how many laps there are. */
  matched: { n: number; of: number } | null;
  /** What the subject could gain here against the best lap of the session, ms. */
  potential: number; bestLap: string | null; bench: string; s: Metrics; b: Metrics;
}
export interface Pattern { id: string; text: string; ms: number; corners: number[] }
export interface Focus { n: number; name: string; ms: number; text: string; short: string }
export interface Report {
  subject: CoachLap; bench: CoachLap | null; total: number; byPhase: Record<Phase, number>; corners: CornerReport[]; patterns: Pattern[];
  focus: Focus[]; notes: string[]; table: number; binM: number;
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1]! : 0; };
const group = (l: CoachLap) => (l.src === "import" ? "imp:" + l.label : "own");
const zone = (d: LapData, c: Corner) => timeAt(d, c.end) - timeAt(d, c.start);
const sec = (ms: number) => (Math.abs(ms) / 1000).toFixed(2);

/** The racing line's position at a lap fraction. */
export function pointAt(line: ArrayLike<number[]>, f: number): [number, number] {
  let lo = 0, hi = line.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((line[m]![2] ?? 0) < f) lo = m; else hi = m; }
  return [line[hi]![0]!, line[hi]![1]!];
}

/** How far outside the benchmark's line the subject's is at a corner's slowest point, metres (negative: inside). */
function lineOffset(bench: ArrayLike<number[]>, subj: ArrayLike<number[]>, f: number): number {
  const d = 0.002, a = pointAt(bench, f - d), b = pointAt(bench, f), c = pointAt(bench, f + d), s = pointAt(subj, f);
  const turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  const tx = c[0] - a[0], tz = c[1] - a[1], m = Math.hypot(tx, tz) || 1;
  const inside = (((s[0] - b[0]) * -tz + (s[1] - b[1]) * tx) / m) * Math.sign(turn);
  return -inside;
}

const FACTS: [string, (m: Metrics, binM: number, sp: (v: number) => number, su: string) => string | null][] = [
  ["Brake point", (m, bm) => (m.braked ? `${Math.round(m.e * bm)} m` : null)],
  ["Peak brake", (m) => (m.braked ? `${Math.round(100 * m.peak)} %` : null)],
  ["Slowest point", (m, _b, sp, su) => `${Math.round(sp(m.vMin))} ${su}`],
  ["Throttle on", (m, bm) => `${Math.round(m.p * bm)} m`],
  ["Full throttle", (m, bm) => `${Math.round(m.x * bm)} m`],
  ["Exit speed", (m, _b, sp, su) => `${Math.round(sp(m.vExit))} ${su}`],
  ["Gear at the slowest point", (m) => String(m.gear)],
];

const PATTERN: Record<string, string> = {
  "brake-early": "Braking early", "brake-late": "Braking late and paying for it after", "brake-soft": "Light on the brake at the start", "brake-long": "On the brakes too long",
  abs: "ABS limiting the braking", "less-trail": "Leaving the brake early before the turn", "low-min": "Low speed through the middle", "unused-grip": "Grip left unused in the middle",
  "front-push": "The front pushing", "wide-line": "Wide at the slowest point", "tight-line": "Tight at the slowest point", "late-throttle": "Late on the throttle",
  "slow-ramp": "Slow onto the throttle", lift: "Lifting on the exit", tc: "Wheelspin on the exit", "steer-work": "Busy hands on the exit", coast: "Coasting between the pedals",
  gear: "A different gear", "exit-speed": "A slow exit down the straight",
};

export function buildReport(inp: CoachIn): Report | { msg: string } {
  const subj = inp.laps.find((l) => l.id === inp.subject), bench = inp.bench ? inp.laps.find((l) => l.id === inp.bench) ?? null : null;
  if (!subj) return { msg: "Pick a lap to look at." };
  if (inp.bench && !bench) return { msg: "The benchmark lap is not loaded." };
  const g = group(subj), clean = inp.laps.filter((l) => l.valid && !l.out && !l.in && group(l) === g).sort((a, b) => a.ms - b.ms);
  // A lap 7 % or more behind the best is an off, a spin or traffic: it says nothing about the usual spread.
  const fast = clean[0] ? clean[0].ms : subj.ms, pool = clean.filter((l) => l.ms <= fast * 1.07), incident = subj.ms > fast * 1.07;
  const binM = binMOf(inp.len), sp = inp.sp ?? ((v) => v), su = inp.su ?? "km/h";
  const seen = new Set<string>(), basis = [subj, ...(bench ? [bench] : []), ...pool].filter((l) => !seen.has(l.id) && seen.add(l.id)).slice(0, 10);
  const ordered = [...basis].sort((a, b) => a.ms - b.ms), corners = findCorners(ordered.map((l) => l.data), binM);
  if (corners.length < 2) return { msg: "No corners found yet: the coach needs a whole lap of a track with corners." };

  const notes: string[] = [];
  if (incident) notes.push(`This lap is ${sec(subj.ms - fast)} s slower than your best: probably an off, a spin or traffic, so the findings are only a guide.`);
  if (!subj.valid) notes.push("This lap is invalid (track limits), but its times are real.");
  if (subj.out || subj.in) notes.push("An out or in lap: the pace here is not a flying lap, so the comparison is only a guide.");
  if (bench && subj.src !== "import" && bench.src !== "import") {
    if (subj.wet != null && bench.wet != null && subj.wet !== bench.wet) notes.push("The two laps are on different tyres (wet and dry): the times are not comparable.");
    else if (subj.set != null && bench.set != null && subj.set !== bench.set) notes.push(`Different tyre sets (${subj.set} and ${bench.set}): part of the gap may be the tyres.`);
    if (subj.stint != null && bench.stint != null && subj.stint !== bench.stint) notes.push("The laps are from different stints: fuel load and tyre age differ.");
  }
  if (!subj.data.glat || (bench && !bench.data.glat)) notes.push("This lap has no cornering force, TC or ABS data (an older bridge or file): the findings that need them are skipped.");

  const rest = pool.filter((l) => l.id !== subj.id);
  const out: CornerReport[] = [], byPhase = { entry: 0, mid: 0, exit: 0, straight: 0 } as Record<Phase, number>;
  for (const c of corners) {
    const zt = pool.map((l) => zone(l.data, c)), mad = median(zt.map((v) => Math.abs(v - median(zt))));
    const noise = pool.length >= 4 ? Math.max(10, 1.4826 * mad) : 15;
    // The benchmark of this corner: the chosen lap, or the best lap of the session (not the subject) here.
    const best = [...rest].sort((a, b) => zone(a.data, c) - zone(b.data, c))[0] ?? null;
    const bl = bench ?? best;
    if (!bl) continue;
    const dS = subj.data, dB = bl.data, delta = zone(dS, c) - zone(dB, c);
    const s = measure(dS, c, binM), b = measure(dB, c, binM);
    const cut = [c.start, Math.max(c.start, b.r), Math.max(b.r, b.a), Math.max(b.a, b.x), c.end];
    const phases = Object.fromEntries(PHASES.map((p, i) => [p, timeAt(dS, cut[i + 1]!) - timeAt(dS, cut[i]!) - (timeAt(dB, cut[i + 1]!) - timeAt(dB, cut[i]!))])) as Record<Phase, number>;
    const f = b.a / (NB - 1) % 1, line = subj.line && bl.line ? lineOffset(bl.line, subj.line, f) : null;
    const found = causesOf({ r: b, s, binM, line, laterLoss: phases.mid + phases.exit + phases.straight, sp, su });
    const loss = delta >= noise, gain = delta <= -noise, causes: Found[] = [];
    let unexplained = 0;
    if (loss) {
      // Each phase's loss goes to the causes found in it; a phase with none (the exit after a slow middle) is the result of the
      // nearest phase that had some, the one before it first.
      for (const x of found) causes.push({ ...x, ms: 0 });
      PHASES.forEach((p, i) => {
        const L = phases[p];
        if (L < 8) return;
        let cs = causes.filter((x) => x.phase === p);
        for (let k = i - 1; !cs.length && k >= 0; k--) cs = causes.filter((x) => x.phase === PHASES[k] && !x.external);
        for (let k = i + 1; !cs.length && k < PHASES.length; k++) cs = causes.filter((x) => x.phase === PHASES[k] && !x.external);
        const w = cs.map((x) => Math.min(4, x.ratio)), tw = w.reduce((x, y) => x + y, 0);
        if (!cs.length) unexplained += L; else cs.forEach((x, k) => { x.ms += (L * w[k]!) / tw; });
      });
      causes.sort((x, y) => Number(!!x.external) - Number(!!y.external) || Number(x.phase === "straight") - Number(y.phase === "straight") || y.ms - x.ms);
    }
    for (const p of PHASES) byPhase[p] += phases[p];
    const main = causes[0];
    const tip = loss ? (main ? main.tip : "The pedals and steering match the benchmark here: the time is in the line or the grip" + (line == null ? ", and there is no racing line to check it." : ".")) : "";
    const mt = zt.length ? Math.min(...zt) : zone(dS, c);
    const matched = pool.length >= 2 ? { n: zt.filter((v) => v <= mt + Math.max(15, 0.8 * noise)).length, of: pool.length } : null;
    out.push({
      corner: c, name: inp.name ? inp.name(c, bl.line ?? subj.line ?? null) : `T${c.n}`, delta, noise, kind: loss ? "loss" : gain ? "gain" : "even", phases, causes, unexplained,
      facts: FACTS.flatMap(([label, fn]) => { const x = fn(s, binM, sp, su), y = fn(b, binM, sp, su); return x != null && y != null ? [{ label, s: x, b: y }] : []; }),
      tip, short: main ? main.short : "", conf: incident ? "low" : loss && main && delta >= 2 * noise && main.ratio >= 2 ? "high" : loss && main && delta >= noise ? "medium" : "low",
      matched, potential: Math.max(0, zone(dS, c) - mt), bestLap: best ? best.id : null, bench: bl.id, s, b,
    });
  }

  const total = out.reduce((a, x) => a + x.delta, 0), table = out.reduce((a, x) => a + (x.kind === "loss" ? x.delta : 0), 0);
  // The same cause in several corners is a habit, not an accident.
  const patterns: Pattern[] = [], ids = new Set(out.flatMap((x) => x.causes.filter((c) => !c.external).map((c) => c.id)));
  for (const id of ids) {
    const hit = out.filter((x) => x.kind === "loss" && x.causes.some((c) => c.id === id));
    const ms = hit.reduce((a, x) => a + x.causes.filter((c) => c.id === id).reduce((q, c) => q + c.ms, 0), 0);
    if (hit.length < 3 || ms < 40 || !PATTERN[id]) continue;
    const mags = hit.map((x) => { const c = x.causes.find((q) => q.id === id)!; return /line$/.test(id) ? c.val : Math.abs(c.metric(x.s) - c.metric(x.b)); });
    const avg = mags.reduce((a, v) => a + v, 0) / mags.length, unit = hit[0]!.causes.find((c) => c.id === id)!.unit;
    const cls = (["slow", "medium", "fast"] as const).find((k) => hit.filter((x) => x.corner.cls === k).length >= 0.75 * hit.length && out.filter((x) => x.corner.cls === k).length >= 3);
    patterns.push({ id, ms, corners: hit.map((x) => x.corner.n), text: `${PATTERN[id]} in ${hit.length} of ${out.length} corners${cls ? `, mostly the ${cls} ones` : ""}${unit && avg >= 1 ? `: about ${Math.round(avg)} ${unit} on average` : ""} (${sec(ms)} s).` });
  }
  patterns.sort((a, b) => b.ms - a.ms);

  // What to work on: the biggest losses that can be got back; one the driver has already matched counts in full.
  const focus = out.filter((x) => x.kind === "loss" && x.causes[0] && x.delta >= 30)
    .map((x) => ({ x, v: x.delta * (x.matched && x.matched.n >= 2 ? 1 : 0.7) * (x.conf === "low" ? 0.5 : 1) }))
    .sort((a, b) => b.v - a.v).slice(0, 3)
    .map(({ x }): Focus => ({ n: x.corner.n, name: x.name, ms: x.delta, text: x.tip, short: x.short }));
  return { subject: subj, bench, total, byPhase, corners: out, patterns, focus, notes, table, binM };
}

/** What a tip was aimed at, kept to see on the next lap whether it moved. */
export interface Snap { lap: string; items: { n: number; id: string; short: string; unit: string; metric: Cause["metric"]; prev: number; delta: number }[] }

export function snapshot(r: Report): Snap {
  return { lap: r.subject.id, items: r.focus.flatMap((f) => { const c = r.corners.find((x) => x.corner.n === f.n)!, k = c.causes[0]!; return /line$/.test(k.id) ? [] : [{ n: f.n, id: k.id, short: k.short, unit: k.unit, metric: k.metric, prev: k.metric(c.s), delta: c.delta }]; }) };
}

/** For each earlier tip: did the measured value move toward the benchmark, and what did the corner do. */
export function progress(snap: Snap | null, r: Report): string[] {
  if (!snap || snap.lap === r.subject.id) return [];
  return snap.items.flatMap((it) => {
    const c = r.corners.find((x) => x.corner.n === it.n);
    if (!c) return [];
    const target = it.metric(c.b), toward = Math.abs(it.prev - target) - Math.abs(it.metric(c.s) - target), dt = it.delta - c.delta;
    const moved = Math.abs(toward) < 0.5 ? "no change" : `${Math.round(Math.abs(toward))} ${it.unit} ${toward > 0 ? "closer" : "further away"}`;
    return [`${c.name}, ${it.short}: ${moved}, ${Math.abs(dt) < 10 ? "same time" : `${sec(dt)} s ${dt > 0 ? "better" : "worse"}`}.`];
  });
}
