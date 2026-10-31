import { Fragment, ReactNode, useEffect, useRef, useState } from "react";
import { defineModule } from "../engine/registry";
import type { Ctx } from "../feed/store";
import type { Json } from "../feed/types";
import { carName } from "../lib/cars";
import { Debrief } from "../lib/advice";
import { fmtDelta, fmtGap, fmtLap, fmtSector, nf, NONE, okMs, plural } from "../lib/format";
import { get } from "../state/bridge";
import { recorder, RecLap } from "../state/recorder";
import { selection, Sel, useSelection } from "../state/selection";
import { carNum, fieldOn } from "./cars";
import { editor } from "../state/editor";
import { Delta } from "./delta";
import { autoSel, lapName, pick } from "./lapsel";

const hasTrace = (c: Ctx, n: number) => c.laps.some((l) => l.n === n && l.trace) || !!recorder.lapById("lap-" + n);

function SelButtons({ sel, id }: { sel: Sel; id: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, verticalAlign: "middle" }}>
      {(["ref", "cmp"] as const).map((w) => (
        <button key={w} type="button" className="btn sm" aria-pressed={sel[w] === id} style={{ width: 26, padding: 0, ...(sel[w] === id ? { borderColor: w === "ref" ? "var(--tx)" : "var(--warn)", color: w === "ref" ? "var(--tx)" : "var(--warn)" } : {}) }}
          title={w === "ref" ? "Reference lap (solid)" : "Comparison lap (dashed)"} onClick={() => pick(w, id)}>{w === "ref" ? "R" : "C"}</button>
      ))}
    </span>
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

function WhoSeg({ who, id }: { who: string; id: string }) {
  const set = (w: string) => editor.setOpt((m) => { m.options = { ...m.options, who: w }; }, id);
  return (
    <div className="seg">
      {([["self", "MINE"], ["focus", "FOCUS CAR"], ["both", "BOTH"]] as const).map(([w, l]) => (
        <button key={w} type="button" aria-pressed={(who ?? "self") === w} onClick={() => set(w)}>{l}</button>
      ))}
    </div>
  );
}

