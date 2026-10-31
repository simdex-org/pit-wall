import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Ctx } from "../feed/store";
import { Icon } from "../lib/icons";
import { clearAlert, setAlert } from "../state/alerts";
import type { ModuleInstance } from "../state/templates";
import { registry } from "./registry";
import type { Channel, ModuleDef, ModuleView } from "./types";
import { useModuleCtx } from "./useModuleCtx";

const NA_MESSAGE: Partial<Record<Channel, string>> = {
  field: "Field timing needs ACC's broadcasting port. On the driver's PC turn on field timing in the Pit Wall window, then restart ACC.",
  reading: "Waiting for the driver.",
  summary: "Waiting for the bridge summary.",
  pit: "No pit control on this bridge.",
};

/** The `requires` channels: a missing one shows the module's unavailable state instead of its body. */
function gate(def: ModuleDef, c: Ctx): string | null {
  for (const r of def.requires) {
    const missing = r === "field" ? !(c.bc?.state === "live" && c.field) : r === "reading" ? !c.r : r === "summary" ? !c.s : r === "pit" ? !c.pit : false;
    if (!missing) continue;
    if (r === "field" && c.bc?.state === "off" && c.bc.msg) return c.bc.msg; // off on purpose or by setup: the bridge's own words say what to do
    return (NA_MESSAGE[r] ?? `Needs ${r}.`) + (r === "field" && c.bc?.msg ? " " + c.bc.msg : "");
  }
  return null;
}

const STALE: Partial<Record<Channel, [keyof Ctx["ages"], number]>> = { reading: ["r", 1500], summary: ["s", 3000], field: ["field", 2000] };

function staleness(def: ModuleDef, c: Ctx): number {
  let worst = 0;
  for (const n of def.needs) {
    const s = STALE[n];
    if (!s) continue;
    const age = c.ages[s[0]];
    if (age != null && age > s[1]) worst = Math.max(worst, age);
  }
  return worst;
}

const EMPTY: ModuleView = {};

/** Edit mode: move, options, duplicate, hide, remove. */
function EditButtons({ inst }: { inst: ModuleInstance }) {
  const b = (act: string, label: string, icon: string, hint?: string) => (
    <button type="button" className="btn icon" data-act={act} title={hint ?? label} aria-label={label}><Icon name={icon} /></button>
  );
  return (
    <span className="medit">
      {b("drag", "Move", "grip-vertical", "Drag to move (arrows)")}{b("opts", "Options", "sliders-horizontal", "Options (O)")}{b("dup", "Duplicate", "copy", "Duplicate (D)")}
      {b("hide", inst.hidden ? "Show" : "Hide", inst.hidden ? "eye" : "eye-off", `${inst.hidden ? "Show" : "Hide"} (H)`)}{b("remove", "Remove", "x", "Remove (Delete)")}
    </span>
  );
}

interface Placed { style?: CSSProperties; auto?: boolean; edit?: { sel: boolean } }

