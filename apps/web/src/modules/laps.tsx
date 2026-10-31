import { Fragment, ReactNode, useEffect, useRef, useState } from "react";
import { defineModule } from "../engine/registry";
import type { Ctx } from "../feed/store";
import type { Json } from "../feed/types";
import { carName } from "../lib/cars";
import { Debrief } from "../lib/advice";
import { fmtDelta, fmtGap, fmtLap, fmtSector, MINUS, nf, NONE, okMs, plural } from "../lib/format";
import { unit } from "../lib/units";
import { get } from "../state/bridge";
import { usePrefs } from "../state/prefs";
import { NB, recorder, RecLap } from "../state/recorder";
import { selection, Sel, useSelection } from "../state/selection";
import { fieldOn } from "./cars";
import { Delta } from "./delta";
import { autoSel, lapName, pick, selState } from "./lapsel";

const hasTrace = (c: Ctx, n: number) => c.laps.some((l) => l.n === n && l.trace) || !!recorder.lapById("lap-" + n);

function SelButtons({ sel, id }: { sel: Sel; id: string }) {
  return (
    <>
      {(["ref", "cmp"] as const).map((w) => (
        <button key={w} type="button" className={`btn sel-${w}`} aria-pressed={sel[w] === id} title={w === "ref" ? "Reference lap (solid)" : "Comparison lap (dashed)"} onClick={() => pick(w, id)}>{w.toUpperCase()}</button>
      ))}
    </>
  );
}

// ---------- laps ----------
function mark(v: number | null | undefined, isSb: boolean, isPb: boolean, f: (v: number) => string): ReactNode {
  if (!okMs(v)) return NONE;
  return isSb ? <span className="t-best">◆ {f(v)}</span> : isPb ? <span className="t-pb">● {f(v)}</span> : f(v);
}

function useFieldLaps(car: number | null, key: string): { laps: Json[]; car: number | null } {
  const [state, setState] = useState<{ laps: Json[]; car: number | null; key: string }>({ laps: [], car: null, key: "" });
  const loading = useRef(false);
  useEffect(() => {
    if (car == null || state.key === key || loading.current) return;
    loading.current = true;
    void get<Json>("/field/laps?car=" + car).then((j) => {
      loading.current = false;
      setState({ laps: j && Array.isArray(j.laps) ? j.laps : [], car, key });
    });
  }, [car, key, state.key]);
  return state;
}

