import { useEffect, useReducer, useRef } from "react";
import { bindMapControls, drawMap, loadTracks, MapOpts, MapOut, MapView } from "../draw/map";
import { drawGG, drawLive, drawTraces, lanes as laneDefs, LANE_CHOICES, ROW_CHOICES, rowDefs, TraceZoom } from "../draw/charts";
import { defineModule } from "../engine/registry";
import { feed } from "../feed/store";
import { Icon } from "../lib/icons";
import { fmtDelta, fmtLap } from "../lib/format";
import { useSize } from "../lib/useSize";
import { usePrefs } from "../state/prefs";
import { NB, recorder, TRACE_N } from "../state/recorder";
import { LabelsPanel, labelsPanel, useLabelsOpen } from "./maplabels";
import { selection, useSelection } from "../state/selection";
import { lapName, selState } from "./lapsel";
import { coachReport, isReport } from "../state/coach";
import { unit } from "../lib/units";

// ---------- track map ----------
const views = new Map<string, MapView>();
const outs = new Map<string, MapOut>();

function MapCanvas({ id, opts }: { id: string; opts: MapOpts & { follow: boolean } }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const el = cv.current!;
    const view: MapView = { zoom: optsRef.current.follow ? 4 : 1, follow: optsRef.current.follow, dx: 0, dy: 0 };
    views.set(id, view);
    let raf = 0, dead = false;
    const paint = () => {
      const c = feed.get();
      if (c.r && el.isConnected) outs.set(id, drawMap(el, view, c, optsRef.current));
    };
    // The feed arrives in bursts, so the map paints on every animation frame: the dots glide at the screen's rate.
    const tick = () => { if (dead) return; paint(); raf = requestAnimationFrame(tick); };
    void loadTracks().then(() => { raf = requestAnimationFrame(tick); });
    const off = bindMapControls(el, view, paint, (x, y) => { // a click within 10 px of a car makes it the focus car
      let best: number | null = null, d = 10;
      for (const h of outs.get(id)?.hits ?? []) { const e = Math.hypot(h.x - x, h.y - y); if (e <= d) { d = e; best = h.i; } }
      if (best != null) feed.setFocus(best === feed.get().me ? "self" : best);
    });
    return () => { dead = true; cancelAnimationFrame(raf); off(); views.delete(id); outs.delete(id); };
  }, [id]);

  return <div className="cv map"><canvas ref={cv} aria-label="Track map: your car and the field" /></div>;
}

function MapTools({ id }: { id: string }) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const v = views.get(id);
  const zoom = (k: number) => { if (v) { v.zoom = Math.min(40, Math.max(1, v.zoom * k)); if (v.zoom === 1) v.dx = v.dy = 0; } bump(); };
  return (
    <span className="map-btns">
      <button type="button" className="btn sm" aria-label="Zoom in" onClick={() => zoom(1.5)}>+</button>
      <button type="button" className="btn sm" aria-label="Zoom out" onClick={() => zoom(1 / 1.5)}>−</button>
    </span>
  );
}

/** Labels and Follow sit with Options and Hide on the right of the header. */
function MapQuick({ id }: { id: string }) {
  const on = useLabelsOpen(id);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const v = views.get(id);
  const follow = () => { if (v) { v.follow = !v.follow; if (v.follow && v.zoom < 4) v.zoom = 4; if (!v.follow) { v.zoom = 1; v.dx = v.dy = 0; } } bump(); };
  return (
    <>
      <button type="button" className="btn icon" title="Labels" aria-label="Labels" aria-pressed={on} onClick={() => labelsPanel.toggle(id)}><Icon name="tag" /></button>
      <button type="button" className="btn icon" title="Follow your car" aria-label="Follow your car" aria-pressed={!!v?.follow} onClick={follow}><Icon name="crosshair" /></button>
    </>
  );
}

