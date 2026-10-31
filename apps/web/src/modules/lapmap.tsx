import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { defineModule } from "../engine/registry";
import { drawLapMap, inZone } from "../draw/lapmap";
import { findCorners, NB } from "../lib/coach/measure";
import { recorder } from "../state/recorder";
import { selection, useSelection } from "../state/selection";
import { lapName, selState } from "./lapsel";

const cornersNow = () => findCorners(recorder.laps.filter((l) => l.valid && l.data).map((l) => l.data!));

function LapMapCanvas() {
  const cv = useRef<HTMLCanvasElement>(null), hit = useRef<(x: number, y: number) => number | null>(() => null);
  const sel = useSelection();
  const s = selState(sel);
  const ref = "msg" in s ? null : s.ref, cmp = "msg" in s ? null : s.cmp;
  const draw = () => {
    if (!cv.current || !ref?.data) return;
    const line = recorder.lines.find((l) => l.n === ref.n) ?? recorder.lines[0];
    hit.current = drawLapMap(cv.current, { pts: line?.pts ?? [], ref: ref.data.speed, cmp: cmp?.data?.speed ?? null, corners: cornersNow(), corner: sel.corner, cursor: sel.cursor });
  };
  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (cv.current) ro.observe(cv.current);
    return () => ro.disconnect();
  });
  const click = (e: MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), f = hit.current(e.clientX - r.left, e.clientY - r.top);
    if (f == null) return;
    selection.setCursor(f);
    const j = Math.round(f * (NB - 1)), z = cornersNow().find((q) => inZone(q, j));
    selection.setCorner(z && z.n !== sel.corner ? z.n : null);
  };
  return <div className="cv"><canvas ref={cv} onClick={click} aria-label="The reference lap on the track" /></div>;
}

export const lapMap = defineModule({
  type: "lap-map", title: "Lap map", group: "Analysis", blurb: "The reference lap's line on the track, shaded by speed; with a comparison lap, green where the reference was faster. Click a corner to look at it.",
  size: { w: 5, h: 12, minW: 3, minH: 6 }, needs: ["rec", "sel"],
  view() {
    const s = selState(selection.get());
    if ("msg" in s) return { state: { kind: "empty", msg: s.msg } };
    return { info: `REF ${lapName(s.ref)}${s.cmp ? ` · CMP ${lapName(s.cmp)}` : ""}`, flush: true, body: <LapMapCanvas /> };
  },
});