export const laps = defineModule({
  type: "laps", title: "Laps", group: "Laps", blurb: "Every lap of the session by stint: times, sectors, fuel, position, marks; pick laps to compare.",
  size: { w: 8, h: 22, minW: 5, minH: 8 }, needs: ["laps", "rec", "sel", "focus", "summary"], rate: 2,
  options: [
    { key: "who", label: "Whose laps", type: "select", choices: [["self", "Mine"], ["focus", "The focus car (when one is set)"]], def: "self" },
    { key: "onlyStint", label: "This stint only", type: "toggle", def: false },
  ],
  view({ ctx: c, opts }) {
    const sel = useSelection();
    const [fold, setFold] = useState<Set<number>>(new Set());
    const other = opts.who === "focus" && c.focus !== "self" ? c.cars.get(c.focus) ?? null : null;
    const fl = useFieldLaps(other ? other.i : null, other ? `${other.i}:${other.laps}` : "");
    if (other && fl.car !== other.i) return { state: { kind: "empty", msg: `Loading #${other.num}'s laps from the bridge…` } };
    let L: Json[] = other ? fl.laps : c.laps;
    if (!L.length) return { state: { kind: "empty", msg: other ? "No laps for that car yet." : "No completed laps yet." } };
    const cs = Math.max(...L.map((l) => l.stint || 1));
    if (opts.onlyStint && !other) L = L.filter((l) => (l.stint || 1) === cs);
    const ok = L.filter((l) => l.valid && l.ms > 0), best = ok.length ? Math.min(...ok.map((l) => l.ms as number)) : null;
    const sBest = [0, 1, 2].map((k) => Math.min(...ok.map((l) => (l.s ?? [])[k] as number).filter((v) => v > 0), Infinity));
    // ◆ is the session best of the whole field, never just this list's best, which is ● like any improvement.
    const F = fieldOn(c) ? c.field! : null, fb = F && F.best && F.best.ms > 0 ? F.best.ms : null, cars = F ? [...c.cars.values()] : [];
    const fS = [0, 1, 2].map((k) => Math.min(...cars.map((x) => (x.best_s ?? [])[k] as number).filter((v) => v > 0), Infinity));
    // Personal improvements: faster than every earlier valid lap (the lap and each sector).
    const pb = new Map<number, boolean[]>();
    { let lb = Infinity; const sb = [Infinity, Infinity, Infinity];
      for (const l of L) {
        if (!l.valid) continue;
        pb.set(l.n, [l.ms < lb, ...[0, 1, 2].map((k) => (l.s ?? [])[k] > 0 && l.s[k] < sb[k]!)]);
        lb = Math.min(lb, l.ms);
        for (const k of [0, 1, 2]) if ((l.s ?? [])[k] > 0) sb[k] = Math.min(sb[k]!, l.s[k]);
      } }
    const own = !other, ncol = own ? 11 : 9;
    const row = (l: Json) => {
      const id = "lap-" + l.n, p = pb.get(l.n) ?? [], inv = !l.valid, isB = !inv && l.ms === best, ref = own && sel.ref === id, cmp = own && sel.cmp === id;
      return (
        <tr key={l.n} className={[ref && "ref", cmp && "cmp"].filter(Boolean).join(" ") || undefined}>
          {own ? <td className="lp-sel">{hasTrace(c, l.n) ? <SelButtons sel={sel} id={id} /> : null}</td> : null}
          <td className="n">{l.n}</td>
          <td className="n">{inv ? <span className="t-inv">{fmtLap(l.ms)}</span> : mark(l.ms, l.ms === fb, isB || !!p[0], fmtLap)}</td>
          <td className="n">{isB || inv || best == null ? "" : fmtDelta(l.ms - best)}</td>
          {[0, 1, 2].map((k) => { const v = (l.s ?? [])[k]; return <td className="n" key={k}>{inv ? <span className="s-dim">{fmtSector(v)}</span> : mark(v, v <= fS[k]!, v === sBest[k] || !!p[k + 1], fmtSector)}</td>; })}
          {own ? <td className="n">{nf(l.fuel, 2)}</td> : null}
          <td className="n">{l.pos ? "P" + l.pos : NONE}</td><td className="n">{l.gap != null ? fmtGap(l.gap) : NONE}</td>
          <td className="tags">
            {l.out ? <b className="tag out">OUT</b> : null} {l.in ? <b className="tag in">IN</b> : null} {inv ? <b className="tag inv">INV</b> : null} {ref ? <b className="tag ref">REF</b> : null} {cmp ? <b className="tag cmp">CMP</b> : null}
          </td>
        </tr>
      );
    };
    let body: ReactNode;
    if (own) {
      const stints = (c.s?.stints as Json[] | undefined) ?? [];
      body = [...new Set(L.map((l) => (l.stint || 1) as number))].sort((a, b) => b - a).map((n) => {
        const ls = L.filter((l) => (l.stint || 1) === n), info = stints.find((t) => t.n === n) ?? {}, folded = fold.has(n);
        const clean = ls.filter((l) => l.valid && !l.out && !l.in), avg = clean.length ? clean.reduce((a, l) => a + l.ms, 0) / clean.length : null, fu = ls.filter((l) => l.fuel > 0);
        return (
          <Fragment key={n}>
            <tr className="tt-group"><td colSpan={ncol}>
              <button type="button" className="fold" aria-expanded={!folded} aria-label={`Fold stint ${n}`} onClick={() => setFold((s) => { const q = new Set(s); if (q.has(n)) q.delete(n); else q.add(n); return q; })} />
              Stint {n} · {info.wet || ls[0]?.wet ? "W" : "D"} set {nf(info.tyre_set != null ? info.tyre_set : ls[ls.length - 1]!.set, 0)} · {plural(ls.length, "lap")} · best {fmtLap(info.best_ms != null ? info.best_ms : Math.min(...ls.filter((l) => l.valid).map((l) => l.ms as number), Infinity))} · avg clean {fmtLap(avg)} · {fu.length ? nf(fu.reduce((a, l) => a + l.fuel, 0) / fu.length, 2) : NONE} L/lap
            </td></tr>
            {folded ? null : ls.slice().reverse().map(row)}
          </Fragment>
        );
      });
    } else body = L.slice().reverse().map(row);

    // Ideal lap: the best sectors of the clean laps that have all three. When the best lap has no sectors the ideal can be slower than it.
    const full = ok.filter((l) => !l.out && !l.in && (l.s ?? []).length >= 3 && (l.s as number[]).slice(0, 3).every((v) => v > 0));
    const ideal = full.length ? [0, 1, 2].reduce((a, k) => a + Math.min(...full.map((l) => l.s[k] as number)), 0) : null, bl = ok.find((l) => l.ms === best);
    const why = !ideal ? "" : bl && !full.includes(bl) ? ` · best lap L${bl.n} had no sectors` : best != null ? ` · ${fmtDelta(ideal - best)} vs best` : "";
    const bm = best == null ? "" : best === fb ? " · ◆ " + fmtLap(best) : " · ● " + fmtLap(best);
    return {
      info: other ? `#${other.num} ${carName(other, "short")} · ${plural(L.length, "lap")}${bm}` : `${opts.who === "focus" ? "yours · click a car to see theirs · " : ""}${plural(L.length, "lap")}${bm}`,
      body: (
        <table className="tt lp">
          <thead>
            <tr>{own ? <th className="lp-sel" /> : null}<th className="n">Lap</th><th className="n">Time</th><th className="n">Δ best</th><th className="n">S1</th><th className="n">S2</th><th className="n">S3</th>{own ? <th className="n">Fuel L</th> : null}<th className="n">Pos</th><th className="n">Gap</th><th /></tr>
          </thead>
          <tbody>{body}</tbody>
          <tfoot>{ideal ? <tr><td colSpan={ncol}>Ideal {fmtLap(ideal)} <span className="note">(Σ best sectors, {plural(full.length, "lap")}){why}</span></td></tr> : null}</tfoot>
        </table>
      ),
    };
  },
});