function MapBody({ id, opts, cap }: { id: string; opts: MapOpts & { follow: boolean }; cap: boolean }) {
  const on = useLabelsOpen(id);
  return (
    <div className="map-body">
      <div className="map-main">
        <MapCanvas id={id} opts={opts} />
        {cap ? <span className="v di map-cap">labels set in Labels · wheel zooms about the pointer</span> : null}
      </div>
      {on ? <LabelsPanel id={id} opts={opts as unknown as Record<string, unknown>} /> : null}
    </div>
  );
}

export const trackMap = defineModule({
  type: "track-map", title: "Track map", group: "Car", blurb: "Your car and the field on the track, zoom, pan and follow.",
  size: { w: 6, h: 14, minW: 3, minH: 6 }, needs: ["reading", "field", "entries", "focus"], requires: ["reading"], rate: 10,
  options: [
    { key: "field", label: "Show the field", type: "toggle", hidden: true, def: true },
    { key: "fields", label: "Car labels, shown in this order", type: "multi", hidden: true, choices: [["pos", "Position"], ["num", "Race number"], ["code", "Three letters"], ["name", "Surname"], ["gap", "Gap to you"]], def: ["gap"] },
    { key: "which", label: "Label which cars", type: "select", hidden: true, choices: [["all", "All"], ["near", "Within 30 s"], ["class", "My class"], ["focus", "Focus car only"]], def: "all" },
    { key: "dim", label: "Dim cars more than 30 s away", type: "toggle", hidden: true, def: false },
    { key: "colours", label: "Colour each label field", type: "toggle", hidden: true, def: false },
    { key: "size", label: "Size of cars and labels", type: "select", hidden: true, choices: [["s", "Small"], ["m", "Medium"], ["l", "Large"]], def: "m" },
    { key: "corners", label: "Turn names (on the drawn layout)", type: "toggle", hidden: true, def: false },
    { key: "road", label: "Road width", type: "select", hidden: true, choices: [["s", "Thin"], ["m", "Normal"], ["l", "Wide"]], def: "m" },
    { key: "sectors", label: "Colour the sectors", type: "toggle", hidden: true, def: true },
    { key: "follow", label: "Start following the car", type: "toggle", def: false },
  ],
  tools: [],
  tool(tool, { id }) {
    const v = views.get(id);
    if (!v) return;
    if (tool === "follow") { v.follow = !v.follow; if (v.follow && v.zoom < 4) v.zoom = 4; }
    if (tool === "fit") { v.follow = false; v.zoom = 1; v.dx = v.dy = 0; }
  },
  view({ ctx: c, opts, id, size }) {
    const out = outs.get(id);
    const vw = views.get(id);
    return {
      flush: true,
      headExtra: <MapTools id={id} />,
      quick: <MapQuick id={id} />,
      info: [(c.r?.fixed.track ?? "").replace(/_/g, "-").toUpperCase(), vw?.follow ? "FOLLOWING YOU" : "WHOLE TRACK"],
      state: out?.empty ? { kind: "empty", msg: "No layout for this track." } : undefined,
      body: <MapBody id={id} opts={opts as MapOpts & { follow: boolean }} cap={size.w >= 6 && size.h >= 14} />,
    };
  },
});

