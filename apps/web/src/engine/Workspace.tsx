import { CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { clamp } from "../lib/format";
import { Icon } from "../lib/icons";
import { editor, useEditor } from "../state/editor";
import type { ModuleInstance, Workspace as WorkspaceData } from "../state/templates";
import { aux } from "./versions";
import { ModuleHost } from "./ModuleHost";
import { registry } from "./registry";

// Below this width the grid becomes one column of stacked modules.
const NARROW_PX = 1100;
// Narrow: tables take their own height, the others their rows' height (at most 16). Not tyres: its drawing fills the height.
const AUTO_HEIGHT = new Set(["pit-plan", "standings", "stop-options", "laps", "stops", "pit-log", "pit-activity", "tyre-history", "race-plan", "rejoin", "rules",
  "brakes", "weather", "damage", "electronics", "flags", "press-fix", "battle", "relative", "car-status"]);
const MIN_ROWS: Record<string, number> = { tyres: 11 };
// Narrow stacking order: what the engineer needs first on a phone; the rest is 10, in reading order.
const STACK_ORDER: Record<string, number> = { "race-plan": 1, relative: 2, "lap-timer": 2, tyres: 3, "press-fix": 4, rejoin: 5, "stop-options": 6, battle: 7, standings: 8, "fuel-calc": 9, "pit-plan": 20 };

const cssNumber = (name: string, fallback: number) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;

/** The 12-column module grid. The rows the layout uses share the window's height, never below one row. */
export function Workspace({ workspace }: { workspace: WorkspaceData }) {
  const host = useRef<HTMLElement>(null);
  const [geo, setGeo] = useState({ narrow: false, rowHeight: 28 });
  const ed = useEditor();
  const editing = ed.active && !geo.narrow;

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    let timer = 0;
    const measure = () => {
      const narrow = el.clientWidth > 0 && el.clientWidth < NARROW_PX;
      setGeo((g) => (g.narrow === narrow ? g : { ...g, narrow }));
      aux.bump("resize");
    };
    const ro = new ResizeObserver(() => { clearTimeout(timer); timer = window.setTimeout(measure, 100); });
    ro.observe(document.documentElement);
    measure();
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, []);

  const visible = workspace.modules.filter((m) => !m.hidden);
  const rows = Math.max(1, ...visible.map((m) => m.y + m.h));
  const rowPx = cssNumber("--row", 28);
  const style = { "--rows": rows, "--rh": rowPx + "px" } as CSSProperties;

  const ordered = workspace.modules.slice().sort((a, b) => a.y - b.y || a.x - b.x); // DOM order is reading order
  if (geo.narrow) ordered.sort((a, b) => (STACK_ORDER[a.type] ?? 10) - (STACK_ORDER[b.type] ?? 10) || a.y - b.y || a.x - b.x);

  return (
    <main id="ws" ref={host} className={`ws${geo.narrow ? " narrow" : ""}${editing ? " editing" : ""}`} data-ws={workspace.id} style={style}
      onClick={editing ? onEditClick : undefined} onPointerDown={editing ? onEditPointer : undefined}>
      {editing && !ordered.length ? (
        <div className="ws-empty">
          <p>This workspace is empty.</p>
          <button type="button" className="btn primary" onClick={() => editor.setDrawer(true)}><Icon name="plus" />Add a module</button>
        </div>
      ) : null}
      {ordered.map((m) => <ModuleHost key={m.id + m.type} inst={m} style={placement(m, geo.narrow, rowPx)} auto={geo.narrow && AUTO_HEIGHT.has(m.type)} edit={editing ? { sel: ed.sel === m.id } : undefined} />)}
    </main>
  );
}

/** Where a module sits: its grid cell, or in the narrow stack a height from its rows. */
function placement(m: ModuleInstance, narrow: boolean, rowPx: number): CSSProperties {
  if (!narrow) return { gridColumn: `${m.x + 1} / span ${m.w}`, gridRow: `${m.y + 1} / span ${m.h}` };
  if (AUTO_HEIGHT.has(m.type)) return {};
  return { height: Math.max(Math.min(m.h, 16), MIN_ROWS[m.type] ?? 0) * (rowPx + 8) - 8 };
}

/** Module buttons in edit mode, and selecting a module by clicking it. */
function onEditClick(e: React.MouseEvent): void {
  const target = e.target as HTMLElement;
  const mod = target.closest<HTMLElement>(".mod");
  if (!mod) return;
  const b = target.closest<HTMLElement>(".medit [data-act]");
  if (!b) {
    if (!target.closest("button, input, select, textarea, a")) editor.select(mod.id);
    return;
  }
  const id = mod.id;
  const acts: Record<string, () => void> = {
    opts: () => editor.openOptions(id), dup: () => editor.dup(id), hide: () => editor.hide(id), remove: () => editor.remove(id), drag: () => editor.select(id),
  };
  acts[b.dataset.act!]?.();
}

/** Move by the header, resize by the corner grip: snapped to cells, with a ghost showing the target. */
function onEditPointer(e: React.PointerEvent): void {
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  const grip = t.closest(".mgrip"), head = t.closest(".mh");
  if (!grip && (!head || (t.closest("button") && !t.closest("[data-act=drag]")))) return;
  const mod = t.closest<HTMLElement>(".mod"), m = mod && editor.find(mod.id);
  if (!mod || !m) return;
  e.preventDefault();
  editor.select(m.id);
  const host = document.getElementById("ws")!, cs = getComputedStyle(host), gx = parseFloat(cs.columnGap) || 8, gy = parseFloat(cs.rowGap) || 8;
  const mr = mod.getBoundingClientRect(), cw = (mr.width + gx) / m.w, rh = (mr.height + gy) / m.h; // rows stretch to the window, so measure the cell
  const g = document.createElement("div");
  g.className = "ghost";
  g.setAttribute("aria-hidden", "true");
  host.appendChild(g);
  const def = registry.get(m.type), s = def ? def.size : { minW: 1, minH: 1 }, x0 = e.clientX, y0 = e.clientY;
  let r = { x: m.x, y: m.y, w: m.w, h: m.h }, bad = false;
  const show = () => {
    bad = !editor.canMove(m.id, r.x, r.y, r.w, r.h);
    g.classList.toggle("bad", bad);
    g.textContent = bad ? "occupied" : `${r.w}×${r.h}`;
    g.style.gridColumn = `${r.x + 1} / span ${r.w}`;
    g.style.gridRow = `${r.y + 1} / span ${r.h}`;
  };
  show();
  const move = (ev: PointerEvent) => {
    const dx = Math.round((ev.clientX - x0) / cw), dy = Math.round((ev.clientY - y0) / rh);
    r = grip
      ? { x: m.x, y: m.y, w: clamp(m.w + dx, s.minW, Math.min(12 - m.x, (s as { maxW?: number }).maxW ?? 12)), h: clamp(m.h + dy, s.minH, (s as { maxH?: number }).maxH ?? 60) }
      : { x: clamp(m.x + dx, 0, 12 - m.w), y: clamp(m.y + dy, 0, 199), w: m.w, h: m.h };
    show();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    g.remove();
    if (!bad) editor.move(m.id, r.x, r.y, r.w, r.h);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}