function Frame({ inst, def, ctx, view, na, style, auto, edit }: { inst: ModuleInstance; def: ModuleDef | undefined; ctx: Ctx; view: ModuleView; na: string | null } & Placed) {
  const section = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ y: false, x: false });

  useEffect(() => {
    const [level, count] = view.alert ?? [0, 0];
    setAlert(inst.id, level, count ?? (level ? 1 : 0));
  }, [inst.id, view.alert?.[0], view.alert?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearAlert(inst.id), [inst.id]);

  // A body with more below or to the right says so: headless and overlay scrollbars hide it.
  useLayoutEffect(() => {
    const b = body.current;
    if (!b) return;
    const measure = () => setMore((m) => {
      const y = !b.hidden && b.scrollTop + b.clientHeight < b.scrollHeight - 1;
      const x = !b.hidden && b.scrollLeft + b.clientWidth < b.scrollWidth - 1;
      return m.y === y && m.x === x ? m : { y, x };
    });
    measure();
    b.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    return () => { b.removeEventListener("scroll", measure); ro.disconnect(); };
  });

  const title = inst.title || def?.title || inst.type;
  const state = na ? { kind: "na" as const, msg: na } : view.state;
  const stale = def ? staleness(def, ctx) : 0;
  const [level] = view.alert ?? [0];
  const cls = ["mod", auto && "auto-h", inst.hidden && "is-hidden", inst.header === false && "no-header", stale > 0 && "stale", edit?.sel && "sel", more.y && "more", more.x && "more-x"].filter(Boolean).join(" ");

  return (
    <section ref={section} id={inst.id} className={cls} data-type={inst.type} data-state={state ? state.kind : "ok"} data-alert={level >= 2 ? "bad" : level ? "warn" : undefined}
      tabIndex={-1} aria-labelledby={`${inst.id}-t`} hidden={inst.hidden} style={style}
      onKeyDown={view.onKey ? (e) => { if (e.target === e.currentTarget || !(e.target as HTMLElement).closest("input,textarea,select")) if (view.onKey!(e)) { e.preventDefault(); e.stopPropagation(); } } : undefined}>
      <header className="mh">
        <h2 className="mt" id={`${inst.id}-t`}>{title}</h2>
        <span className="mi">{view.info ?? ""}</span>
        <span className="mtag" hidden={!stale}>{stale ? `◐ STALE ${Math.round(stale / 1000)} s` : ""}</span>
        <span className={`malert ${level >= 2 ? "s-bad" : "s-warn"}`} hidden={!level}>{level >= 2 ? "■ CRIT" : "▲ WARN"}</span>
        {edit ? <EditButtons inst={inst} /> : null}
        <span className="mtools">
          {def?.tools.map((t) => (
            <button key={t.id} type="button" className="btn icon" title={t.label} aria-label={t.label} onClick={() => def.tool?.(t.id, { ctx, opts: inst.options, id: inst.id })}>
              <Icon name={t.icon} />
            </button>
          ))}
        </span>
      </header>
      <div className="mb" ref={body} hidden={!!state}>{view.body}</div>
      {edit ? <span className="mgrip" data-act="resize" aria-hidden="true" /> : null}
      {state && (
        <div className="mstate">
          <Icon name={state.kind === "na" ? "unplug" : "inbox"} size={24} />
          <p>{state.msg}</p>
          {"action" in state && state.action && <button type="button" className="linkbtn" onClick={state.action.fn}>{state.action.label}</button>}
        </div>
      )}
    </section>
  );
}

/** One module instance: its throttled context, its view, and the frame around it. */
export function ModuleHost({ inst, style, auto, edit }: { inst: ModuleInstance } & Placed) {
  const def = registry.get(inst.type);
  if (!def) return <Missing inst={inst} style={style} auto={auto} edit={edit} />;
  return <Live inst={inst} def={def} style={style} auto={auto} edit={edit} />;
}

function Live({ inst, def, style, auto, edit }: { inst: ModuleInstance; def: ModuleDef } & Placed) {
  const ctx = useModuleCtx(def);
  const na = gate(def, ctx);
  return na ? <Frame inst={inst} def={def} ctx={ctx} view={EMPTY} na={na} style={style} auto={auto} edit={edit} /> : <Running inst={inst} def={def} ctx={ctx} style={style} auto={auto} edit={edit} />;
}

/** The view runs only while its required channels are present, so it never has to guard against their absence. */
function Running({ inst, def, ctx, style, auto, edit }: { inst: ModuleInstance; def: ModuleDef; ctx: Ctx } & Placed) {
  const view = def.view({ ctx, opts: inst.options, id: inst.id });
  return <Frame inst={inst} def={def} ctx={ctx} view={view} na={null} style={style} auto={auto} edit={edit} />;
}

function Missing({ inst, style, auto, edit }: { inst: ModuleInstance } & Placed) {
  const dummy = { ages: { r: null, s: null, field: null } } as unknown as Ctx;
  return <Frame inst={inst} def={undefined} ctx={dummy} view={EMPTY} na={`Module '${inst.type}' is not available in this version.`} style={style} auto={auto} edit={edit} />;
}
