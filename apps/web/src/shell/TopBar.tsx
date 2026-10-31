import { useRef } from "react";
import { useLink } from "../feed/connection";
import { useFeed } from "../feed/useFeed";
import { fmtClock, NONE, plural } from "../lib/format";
import { Icon } from "../lib/icons";
import { useAlerts } from "../state/alerts";
import { editor, useEditor } from "../state/editor";
import { nav, useNav } from "../state/nav";
import { ui } from "../state/ui";
import { toggleEdit } from "./useShortcuts";
import { isBuiltin, templates } from "../state/templates";
import { registry } from "../engine/registry";

// Which advice concerns which modules, so a tab can badge the lines that are about its own workspace.
const ADVICE_MODULES: Record<string, string[]> = {
  press_front: ["tyres", "press-fix"], press_rear: ["tyres", "press-fix"], tyres_cold: ["tyres"], brakes_hot: ["brakes", "tyres"], pads_low: ["brakes"],
  fuel_box: ["race-plan", "fuel", "fuel-calc"], fuel_low: ["race-plan", "fuel", "fuel-calc"], fuel_flag: ["race-plan", "fuel", "fuel-calc"],
  damage: ["damage"], rain_coming: ["weather"], window_closing: ["rules", "race-plan"], stint_limit: ["rules"], penalty: ["flags"],
};

function LinkChip() {
  const up = useLink();
  const c = useFeed();
  const age = c.ages.r;
  const [state, text] = !up ? ["off", "○ OFFLINE"] : c.live ? ["live", "■ LIVE"] : age != null && age < 600000 ? ["stale", `◐ STALE ${Math.round(age / 1000)} s`] : ["off", "○ OFFLINE"];
  return <span id="link" className={`chip ${state === "live" ? "s-ok" : state === "stale" ? "s-warn" : "s-dim"}`} role="status" data-state={state} title={text}>{text}</span>;
}

function Clock() {
  const c = useFeed();
  return <span id="clock" className="n" title="Session time left">{c.r ? fmtClock(c.r.session.session_time_left_ms) : NONE}</span>;
}

