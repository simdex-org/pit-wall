import { useEffect, useReducer, useRef, useState } from "react";
import { drawLapMap, LapMapIn, LapMapMode, LapMapShow, MODES } from "../draw/lapmap";
import { bindMapControls, loadTracks, MapView, wholeLine } from "../draw/map";
import { defineModule } from "../engine/registry";
import { fmtDelta, fmtLap } from "../lib/format";
import { unit } from "../lib/units";
import { usePrefs } from "../state/prefs";
import { coachReport, isReport } from "../state/coach";
import { NB, RecLap, recorder } from "../state/recorder";
import { selection, useSelection } from "../state/selection";
import { lapName, selState } from "./lapsel";

const views = new Map<string, MapView>();

function LapMapCanvas({ id, a }: { id: string; a: LapMapIn }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const hit = useRef<((x: number, y: number) => number | null) | null>(null);
  const args = useRef(a);
  args.current = a;
  const view = useRef<MapView>({ zoom: 1, follow: false, dx: 0, dy: 0 });
  const paint = useRef(() => {});
  paint.current = () => { if (cv.current?.isConnected) hit.current = drawLapMap(cv.current, view.current, args.current); };
  useEffect(() => { paint.current(); });
  useEffect(() => {
    views.set(id, view.current);
    const off = bindMapControls(cv.current!, view.current, () => paint.current(), (x, y) => { // a click picks the corner under the pointer; one off the line clears it
      const f = hit.current?.(x, y), u = f == null ? null : f * (NB - 1), k = u == null ? null : args.current.report?.corners.find((q) => (u >= q.corner.start && u < q.corner.end) || (q.corner.end > NB - 1 && u < q.corner.end - (NB - 1)));
      selection.setCorner(k && selection.get().corner !== k.corner.n ? k.corner.n : null);
    });
    return () => { off(); views.delete(id); };
  }, [id]);
  const move = (e: React.PointerEvent) => {
    const b = cv.current!.getBoundingClientRect();
    selection.setCursor(hit.current?.(e.clientX - b.left, e.clientY - b.top) ?? null);
  };
  return <div className="cv map"><canvas ref={cv} aria-label="Lap map: the reference and comparison laps" onPointerMove={move} onPointerLeave={() => selection.setCursor(null)} /></div>;
}

function LapMapTools({ id }: { id: string }) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const v = views.get(id);
  const zoom = (k: number) => { if (v) { v.zoom = Math.min(40, Math.max(1, v.zoom * k)); if (v.zoom === 1) v.dx = v.dy = 0; } bump(); };
  const fit = () => { if (v) { v.follow = false; v.zoom = 1; v.dx = v.dy = 0; } bump(); };
  return (
    <span className="map-btns">
      <button type="button" className="btn sm" aria-label="Zoom in" onClick={() => zoom(1.5)}>+</button>
      <button type="button" className="btn sm" aria-label="Zoom out" onClick={() => zoom(1 / 1.5)}>−</button>
      <button type="button" className="btn sm" onClick={fit}>Fit</button>
    </span>
  );
}

/** A lap's own racing line when it drove one whole; imported laps have none. */
const lineOf = (l: RecLap | null) => (l && l.src !== "import" ? wholeLine(recorder.lines.find((x) => x.n === l.n)?.pts as number[][] | undefined) : null);

const TOGGLES: [string, string][] = [["corners", "Corners"], ["brakes", "Brake points"], ["slowest", "Slowest points"], ["cmpLine", "CMP line"]];