// ---------- debrief ----------
export const debrief = defineModule({
  type: "debrief", title: "Debrief", group: "Laps", blurb: "The engineer's notes on the last laps.", size: { w: 4, h: 12, minW: 3, minH: 6 },
  needs: ["summary"],
  view: ({ ctx }) => ({ body: <Debrief laps={ctx.s?.debrief} /> }),
});

// ---------- lap picker ----------
export const lapPicker = defineModule({
  type: "lap-picker", title: "Lap picker", group: "Analysis", blurb: "Every lap with a trace (bridge, this page, imported): pick REF and CMP.",
  size: { w: 3, h: 22, minW: 3, minH: 8 }, multi: false, needs: ["rec", "laps", "sel"],
  view({ ctx: c }) {
    const sel = useSelection();
    const file = useRef<HTMLInputElement>(null);
    const [note, setNote] = useState("");
    const have = new Map(recorder.laps.filter((l) => l.data).map((l) => [l.id, l] as const));
    for (const l of c.laps) if (l.trace && !have.has("lap-" + l.n)) have.set("lap-" + l.n, { id: "lap-" + l.n, n: l.n, ms: l.ms, valid: l.valid, src: "bridge", label: "", data: null });
    const rows = [...have.values()].sort((a, b) => Number(a.src === "import") - Number(b.src === "import") || (a.src === "import" ? b.id.localeCompare(a.id, undefined, { numeric: true }) : b.n - a.n));

    // Until a lap is picked by hand, REF follows the best valid lap and CMP the newest other valid lap ("last vs best"),
    // re-chosen as laps complete; a click on REF or CMP (or Clear CMP) stops that slot following.
    useEffect(() => {
      const own = rows.filter((l) => l.src !== "import");
      const set = (w: "ref" | "cmp", l: RecLap) => { if (selection.get()[w] === l.id) return; selection.select(w, l.id); const n = Number(l.id.replace("lap-", "")); if (n) void recorder.ensureLap(n); };
      if (autoSel.ref && rows.length) { const ok = own.filter((l) => l.valid); set("ref", ok.length ? ok.reduce((a, x) => (x.ms < a.ms ? x : a)) : rows[0]!); }
      if (autoSel.cmp) { const n = own.find((l) => l.id !== selection.get().ref && l.valid) ?? own.find((l) => l.id !== selection.get().ref); if (n) set("cmp", n); }
    });

    const foot = (
      <>
        <div className="lk-foot">
          <button type="button" className="btn" onClick={() => recorder.exportLaps()}>Export laps</button>
          <label className="btn">Import laps<input ref={file} type="file" accept=".json,application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setNote(await recorder.importLaps(f)); e.target.value = ""; }} /></label>
          <button type="button" className="btn" onClick={() => { autoSel.cmp = false; selection.select("cmp", null); }}>Clear CMP</button>
        </div>
        <p className="note" role="status">{note}</p>
      </>
    );
    if (!rows.length) return { state: { kind: "empty", msg: "Laps with traces appear here after the first whole lap. You can also import a laps file.", action: { label: "Import laps…", fn: () => file.current?.click() } }, body: foot };
    return {
      info: plural(rows.length, "lap"),
      body: (
        <>
          <table className="tt lk">
            <tbody>
              {rows.map((l) => {
                const r = sel.ref === l.id, m = sel.cmp === l.id;
                return (
                  <tr key={l.id} className={[r && "ref", m && "cmp"].filter(Boolean).join(" ") || undefined}>
                    <td className="lp-sel"><SelButtons sel={sel} id={l.id} /></td>
                    <td className="lk-n" title={lapName(l)}>{lapName(l)}</td>
                    <td className="n">{l.valid ? fmtLap(l.ms) : <span className="t-inv">{fmtLap(l.ms)}</span>}</td>
                    <td className="tags">
                      {l.valid ? null : <b className="tag inv">INV</b>}
                      {m && autoSel.cmp ? <b className="tag s-dim" title="Follows the newest lap until you pick one">auto</b> : null}
                      {!l.data && recorder.pending.has(l.n) ? <span className="note">loading</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {foot}
        </>
      ),
    };
  },
});

// ---------- where the time goes ----------
const SEG = 20;

/** Brake onset, minimum speed and throttle pickup: the largest normalised difference names the cause. */
function cause(ref: RecLap, cmp: RecLap, a: number, b: number, binM: number, speedUnit: ReturnType<typeof unit>): string {
  const ev = (l: RecLap) => {
    const d = l.data!;
    let bo: number | null = null, mi = a, tp: number | null = null;
    for (let i = a; i <= b; i++) { if (bo == null && d.brk[i]! > 0.1) bo = i; if (d.speed[i]! < d.speed[mi]!) mi = i; }
    for (let i = mi; i <= b; i++) if (d.thr[i]! > 0.9) { tp = i; break; }
    return { bo, mv: d.speed[mi]!, tp };
  };
  const r = ev(ref), m = ev(cmp), out: [number, string][] = [];
  const dist = (bins: number) => (binM ? `${Math.abs(bins * binM).toFixed(0)} m` : `${Math.abs((bins / (NB - 1)) * 100).toFixed(1)} %`);
  if (r.bo != null && m.bo != null && m.bo !== r.bo) out.push([(Math.abs(m.bo - r.bo) * (binM || 12.5)) / 20, `Brakes ${dist(m.bo - r.bo)} ${m.bo < r.bo ? "earlier" : "later"}`]);
  const dv = m.mv - r.mv;
  if (Math.abs(dv) >= 1) out.push([Math.abs(dv) / 5, `Min speed ${dv > 0 ? "+" : MINUS}${Math.abs(speedUnit.f(dv)).toFixed(0)} ${speedUnit.u}`]);
  if (r.tp != null && m.tp != null && m.tp !== r.tp) out.push([(Math.abs(m.tp - r.tp) * (binM || 12.5)) / 20, `Throttle ${dist(m.tp - r.tp)} ${m.tp > r.tp ? "later" : "earlier"}`]);
  out.sort((x, y) => y[0] - x[0]);
  return out.length && out[0]![0] >= 0.2 ? out[0]![1] : NONE;
}

export const segments = defineModule({
  type: "segments", title: "Where the time goes", group: "Analysis", blurb: "The lap cut into 20 parts, ranked by time lost, with the likely cause.",
  size: { w: 3, h: 10, minW: 3, minH: 6 }, needs: ["rec", "sel", "reading"],
  view({ ctx: c }) {
    const sel = useSelection();
    const p = usePrefs();
    const s = selState(sel);
    if ("msg" in s) return { state: { kind: "empty", msg: s.msg } };
    if (!s.cmp || !s.cmp.data) return { state: { kind: "empty", msg: "Pick a comparison lap (CMP) as well." } };
    const len = c.r ? c.r.fixed.track_length_m : 0, binM = len > 0 ? len / (NB - 1) : 0, R = s.ref.data!.t, M = s.cmp.data.t;
    const segs = [];
    for (let k = 0; k < SEG; k++) {
      const a = Math.round((k / SEG) * (NB - 1)), b = Math.round(((k + 1) / SEG) * (NB - 1)), d = M[b]! - M[a]! - (R[b]! - R[a]!);
      segs.push({ k, a, b, d, why: cause(s.ref, s.cmp, a, b, binM, unit("speed", p.units)) });
    }
    const where = (x: { a: number; b: number }) => (len > 0 ? `${Math.round(x.a * binM)}–${Math.round(x.b * binM)} m` : `${((x.a / (NB - 1)) * 100).toFixed(0)}–${((x.b / (NB - 1)) * 100).toFixed(0)} %`);
    const cur = sel.cursor;
    // The parts that differ by 10 ms or more, biggest change first; under 10 ms is noise between two laps of one driver.
    const shown = segs.filter((x) => Math.abs(x.d) >= 10).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)), why = shown.some((x) => x.why && x.why !== NONE);
    // Net is the sum of every part, the lap delta of the traces; it differs from the lap times only by the traces' offset.
    const gain = segs.filter((x) => x.d < 0).reduce((a, x) => a + x.d, 0), loss = segs.filter((x) => x.d > 0).reduce((a, x) => a + x.d, 0), net = gain + loss;
    const lapD = s.cmp.ms - s.ref.ms;
    return {
      info: `CMP ${lapName(s.cmp)} vs REF ${lapName(s.ref)}`,
      body: (
        <>
          <table className="tt sg">
            <thead hidden={!shown.length}><tr><th className="n">#</th><th className="n">Distance</th><th className="n">Δ</th>{why ? <th>Cause</th> : null}</tr></thead>
            <tbody>
              {shown.map((x, i) => (
                <tr key={x.k} className={cur != null && cur * (NB - 1) >= x.a && cur * (NB - 1) <= x.b ? "sg-on" : undefined} title="Show this part on the traces and the map" onClick={() => selection.setCursor((x.a + x.b) / 2 / (NB - 1))}>
                  <td className="n">{i + 1}</td><td className="n">{where(x)}</td><td className="n"><Delta ms={x.d} /></td>{why ? <td className="sg-why">{x.why}</td> : null}
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={why ? 4 : 3}>
              Gains <Delta ms={gain} /> · losses <Delta ms={loss} /> · net <Delta ms={net} /> (CMP {MINUS} REF lap <Delta ms={lapD} />{Math.abs(net - lapD) > 5 ? <span className="note">, trace offset {nf(Math.abs(net - lapD) / 1000, 3)} s</span> : null})
            </td></tr></tfoot>
          </table>
          <div className="sg-none">{shown.length ? null : <div className="empty">No part differs by 0.01 s or more.</div>}</div>
        </>
      ),
    };
  },
});

