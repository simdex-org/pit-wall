import { ReactNode, useEffect, useRef, useState } from "react";
import { fitCanvas, tokens } from "../draw/canvas";
import { car3dView, CarView, levelColour, VIEWS } from "../draw/car3d";
import { defineModule } from "../engine/registry";
import type { Ctx } from "../feed/store";
import { clamp, nf } from "../lib/format";
import { Icon } from "../lib/icons";
import { editor } from "../state/editor";
import { registry } from "../engine/registry";
import { sanitizeOptions } from "../state/templates";
import { bodyState, stateLevel, suspState } from "../lib/states";
import { CORNERS } from "../state/plan";
import { ZONES } from "./car";

const C3_VIEWS: [string, string][] = [["iso", "3D"], ["top", "Top"], ["front", "Front"], ["rear", "Rear"], ["left", "Left"], ["right", "Right"]];
const PARTS = ["front", "rear", "left", "right", "centre"];

interface Model { lv: Record<string, number | null>; tags: [string, string][]; low: number; br: number; sr: number; labels: boolean }

function model(c: Ctx, opts: Record<string, unknown>): Model {
  const a = c.r!.car, dmg = (a.damage as number[] | undefined) ?? [], sus = (a.suspension_damage as number[] | undefined) ?? [], pads = (a.brake_pad_mm as number[] | undefined) ?? [], low = c.th.pad_low_mm;
  const br = +(opts.bodyRed as string) || 100, sr = +(opts.susRed as string) || 0.3, num = (v: unknown): v is number => typeof v === "number" && isFinite(v);
  const lv: Model["lv"] = {}, tags: Model["tags"] = [];
  PARTS.forEach((z, i) => { lv[z] = num(dmg[i]) ? dmg[i]! / br : null; tags.push([z, `${ZONES[i]!.toUpperCase()} ${num(dmg[i]) ? nf(dmg[i], 1) : "–"}`]); });
  CORNERS.forEach((k, i) => {
    lv["s" + i] = num(sus[i]) ? sus[i]! / sr : null;
    lv["b" + i] = pads[i]! > 0 ? (low + 6 - pads[i]!) / 6 : null; // green 6 mm above the pads-low line, red on it
    tags.push(["s" + i, `${k} susp ${num(sus[i]) ? nf(sus[i], 2) : "–"} · pads ${pads[i]! > 0 ? nf(pads[i], 1) : "–"} mm`]);
  });
  return { lv, tags, low, br, sr, labels: !!opts.labels };
}

function Key({ m }: { m: Model }) {
  const tk = tokens();
  const sw = (t: number) => <i style={{ background: `rgb(${levelColour(t, tk).map(Math.round).join(",")})` }} />;
  const rows: [string, string[]][] = [
    ["Bodywork", [0, m.br / 4, m.br / 2, m.br * 0.75, m.br].map((v) => nf(v, 0))],
    ["Suspension", [0, m.sr / 4, m.sr / 2, m.sr * 0.75, m.sr].map((v) => nf(v, 2))],
    ["Pads mm", [m.low + 6, m.low + 4.5, m.low + 3, m.low + 1.5, m.low].map((v) => nf(v, 1))],
  ];
  return (
    <div className="c3-key">
      {rows.map(([t, vs]) => <span className="c3-row" key={t}><b>{t}</b>{vs.map((v, i) => <span key={i}>{sw(i / 4)}{v}</span>)}</span>)}
      <span className="c3-row"><b>Grey</b><span>no data from ACC</span></span>
    </div>
  );
}