// ---------- G-G ----------
function GGCanvas() {
  const cv = useRef<HTMLCanvasElement>(null);
  const p = usePrefs();
  useEffect(() => {
    let raf = 0;
    const tick = () => { if (cv.current?.isConnected) drawGG(cv.current, recorder.frozen ?? recorder.trace, 5 * p.hz); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p.hz]);
  return <div className="cv" style={{ position: "absolute", inset: 0 }}><canvas ref={cv} aria-label="G-G plot" /></div>;
}

export const gg = defineModule({
  type: "gg", title: "G-G", group: "Car", blurb: "Lateral against longitudinal G over the last seconds: the friction circle.",
  size: { w: 3, h: 7, minW: 3, minH: 5 }, needs: ["reading"], rate: 5,
  view({ size }) {
    const T = recorder.frozen ?? recorder.trace, k = T.n ? (T.i - 1 + TRACE_N) % TRACE_N : -1;
    const lat = k >= 0 ? T.data.gLat[k]! : null, lon = k >= 0 ? T.data.gLon[k]! : null;
    const peak = Math.max(recorder.gHist.maxLat, recorder.gHist.maxLon), large = size.h >= 7;
    const f = (v: number | null) => (v == null ? "–" : v.toFixed(2).replace("-", "\u2212"));
    return {
      flush: true,
      info: large ? ["LAST 5 s"] : [],
      body: (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ aspectRatio: "1", height: "100%", flex: "none", position: "relative", minWidth: 0 }}><GGCanvas /></div>
          <div className="fc" style={{ flex: 1, borderLeft: "1px solid var(--ln)", padding: "var(--pad)" }}>
            <div className="r"><span>{large ? "Lateral" : "Lat"}</span><span>{f(lat)}{large ? " G" : ""}</span></div>
            <div className="r"><span>{large ? "Longitudinal" : "Long"}</span><span>{f(lon)}{large ? " G" : ""}</span></div>
            <div className="r"><span>Peak</span><span className="wn">{peak.toFixed(2)}{large ? " G" : ""}</span></div>
          </div>
        </div>
      ),
    };
  },
});

// ---------- live channels ----------
function LiveCanvas({ rows, win }: { rows: string[]; win: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const hover = useRef<number | null>(null);
  const p = usePrefs();
  const size = useSize(host);
  const cfg = useRef({ rows, win, units: p.units });
  cfg.current = { rows, win, units: p.units };

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = cv.current;
      if (el?.isConnected) drawLive(el, rowDefs(cfg.current.units), cfg.current.rows, recorder.frozen ?? recorder.trace, hover.current, cfg.current.win);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size.w, size.h]);

  const move = (e: React.PointerEvent) => {
    const b = cv.current!.getBoundingClientRect();
    hover.current = Math.round((1 - (e.clientX - b.left) / b.width) * (win - 1));
  };
  return <div className="cv" ref={host}><canvas ref={cv} aria-label="Live channels" onPointerMove={move} onPointerLeave={() => { hover.current = null; }} /></div>;
}

export const channels = defineModule({
  type: "channels", title: "Live channels", group: "Car", blurb: "Rolling traces of speed, pedals, steering, gear and more; hover to read values.",
  size: { w: 6, h: 8, minW: 4, minH: 5 }, needs: ["reading", "rec"], rate: 5,
  options: [
    { key: "rows", label: "Rows", type: "multi", choices: ROW_CHOICES, def: ["speed", "pedals", "steer", "gearrpm"] },
    { key: "window", label: "Window", type: "select", choices: [["20", "20 s"], ["30", "30 s"], ["60", "60 s"]], def: "30" },
  ],
  tools: [{ id: "pause", icon: "pause", label: "Pause or resume (P)" }],
  tool: (id) => { if (id === "pause") recorder.setPaused(!recorder.frozen); },
  view({ opts }) {
    const p = usePrefs();
    const defs = rowDefs(p.units), rows = (opts.rows as string[]).filter((k) => defs[k]);
    if (!rows.length) return { state: { kind: "empty", msg: "No channels chosen: pick some in the options." } };
    const win = Math.min(TRACE_N, +opts.window * p.hz);
    return { flush: true, tools: [{ id: "pause", icon: recorder.frozen ? "play" : "pause", label: recorder.frozen ? "Resume (P)" : "Pause (P)" }], info: [`LAST ${opts.window} s`, recorder.frozen ? "PAUSED" : ""], body: <LiveCanvas rows={rows} win={win} /> };
  },
});

