import { useEffect, useRef } from "react";
import { bindMapControls, drawMap, loadTracks, MapOpts, MapOut, MapView } from "../draw/map";
import { drawGG, drawLive, drawTraces, lanes as laneDefs, LANE_CHOICES, ROW_CHOICES, rowDefs } from "../draw/charts";
import { defineModule } from "../engine/registry";
import { feed } from "../feed/store";
import { fmtDelta, fmtLap } from "../lib/format";
import { useSize } from "../lib/useSize";
import { usePrefs } from "../state/prefs";
import { recorder, TRACE_N } from "../state/recorder";
import { selection, useSelection } from "../state/selection";
import { lapName, selState } from "./lapsel";

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

export const trackMap = defineModule({
  type: "track-map", title: "Track map", group: "Car", blurb: "Your car and the field on the track, zoom, pan and follow.",
  size: { w: 6, h: 14, minW: 3, minH: 6 }, needs: ["reading", "field", "entries", "focus"], requires: ["reading"], rate: 10,
  options: [
    { key: "field", label: "Show the field", type: "toggle", def: true },
    { key: "labels", label: "Car labels", type: "select", choices: [["gap", "Gap to you"], ["none", "None (dots only)"], ["number", "Race number"], ["short", "Driver code"], ["name", "Driver surname"], ["both", "Number and code"]], def: "gap" },
    { key: "size", label: "Size of cars and labels", type: "select", choices: [["s", "Small"], ["m", "Medium"], ["l", "Large"]], def: "m" },
    { key: "corners", label: "Turn names (on the drawn layout)", type: "toggle", def: true },
    { key: "follow", label: "Start following the car", type: "toggle", def: false },
  ],
  tools: [{ id: "follow", icon: "crosshair", label: "Follow the car (F)" }, { id: "fit", icon: "maximize", label: "Whole track (Shift+F)" }],
  tool(tool, { id }) {
    const v = views.get(id);
    if (!v) return;
    if (tool === "follow") { v.follow = !v.follow; if (v.follow && v.zoom < 4) v.zoom = 4; }
    if (tool === "fit") { v.follow = false; v.zoom = 1; v.dx = v.dy = 0; }
  },
  view({ opts, id }) {
    const out = outs.get(id);
    return {
      info: out?.info ?? "",
      state: out?.empty ? { kind: "empty", msg: "No layout for this track." } : undefined,
      body: <MapCanvas id={id} opts={opts as MapOpts & { follow: boolean }} />,
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
  return <div className="cv"><canvas ref={cv} aria-label="G-G plot" /></div>;
}

export const gg = defineModule({
  type: "gg", title: "G-G", group: "Car", blurb: "Lateral against longitudinal G over the last seconds: the friction circle.",
  size: { w: 3, h: 7, minW: 3, minH: 5 }, needs: ["reading"], rate: 5,
  view: () => ({ info: `max lat ${recorder.gHist.maxLat.toFixed(2)} · long ${recorder.gHist.maxLon.toFixed(2)} g`, body: <GGCanvas /> }),
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
    return { info: [`${opts.window} s`, recorder.frozen ? "paused" : ""].filter(Boolean).join(" · "), body: <LiveCanvas rows={rows} win={win} /> };
  },
});

// ---------- traces ----------
function TraceCanvas({ rows, refLap, cmp, cursor, len }: { rows: string[]; refLap: ReturnType<typeof recorder.lapById>; cmp: ReturnType<typeof recorder.lapById>; cursor: number | null; len: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const p = usePrefs();
  const size = useSize(host);
  useEffect(() => {
    if (!cv.current || !refLap) return;
    drawTraces(cv.current, laneDefs(p.units), rows, refLap, cmp?.data ? cmp : null, cursor, len);
  });
  void size;
  return (
    <div className="cv" ref={host}>
      <canvas ref={cv} aria-label="Lap comparison traces" onPointerMove={(e) => { const b = cv.current!.getBoundingClientRect(); selection.setCursor((e.clientX - b.left) / b.width); }} onPointerLeave={() => selection.setCursor(null)} />
    </div>
  );
}

export const traces = defineModule({
  type: "traces", title: "Traces", group: "Analysis", blurb: "REF against CMP over the lap distance: Δ time, speed, pedals, steering, gear.",
  size: { w: 6, h: 22, minW: 4, minH: 10 }, needs: ["rec", "sel", "reading", "theme", "resize", "units"], rate: 20,
  options: [{ key: "lanes", label: "Lanes", type: "multi", choices: LANE_CHOICES, def: ["delta", "speed", "pedals", "steer", "gear"] }],
  view({ ctx: c, opts }) {
    const sel = useSelection();
    const p = usePrefs();
    const s = selState(sel);
    if ("msg" in s) return { state: { kind: "empty", msg: s.msg } };
    const defs = laneDefs(p.units), ids = (opts.lanes as string[]).filter((k) => defs[k]);
    if (!ids.length) return { state: { kind: "empty", msg: "No lanes chosen: pick some in the options." } };
    return {
      info: `REF ${lapName(s.ref)} ${fmtLap(s.ref.ms)}${s.cmp ? ` · CMP ${lapName(s.cmp)} ${fmtLap(s.cmp.ms)} · ${fmtDelta(s.cmp.ms - s.ref.ms)}` : ""}`,
      body: (
        <>
          <div className="tr-lg"><span className="lg"><i className="sw" style={{ ["--c" as string]: "var(--c-ref)" }} />REF solid</span><span className="lg"><i className="sw dash" style={{ ["--c" as string]: "var(--c-cmp)" }} />CMP dashed</span></div>
          <TraceCanvas rows={ids} refLap={s.ref} cmp={s.cmp} cursor={sel.cursor} len={c.r ? c.r.fixed.track_length_m : 0} />
        </>
      ),
    };
  },
});