function Tabs() {
  const { tpl, wsId } = useNav();
  const c = useFeed();
  const alerts = useAlerts();
  const ed = useEditor();
  const advice: { id: string; severity: number }[] = c.s?.advice ?? [];

  const badge = (w: (typeof tpl.workspaces)[number]): [number, number] => {
    const types = new Set(w.modules.filter((m) => !m.hidden).map((m) => m.type));
    const ids = new Set<string>();
    let level = 0;
    for (const a of advice) {
      if (a.severity >= 1 && (ADVICE_MODULES[a.id] ?? []).some((t) => types.has(t))) { level = Math.max(level, a.severity); ids.add(a.id); }
    }
    if (w.id === wsId) for (const m of w.modules) level = Math.max(level, alerts.get(m.id)?.[0] ?? 0); // the open workspace's own modules may raise the level, never the number
    return [level, ids.size];
  };

  return (
    <nav id="tabs" role="tablist" aria-label="Workspaces">
      {tpl.workspaces.map((w, i) => {
        const [level, n] = badge(w);
        return (
          <span className="tabw" key={w.id}>
            <button type="button" role="tab" id={`tab-${w.id}`} aria-selected={w.id === wsId} tabIndex={w.id === wsId ? 0 : -1} title={`${w.name} (${i + 1})`}
              onClick={() => nav.showWorkspace(w.id)}
              onKeyDown={(e) => {
                const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                nav.stepWorkspace(d);
              }}>
              {w.name}
              <span className={`tab-alert ${level >= 2 ? "s-bad" : "s-warn"}`} hidden={!level} aria-label={n ? plural(n, "alert") : "a module reports a problem"}>{level ? (level >= 2 ? "■" : "▲") + (n || "") : ""}</span>
            </button>
            {ed.active ? <WsMenu wsId={w.id} count={tpl.workspaces.length} /> : null}
          </span>
        );
      })}
      {ed.active && tpl.workspaces.length < 9 ? <button type="button" className="tab-add" title="Add a workspace" aria-label="Add a workspace" onClick={() => editor.addWs()}><Icon name="plus" /></button> : null}
      <select className="tab-sel" id="tabSel" aria-label="Workspace" value={wsId} onChange={(e) => nav.showWorkspace(e.target.value)}>
        {tpl.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
    </nav>
  );
}

/** The workspace menu shown beside a tab in edit mode. */
function WsMenu({ wsId, count }: { wsId: string; count: number }) {
  const pop = useRef<HTMLDivElement>(null);
  const id = "wsMenu-" + wsId;
  const item = (act: "dup" | "left" | "right" | "del", label: string, off = false) => (
    <button type="button" role="menuitem" disabled={off} onClick={() => { pop.current?.hidePopover(); void editor.wsAction(act, wsId); }}>{label}</button>
  );
  return (
    <>
      <button type="button" className="btn icon tab-menu" popoverTarget={id} aria-haspopup="menu" aria-label="Workspace menu" title="Workspace menu">⋯</button>
      <div id={id} ref={pop} popover="auto" className="pop" role="menu" style={{ position: "fixed", inset: "auto", margin: 0 }}
        onToggle={(e) => {
          const p = e.currentTarget as HTMLElement;
          if ((e.nativeEvent as ToggleEvent).newState === "open") { const r = p.previousElementSibling!.getBoundingClientRect(); p.style.left = r.left + "px"; p.style.top = r.bottom + 4 + "px"; }
        }}>
        {item("dup", "Duplicate")}{item("left", "Move left")}{item("right", "Move right")}{item("del", "Delete", count < 2)}
      </div>
    </>
  );
}

function TemplateMenu() {
  const { tpl } = useNav();
  const pop = useRef<HTMLDivElement>(null);
  const row = (t: (typeof tpl)) => (
    <button key={t.id} type="button" role="menuitemradio" aria-checked={t.id === tpl.id}
      onClick={() => { pop.current?.hidePopover(); void editor.leave().then((ok) => { if (ok) nav.useTemplate(t.id); }); }}>
      {isBuiltin(t.id) ? <Icon name="lock" /> : <span className="ico-gap" />}
      <span>{t.name}</span>
      <span className="note">{t.workspaces.length} ws</span>
    </button>
  );
  return (
    <>
      <button type="button" id="tplBtn" popoverTarget="tplPop" aria-haspopup="menu" title={`Template: ${tpl.name}`}><span id="tplName">{tpl.name}</span><Icon name="chevron-down" /></button>
      <div id="tplPop" ref={pop} popover="auto" className="pop" role="menu" aria-label="Templates">
        <div className="pop-h">Built-in</div>
        {templates.builtins.map(row)}
        {templates.items.length > 0 && <><div className="pop-h">Yours</div>{templates.items.map(row)}</>}
        <button type="button" role="menuitem" onClick={() => { pop.current?.hidePopover(); ui.openTemplates(); }}><span className="ico-gap" /><span>Manage templates…</span></button>
      </div>
    </>
  );
}

export function TopBar({ onKeys }: { onKeys: () => void }) {
  const ed = useEditor();
  return (
    <header id="top">
      <span className="wordmark">PIT WALL</span>
      <TemplateMenu />
      <Tabs />
      <span className="top-gap" style={{ flex: 1 }} />
      <Clock />
      <LinkChip />
      <button type="button" className="btn icon" id="btnEdit" title="Edit this workspace (E)" aria-label="Edit this workspace" aria-pressed={ed.active} onClick={toggleEdit}><Icon name="layout-dashboard" /></button>
      <button type="button" className="btn icon" id="btnSettings" title="Settings (,)" aria-label="Settings" onClick={() => ui.openSettings()}><Icon name="settings" /></button>
      <button type="button" className="btn icon" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={onKeys}><Icon name="keyboard" /></button>
    </header>
  );
}