function Car3D({ m, onFail }: { m: Model; onFail: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const tagCv = useRef<HTMLCanvasElement>(null);
  const gl = useRef<CarView | null>(null);
  const view = useRef({ az: VIEWS.iso![0], el: VIEWS.iso![1], x: false, zoom: 1 });
  const model_ = useRef(m);
  model_.current = m;
  const [xray, setXray] = useState(false);

  const draw = () => {
    const g3 = gl.current, cv = tagCv.current, mm = model_.current;
    if (!g3 || !cv) return;
    const at = g3.draw(view.current, mm.lv), [g, w] = fitCanvas(cv), tk = tokens();
    if (!mm.labels) return;
    g.font = `600 11px ${tk.num}`; g.textBaseline = "middle";
    const taken: number[][] = [];
    for (const [part, text] of mm.tags) { // the figure next to its part; parts on the far side of the car keep quiet
      const a = at[part];
      if (!a || !a[2]) continue;
      let y = a[1];
      const lv = mm.lv[part], tw = g.measureText(text).width, bx = Math.max(2, Math.min(w - tw - 12, a[0] - tw / 2 - 5));
      for (let k = 0; k < 6 && taken.some(([ta, tb, tc]) => bx < ta! + tc! && ta! < bx + tw + 10 && Math.abs(tb! - y) < 19); k++) y += 20; // under a label already placed
      taken.push([bx, y, tw + 10]);
      g.globalAlpha = 0.88; g.fillStyle = tk.bg; g.fillRect(bx, y - 9, tw + 10, 18); g.globalAlpha = 1;
      g.strokeStyle = lv == null ? tk.line : `rgb(${levelColour(lv, tk).map(Math.round).join(",")})`; g.lineWidth = 1; g.strokeRect(bx + 0.5, y - 8.5, tw + 9, 17);
      g.fillStyle = tk.text; g.fillText(text, bx + 5, y);
    }
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    let dead = false;
    car3dView(host.current!).then((v) => { if (dead) { v.dispose(); return; } gl.current = v; drawRef.current(); }).catch((e) => { console.error(e); onFail(); });
    return () => { dead = true; gl.current?.dispose(); gl.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { view.current.x = xray; draw(); });

  useEffect(() => { // not passive: React's onWheel cannot stop the page from scrolling
    const el = host.current!, onWheel = (e: WheelEvent) => { e.preventDefault(); view.current.zoom = clamp(view.current.zoom * Math.exp(e.deltaY * 0.001), 0.4, 1.5); drawRef.current(); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const turn = (to: string) => { // ease the camera to a view, the short way round
    const v = view.current, [az1, el1] = VIEWS[to]!, az0 = v.az, el0 = v.el, daz = Math.atan2(Math.sin(az1 - az0), Math.cos(az1 - az0)), t0 = performance.now();
    const step = (now: number) => { const k = Math.min(1, (now - t0) / 350), e = k * (2 - k); v.az = az0 + daz * e; v.el = el0 + (el1 - el0) * e; drawRef.current(); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  const drag = useRef<number[] | null>(null);

  return (
    <>
      <div className="c3-bar">
        {C3_VIEWS.map(([k, t]) => <button key={k} className="btn" onClick={() => turn(k)}>{t}</button>)}
        <button className="btn" aria-pressed={xray} title="See the suspension and steering through the bodywork" onClick={() => setXray((x) => !x)}>See-through</button>
      </div>
      <div className="cv c3" ref={host} role="img" aria-label="Car damage in 3D: drag to turn the car"
        onPointerDown={(e) => { drag.current = [e.clientX, e.clientY, view.current.az, view.current.el]; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { const d = drag.current; if (!d) return; view.current.az = d[2]! - (e.clientX - d[0]!) * 0.01; view.current.el = clamp(d[3]! + (e.clientY - d[1]!) * 0.01, -0.15, 1.5707); draw(); }}
        onPointerUp={() => { drag.current = null; }}>
        <canvas className="c3-tags" ref={tagCv} />
      </div>
    </>
  );
}

/** The parts as a table: what ACC reports, with a word for the state. */
function Parts({ c, m, rows }: { c: Ctx; m: Model; rows: number }) {
  const a = c.r!.car, dmg = (a.damage as number[] | undefined) ?? [], sus = (a.suspension_damage as number[] | undefined) ?? [], pads = (a.brake_pad_mm as number[] | undefined) ?? [];
  const body = (i: number, name: string): [string, number, string, string, string] => { const v = dmg[i] ?? 0, s = bodyState(v, m.br); return [name, v, nf(v, 0), s === "ok" ? "Ok" : s === "warn" ? "Damaged" : "Heavy", s === "ok" ? "dn" : s === "warn" ? "wn" : "up"]; };
  const list = [body(0, "Front"), body(3, "Right"), body(2, "Left"), body(1, "Rear"), body(4, "Roof")];
  list.sort((x, y) => y[1] - x[1]);
  const si = sus.reduce((b, v, i) => (v > (sus[b] ?? 0) ? i : b), 0), sv = sus[si] ?? 0;
  const pi = pads.reduce((b, v, i) => (v > 0 && v < (pads[b] || Infinity) ? i : b), 0), pv = pads[pi] ?? 0;
  const extra: [string, number, string, string, string][] = [
    [`Susp. ${CORNERS[si]}`, sv, nf(sv, 2), suspState(sv, m.sr) === "ok" ? "Ok" : suspState(sv, m.sr) === "warn" ? "Worn" : "Failed", suspState(sv, m.sr) === "ok" ? "dn" : suspState(sv, m.sr) === "warn" ? "wn" : "up"],
    [`Pad ${CORNERS[pi]} (mm)`, pv, nf(pv, 1), pv > m.low + 1.5 ? "Ok" : pv > m.low ? "Low" : "Replace", pv > m.low + 1.5 ? "dn" : pv > m.low ? "wn" : "up"],
  ];
  const all = list.concat(extra).slice(0, Math.max(3, rows));
  return (
    <div style={{ width: rows > 6 ? 270 : 300, flex: "none", borderLeft: "1px solid var(--ln)", display: "flex", flexDirection: "column", overflow: "auto" }}>
      <table className="t">
        <thead><tr><th className="l">Part</th><th>Value</th><th className="l">State</th></tr></thead>
        <tbody>{all.map(([n, , v, st, cls]) => <tr key={n}><td className="l">{n}</td><td>{v}</td><td className={"l " + cls}>{cls === "dn" ? "● " : "▲ "}{st}</td></tr>)}</tbody>
      </table>
      {rows > 6 ? <div className="f v di" style={{ padding: 12, gap: 10 }}><span className="lab">Scale</span><div style={{ flex: 1, height: 6, background: "linear-gradient(90deg,var(--ok),var(--warn),var(--bad))" }} /><span>0 → {m.br}</span></div> : null}
    </div>
  );
}

function Wrapper({ c, opts, rows, parts }: { c: Ctx; opts: Record<string, unknown>; rows: number; parts: boolean }): ReactNode {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="note">This view needs WebGL, which this browser has turned off or does not have.</p>;
  const m = model(c, opts);
  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "var(--pad)" }} title="ACC reports bodywork damage in five zones, suspension damage per corner and brake pad thickness; the glass, steering, engine, wing on its own and tyre wear stay grey.">
        <Car3D m={m} onFail={() => setFailed(true)} />
      </div>
      {parts ? <Parts c={c} m={m} rows={rows} /> : null}
    </div>
  );
}

export const car3d = defineModule({
  type: "car-3d", title: "Car damage 3D", group: "Car", blurb: "A GT3 painted green to red by ACC's damage: five body zones, suspension per corner and brake pads. Drag to turn it.",
  size: { w: 8, h: 14, minW: 4, minH: 8 }, needs: ["reading", "config", "theme", "resize"], requires: ["reading"], rate: 10,
  options: [
    { key: "bodyRed", label: "Bodywork is red at", type: "select", choices: [["50", "50"], ["100", "100"], ["200", "200"]], def: "100" },
    { key: "susRed", label: "Suspension is red at", type: "select", choices: [["0.1", "0.10"], ["0.3", "0.30"], ["1", "1.00"]], def: "0.3" },
    { key: "labels", label: "Show the figures on the car", type: "toggle", def: true },
    { key: "parts", label: "Show the parts table on the right", type: "toggle", def: true },
  ],
  view({ ctx: c, opts, id, size }) {
    const a = c.r!.car, dmg = (a.damage as number[] | undefined) ?? [], sus = (a.suspension_damage as number[] | undefined) ?? [];
    const m = model(c, opts);
    const level = Math.max(0, ...dmg.slice(0, 5).map((v) => stateLevel(bodyState(v, m.br))), ...sus.map((v) => stateLevel(suspState(v, m.sr))));
    return {
      flush: true,
      info: [`BODY RED AT ${m.br}`, `SUSPENSION RED AT ${nf(m.sr, 2)}`, level > 0 ? "DAMAGED" : "NO DAMAGE"],
      quick: <button type="button" className="btn icon" title="Parts table" aria-label="Parts table" aria-pressed={opts.parts !== false} onClick={() => editor.setOpt((m) => { m.options = sanitizeOptions(registry.get(m.type)!, { ...m.options, parts: opts.parts === false }, () => {}); }, id)}><Icon name="panel-right" /></button>,
      alert: [level],
      body: <Wrapper c={c} opts={opts} rows={Math.floor(((size.h * 28) - 26 - 22) / 21)} parts={opts.parts !== false} />,
    };
  },
});