export const lapMap = defineModule({
  type: "lap-map", title: "Lap map", group: "Analysis", blurb: "Where a lap was won or lost, on the track: REF coloured by time, speed, pedals, steering, gear or RPM against CMP, with the corners, brake points and slowest points. Click a corner to look at it.",
  size: { w: 5, h: 14, minW: 3, minH: 8 }, needs: ["rec", "sel", "theme", "resize", "units"], rate: 20,
  options: [
    { key: "mode", label: "Colour the REF line by", type: "select", choices: MODES.map(([k, l]) => [k, l] as [string, string]), def: "delta" },
    { key: "show", label: "Time and speed differences", type: "select", choices: [["all", "Show all"], ["loss", "Only where CMP is behind"], ["gain", "Only where CMP is ahead"]], def: "all" },
    { key: "width", label: "Line width", type: "select", choices: [["4", "Thin"], ["7", "Medium"], ["11", "Wide"]], def: "7" },
    { key: "corners", label: "Corners, with the time of each", type: "toggle", def: true },
    { key: "brakes", label: "Brake points", type: "toggle", def: true },
    { key: "slowest", label: "Slowest points", type: "toggle", def: true },
    { key: "cmpLine", label: "Draw the CMP racing line", type: "toggle", def: false },
  ],
  view({ ctx: c, opts, id }) {
    const sel = useSelection();
    const p = usePrefs();
    // The bar over the map changes the view only; the options set what a new map starts with.
    const [ov, setOv] = useState<Record<string, unknown>>({});
    const o = { ...opts, ...ov };
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => { void loadTracks().then(bump); }, []);
    const s = selState(sel);
    if ("msg" in s) return { state: { kind: "empty", msg: s.msg } };
    const own = lineOf(s.ref), cmpLine = lineOf(s.cmp), track = c.r?.fixed.track ?? "";
    const base = own ?? cmpLine ?? recorder.layoutFor(track)?.pts ?? wholeLine(recorder.bestLine()?.pts as number[][] | undefined);
    if (!base) return { state: { kind: "empty", msg: "The map needs a whole recorded lap or the saved layout of this track." } };
    const cmp = s.cmp?.data ? s.cmp : null, su = unit("speed", p.units);
    const modes = MODES.filter(([, , needs]) => !needs || cmp), mode = (modes.some(([k]) => k === o.mode) ? o.mode : "speed") as LapMapMode;
    const rep = coachReport(c, sel, "lap", su.f, su.u);
    const a: LapMapIn = {
      ref: s.ref, cmp, base, cmpLine: cmpLine !== base ? cmpLine : null, mode, show: o.show as LapMapShow, width: +o.width,
      brakes: !!o.brakes, slowest: !!o.slowest, corners: !!o.corners, cmpDraw: !!o.cmpLine, report: isReport(rep) ? rep : null, focus: sel.corner, cursor: sel.cursor, len: c.r ? c.r.fixed.track_length_m : 0, speed: su.f, unit: su.u,
    };
    const set = (k: string, v: unknown) => setOv((q) => ({ ...q, [k]: v }));
    const diff = mode === "delta" || mode === "speedd";
    return {
      flush: true,
      headExtra: <LapMapTools id={id} />,
      info: `REF ${lapName(s.ref)} ${fmtLap(s.ref.ms)}${s.cmp ? ` · CMP ${lapName(s.cmp)} ${fmtDelta(s.cmp.ms - s.ref.ms)}` : ""}`,
      body: (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div className="f" style={{ padding: 6, gap: 6, flexWrap: "wrap", borderBottom: "1px solid var(--ln)" }}>
            <select aria-label="Colour the REF line by" value={mode} onChange={(e) => set("mode", e.target.value)}>
              {modes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {diff ? (
              <div className="seg">
                {([["all", "All"], ["loss", "Behind"], ["gain", "Ahead"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={a.show === k} title={k === "all" ? "Every stretch" : k === "loss" ? "Only where CMP is behind REF" : "Only where CMP is ahead of REF"} onClick={() => set("show", k)}>{l}</button>)}
              </div>
            ) : null}
            {TOGGLES.filter(([k]) => k !== "cmpLine" || cmpLine).map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={!!o[k]} onClick={() => set(k, !o[k])}>{l}</button>)}
          </div>
          <LapMapCanvas id={id} a={a} />
        </div>
      ),
    };
  },
});
