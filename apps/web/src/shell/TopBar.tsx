import { useRef } from "react";
import { useLink } from "../feed/connection";
import { feed, sessionLabel } from "../feed/store";
import { useFeed } from "../feed/useFeed";
import { fmtClock, NONE, plural } from "../lib/format";
import { Icon } from "../lib/icons";
import { editor, useEditor } from "../state/editor";
import { nav, useNav } from "../state/nav";
import { ui } from "../state/ui";
import { toggleEdit } from "./useShortcuts";
import { isBuiltin, templates } from "../state/templates";
import { registry } from "../engine/registry";

function LinkChip() {
  const up = useLink();
  const c = useFeed();
  const age = c.ages.r;
  const [state, text] = !up ? ["off", "Offline"] : c.live ? ["live", "Live"] : age != null && age < 600000 ? ["stale", `Stale ${Math.round(age / 1000)} s`] : ["off", "Offline"];
  return <span id="link" role="status" data-state={state} title={text}>{text}</span>;
}

function Clock() {
  const c = useFeed();
  return <span id="clock" className="n" title="Session time left">{c.r ? fmtClock(c.r.session.session_time_left_ms) : NONE}</span>;
}

/** Live, or one of the earlier sessions (practice, qualifying, race) kept by the bridge. Shown once there is an earlier one. */
function SessionPicker() {
  const c = useFeed();
  if (!c.past.length && !c.view) return null;
  const live = sessionLabel(c, "live");
  return (
    <select id="sessionSel" aria-label="Session shown" title="Session shown" data-past={c.view ? "" : undefined} value={c.view?.id ?? "live"}
      onChange={(e) => void feed.showSession(e.target.value === "live" ? null : Number(e.target.value))}>
      <option value="live">{`Live · ${live}`}</option>
      {c.past.slice().reverse().map((p) => <option key={p.id} value={p.id}>{`${sessionLabel(c, p.id)} · ${plural(p.laps.length, "lap")}`}</option>)}
    </select>
  );
}

function Tabs() {
  const { tpl, wsId } = useNav();
  const c = useFeed();
  const ed = useEditor();

  return (
    <nav id="tabs" role="tablist" aria-label="Workspaces">
      {tpl.workspaces.map((w, i) => {
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
        <hr />
        <button type="button" role="menuitem" className="pop-act" onClick={() => { pop.current?.hidePopover(); ui.openTemplates(); }}><Icon name="settings" /><span>Manage templates…</span></button>
      </div>
    </>
  );
}

/** The logo; five quick clicks open the Tests workspace. */
function Brand() {
  const n = useRef({ k: 0, t: 0 });
  const click = () => {
    const now = Date.now(), c = n.current;
    c.k = now - c.t < 800 ? c.k + 1 : 1;
    c.t = now;
    if (c.k >= 5) { c.k = 0; editor.openTests(); }
  };
  return (
    <span className="brand" onClick={click}>
      <svg className="logo" viewBox="3 8 58 58" role="img" aria-label="Pit Wall">
        <path d="M14 33A18 18 0 0 1 50 33" fill="none" stroke="currentColor" strokeWidth="5" />
        <rect x="7" y="31" width="13" height="19" rx="3" fill="currentColor" /><rect x="44" y="31" width="13" height="19" rx="3" fill="currentColor" />
        <path d="M21 42H26L29 34L33.5 50L37 39H43" fill="none" stroke="var(--acc)" strokeWidth="3" strokeLinejoin="round" />
        <path d="M13 50Q13 58 24 58" fill="none" stroke="currentColor" strokeWidth="3" /><circle cx="27" cy="58" r="3.5" fill="currentColor" />
      </svg>
      <span className="wordmark">Pit Wall</span>
    </span>
  );
}

export function TopBar({ onKeys }: { onKeys: () => void }) {
  const ed = useEditor();
  return (
    <header id="top">
      <Brand />
      <TemplateMenu />
      <Tabs />
      <span className="top-gap" style={{ flex: 1 }} />
      <SessionPicker />
      <Clock />
      <LinkChip />
      <button type="button" className="btn sm" id="btnEdit" title="Edit this workspace (E)" aria-pressed={ed.active} onClick={toggleEdit}>Edit</button>
      <button type="button" className="btn icon" id="btnSettings" title="Settings (,)" aria-label="Settings" onClick={() => ui.openSettings()}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2.5" /><circle cx="8" cy="8" r="5.2" /><path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1" /></svg>
      </button>
      <button type="button" className="btn icon" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={onKeys}><Icon name="keyboard" /></button>
    </header>
  );
}