// ---------- traces ----------
function TraceCanvas({ rows, refLap, cmp, cursor, len, zoom }: { rows: string[]; refLap: ReturnType<typeof recorder.lapById>; cmp: ReturnType<typeof recorder.lapById>; cursor: number | null; len: number; zoom: TraceZoom | null }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const p = usePrefs();
  const size = useSize(host);
  useEffect(() => {
    if (!cv.current || !refLap) return;
    drawTraces(cv.current, laneDefs(p.units), rows, refLap, cmp?.data ? cmp : null, cursor, len, zoom);
  });
  void size;
  return (
    <div className="cv" ref={host}>
      <canvas ref={cv} aria-label="Lap comparison traces" onPointerMove={(e) => { const b = cv.current!.getBoundingClientRect(), u = (e.clientX - b.left) / b.width; selection.setCursor(zoom ? (zoom.lo + u * (zoom.hi - zoom.lo)) / (NB - 1) : u); }} onPointerLeave={() => selection.setCursor(null)} />
    </div>
  );
}

export const traces = defineModule({
  type: "traces", title: "Traces", group: "Analysis", blurb: "REF against CMP over the lap distance: Δ time, speed, pedals, steering, gear.",
  size: { w: 6, h: 22, minW: 4, minH: 10 }, needs: ["rec", "sel", "reading", "theme", "resize", "units"], rate: 20,
  options: [
    { key: "lanes", label: "Lanes", type: "multi", choices: LANE_CHOICES, def: ["delta", "speed", "pedals", "steer", "gear"] },
    { key: "corners", label: "Shade and number the corners", type: "toggle", def: true },
  ],
  view({ ctx: c, opts }) {
    const sel = useSelection();
    const p = usePrefs();
    const s = selState(sel);
    if ("msg" in s) return { state: { kind: "empty", msg: s.msg } };
    const defs = laneDefs(p.units), ids = (opts.lanes as string[]).filter((k) => defs[k]);
    const su = unit("speed", p.units), rep = opts.corners ? coachReport(c, sel, "lap", su.f, su.u) : null;
    if (!ids.length) return { state: { kind: "empty", msg: "No lanes chosen: pick some in the options." } };
    // The corner zones; one wrapping over the line is two bands, and a corner picked in the coach fills the width.
    const cs = rep && isReport(rep) ? rep.corners : [], last = NB - 1, foc = cs.find((k) => k.corner.n === sel.corner)?.corner ?? null;
    const zoom: TraceZoom | null = cs.length ? {
      lo: foc ? Math.max(0, foc.start - 8) : 0, hi: foc ? Math.min(last, Math.min(foc.end, last) + 8) : last,
      bands: cs.flatMap((k) => { const z = k.corner, sl = z.n === sel.corner; return z.end > last ? [{ a: z.start, b: last, n: z.n, sl }, { a: 0, b: z.end - last, n: z.n, sl }] : [{ a: z.start, b: z.end, n: z.n, sl }]; }).map(({ sl, ...b }) => ({ ...b, sel: sl })),
    } : null;
    return {
      info: `REF ${lapName(s.ref)} ${fmtLap(s.ref.ms)}${s.cmp ? ` · CMP ${lapName(s.cmp)} ${fmtLap(s.cmp.ms)} · ${fmtDelta(s.cmp.ms - s.ref.ms)}` : ""}`,
      body: (
        <>
          <div className="tr-lg"><span className="lg"><i className="lsw" style={{ ["--c" as string]: "var(--c-ref)" }} />REF solid</span><span className="lg"><i className="lsw dash" style={{ ["--c" as string]: "var(--c-cmp)" }} />CMP dashed</span>{foc ? <button type="button" className="btn sm" onClick={() => selection.setCorner(null)}>Whole lap</button> : null}</div>
          <TraceCanvas rows={ids} refLap={s.ref} cmp={s.cmp} cursor={sel.cursor} len={c.r ? c.r.fixed.track_length_m : 0} zoom={zoom} />
        </>
      ),
    };
  },
});