export const laps = defineModule({
  type: "laps", title: "Laps", group: "Laps", blurb: "Every lap of the session by stint: times, sectors, fuel, position, marks; pick laps to compare.",
  size: { w: 8, h: 22, minW: 5, minH: 8 }, needs: ["laps", "rec", "sel", "focus", "summary"], rate: 2,
  options: [
    { key: "who", label: "Whose laps", type: "select", choices: [["self", "Mine"], ["focus", "The focus car (when one is set)"], ["both", "Both, lap by lap (when a focus car is set)"]], def: "self" },
    { key: "onlyStint", label: "This stint only", type: "toggle", def: false },
  ],
  view({ ctx: c, opts, id, size }) {
    const sel = useSelection();
    const [fold, setFold] = useState<Set<number>>(new Set());
    const both = opts.who === "both";
    const other = (opts.who === "focus" || both) && c.focus !== "self" ? c.cars.get(c.focus) ?? null : null;
    const fetched = useFieldLaps(other && !c.view ? other.i : null, other ? `${other.i}:${other.laps}` : "");
    const fl = c.view && other ? { car: other.i, laps: c.view.carLaps[other.i] ?? [] } : fetched;
    if (other && fl.car !== other.i) return { state: { kind: "empty", msg: `Loading #${other.num}'s laps from the bridge…` } };
    if (both && other) {
      const mine = new Map<number, Json>(c.laps.map((l) => [l.n, l])), theirs = new Map<number, Json>(fl.laps.map((l) => [l.n, l]));
      const ns = [...new Set([...mine.keys(), ...theirs.keys()])].sort((a, b) => b - a);
      if (!ns.length) return { state: { kind: "empty", msg: "No laps yet." } };
      const big = size.w >= 7 && size.h >= 12, tm = (l?: Json) => (l && okMs(l.ms) ? fmtLap(l.ms) : NONE);
      const d = (a?: number | null, b?: number | null) => (okMs(a) && okMs(b) ? <Delta ms={a - b} /> : NONE);
      return {
        flush: true,
        headExtra: big ? <WhoSeg who="both" id={id} /> : null,
        info: [`YOU vs ${carNum(other)}`],
        body: (
          <table className="t">
            <thead><tr><th>Lap</th><th>You</th><th>{carNum(other)}</th><th>Δ</th>{big ? <><th>Δ S1</th><th>Δ S2</th><th>Δ S3</th></> : null}</tr></thead>
            <tbody>
              {ns.map((n) => {
                const a = mine.get(n), b = theirs.get(n);
                return (
                  <tr key={n}>
                    <td>{n}</td>
                    <td className={a && !a.valid ? "iv" : ""}>{tm(a)}</td>
                    <td className={b && !b.valid ? "iv" : ""}>{tm(b)}</td>
                    <td>{a?.valid && b?.valid ? d(a.ms, b.ms) : NONE}</td>
                    {big ? [0, 1, 2].map((k) => <td key={k}>{a?.valid && b?.valid ? d(a.s?.[k], b.s?.[k]) : NONE}</td>) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ),
      };
    }
    let L: Json[] = other ? fl.laps : c.laps;
    if (!L.length && !(!other && c.past.length)) return { state: { kind: "empty", msg: other ? "No laps for that car yet." : "No completed laps yet." } };
    const cs = Math.max(...L.map((l) => l.stint || 1));
    if ((opts.onlyStint || size.w < 7 || size.h < 12) && !other) L = L.filter((l) => (l.stint || 1) === cs);
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
    const own = !other, ncol = own ? 9 : 8;
    const large = size.w >= 7 && size.h >= 12;
    const cls = (v: number | null | undefined, sbest: boolean, pbest: boolean) => (!okMs(v) ? "" : sbest ? "b" : pbest ? "p" : "");
    const markOf = (l: Json, p: boolean[] | undefined, isB: boolean) => [l.out && "OUT", l.in && "IN", !l.valid && "INV", isB && !l.out && !l.in && l.valid ? "● PB" : p && p[0] && l.valid ? "● PB" : ""].filter(Boolean).join(" ");
    const row = (l: Json, old?: string) => {
      const id = "lap-" + l.n, p = old ? undefined : pb.get(l.n), inv = !l.valid, isB = !old && !inv && l.ms === best;
      const ref = own && !old && sel.ref === id, cmp = own && !old && sel.cmp === id;
      return (
        <tr key={old ? old + l.n : l.n}>
          <td className={isB ? "p" : ""}>{l.n}</td>
          <td className={inv ? "iv" : cls(l.ms, !old && l.ms === fb, isB || !!p?.[0], )}>{okMs(l.ms) ? fmtLap(l.ms).replace(/^0:(\d\d\.)/, "0:$1") : NONE}</td>
          {[0, 1, 2].map((k) => { const v = (l.s ?? [])[k]; return <td key={k} className={inv ? "mu" : cls(v, !old && v <= fS[k]!, (!old && v === sBest[k]) || !!p?.[k + 1])}>{okMs(v) ? fmtSector(v) : NONE}</td>; })}
          {large ? <><td>{l.fuel > 0 ? nf(l.fuel, 2) : NONE}</td><td>{l.pos ? l.pos : NONE}</td><td className="l">{markOf(l, p, isB)}</td></> : <td>{l.fuel > 0 ? nf(l.fuel, 2) : NONE}</td>}
          {large && own ? <td>{old || !hasTrace(c, l.n) ? "" : <SelButtons sel={sel} id={id} />}</td> : null}
        </tr>
      );
    };
    let body: ReactNode;
    const stints = (c.s?.stints as Json[] | undefined) ?? [];
    if (own) {
      const live = c.r?.session;
      body = [
        large && live && okMs(live.current_lap_ms) ? <tr key="live" className="own"><td>{live.lap_number}</td><td>{fmtLap(live.current_lap_ms)}</td><td /><td /><td /><td>{NONE}</td><td>{live.position || NONE}</td><td className="l">LIVE</td><td /></tr> : null,
        ...[...new Set(L.map((l) => (l.stint || 1) as number))].sort((a, b) => b - a).map((n) => {
          const ls = L.filter((l) => (l.stint || 1) === n), info = stints.find((t) => t.n === n) ?? {}, folded = fold.has(n);
          return (
            <Fragment key={n}>
              {large ? (
                <tr className="grp" onClick={() => setFold((s0) => { const q = new Set(s0); if (q.has(n)) q.delete(n); else q.add(n); return q; })}>
                  <td colSpan={ncol} className="l di" style={{ textAlign: "right", fontFamily: "var(--sans)", letterSpacing: ".08em", background: "var(--p2)" }}>
                    {folded ? "▸ " : ""}STINT {n} · {info.wet || ls[0]?.wet ? "W" : "SET"} {nf(info.tyre_set != null ? info.tyre_set : ls[ls.length - 1]!.set, 0)} · {plural(ls.length, "lap").toUpperCase()}
                  </td>
                </tr>
              ) : null}
              {folded ? null : ls.slice().reverse().map((l) => row(l))}
            </Fragment>
          );
        }),
      ];
    } else body = L.slice().reverse().map((l) => row(l));
    if (own && large) {
      const older = c.past.slice().reverse().filter((ps) => ps.id !== c.view?.id).map((ps, k) => {
        const ls = ps.laps as Json[], key = -1 - k, folded = fold.has(key), okk = ls.filter((l) => l.valid && l.ms > 0).map((l) => l.ms as number);
        return (
          <Fragment key={"past" + k}>
            <tr className="grp" onClick={() => setFold((s0) => { const q = new Set(s0); if (q.has(key)) q.delete(key); else q.add(key); return q; })}>
              <td colSpan={ncol} className="l di" style={{ textAlign: "right", fontFamily: "var(--sans)", letterSpacing: ".08em", background: "var(--p2)" }}>{folded ? "▸ " : ""}{String(ps.kind).toUpperCase()} · {plural(ls.length, "lap").toUpperCase()} · BEST {fmtLap(okk.length ? Math.min(...okk) : null)}</td>
            </tr>
            {folded ? null : ls.slice().reverse().map((l) => row(l, "p" + k))}
          </Fragment>
        );
      });
      body = [body, ...older];
    }
    const refN = sel.ref ? Number(String(sel.ref).replace("lap-", "")) : null, cmpN = sel.cmp ? Number(String(sel.cmp).replace("lap-", "")) : null;
    return {
      flush: true,
      headExtra: large ? <WhoSeg who={opts.who} id={id} /> : null,
      info: large ? [plural(L.length, "lap").toUpperCase(), refN ? `REF L${refN}` : "", cmpN ? <span key="c" className="wn">CMP L{cmpN}</span> : ""] : [opts.onlyStint ? "THIS STINT" : "THIS STINT"],
      body: (
        <table className="t">
          <thead>
            <tr><th>Lap</th><th>Time</th><th>S1</th><th>S2</th><th>S3</th>{large ? <><th>Fuel used</th><th>Pos</th><th className="l">Marks</th>{own ? <th>Compare</th> : null}</> : <th>Fuel</th>}</tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      ),
    };
  },
});

// ---------- debrief ----------
export const debrief = defineModule({
  type: "debrief", title: "Debrief", group: "Laps", blurb: "The engineer's notes on the last laps.", size: { w: 4, h: 12, minW: 3, minH: 6 },
  needs: ["summary"],
  view({ ctx, size }) {
    const laps = ((ctx.s?.debrief as Json[] | undefined) ?? []).slice().reverse();
    if (!laps.length) return { state: { kind: "empty", msg: "The last laps' analysis appears here after the first lap." } };
    const large = size.h >= 10;
    const shown = laps.slice(0, large ? 5 : 3);
    return {
      flush: true,
      info: large ? [`LAST ${shown.length} LAPS`] : [],
      body: (
        <table className="t">
          <tbody>
            {shown.map((l) => (
              <tr key={l.lap_number}>
                <td className="mu" style={{ width: 44 }}>L{l.lap_number}</td>
                <td className="l" style={{ whiteSpace: "normal", lineHeight: 1.4, padding: 6 }}>
                  {((l.lines as Json[] | undefined) ?? []).length ? (l.lines as Json[]).map((x, k) => <span key={k} className={x.severity >= 2 ? "up" : x.severity === 1 ? "wn" : ""}>{x.severity >= 2 ? "▲ " : ""}{x.text}{k < (l.lines as Json[]).length - 1 ? " " : ""}</span>) : <span className="p">● {fmtLap(l.lap_time_ms)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    };
  },
});

// ---------- lap picker ----------
export const lapPicker = defineModule({
  type: "lap-picker", title: "Lap picker", group: "Analysis", blurb: "Every lap with a trace (bridge, this page, imported): pick REF and CMP.",
  size: { w: 3, h: 22, minW: 3, minH: 8 }, multi: false, needs: ["rec", "laps", "sel"],
  view({ ctx: c, size }) {
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
    const large = size.h >= 12;
    const foot = large ? (
      <div className="f" style={{ padding: 8, gap: 8, borderTop: "1px solid var(--ln)", flexWrap: "wrap" }}>
        <button type="button" className="btn sm" onClick={() => recorder.exportLaps()}>Export laps</button>
        <label className="btn sm">Import laps<input ref={file} type="file" accept=".json,application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setNote(await recorder.importLaps(f)); e.target.value = ""; }} /></label>
        <button type="button" className="btn sm" onClick={() => { autoSel.cmp = false; selection.select("cmp", null); }}>Clear CMP</button>
        <span className="v di" role="status">{note}</span>
      </div>
    ) : <input ref={file} type="file" accept=".json,application/json" hidden />;
    if (!rows.length) return { state: { kind: "empty", msg: "Laps with traces appear here after the first whole lap. You can also import a laps file.", action: { label: "Import laps…", fn: () => file.current?.click() } }, body: foot };
    const from = (l: RecLap) => (l.src === "import" ? "imported" : l.src === "live" ? "this page" : "bridge");
    return {
      flush: true,
      info: large ? [sel.ref ? `REF ${lapName(have.get(sel.ref) ?? rows[0]!)}` : "", sel.cmp && have.get(sel.cmp) ? `CMP ${lapName(have.get(sel.cmp)!)}` : ""] : [],
      body: (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            <table className="t">
              <thead><tr><th>Lap</th><th>Time</th>{large ? <th className="l">From</th> : null}<th style={{ width: 52, textAlign: "center" }}>REF</th><th style={{ width: 52, textAlign: "center" }}>CMP</th></tr></thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td title={lapName(l)}>{lapName(l).replace(/^L/, "")}</td>
                    <td className={l.valid ? (rows.every((x) => !x.valid || x.ms >= l.ms) ? "p" : "") : "iv"}>{fmtLap(l.ms)}</td>
                    {large ? <td className="l mu">{from(l)}{!l.data && recorder.pending.has(l.n) ? " · loading" : ""}</td> : null}
                    <td style={{ textAlign: "center" }}><button type="button" className="btn sm" aria-pressed={sel.ref === l.id} style={sel.ref === l.id ? { borderColor: "var(--tx)", color: "var(--tx)" } : undefined} onClick={() => pick("ref", l.id)}>R</button></td>
                    <td style={{ textAlign: "center" }}><button type="button" className="btn sm" aria-pressed={sel.cmp === l.id} style={sel.cmp === l.id ? { borderColor: "var(--warn)", color: "var(--warn)" } : undefined} onClick={() => pick("cmp", l.id)}>C</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {foot}
        </div>
      ),
    };
  },
});
