import { useEffect, useRef, useState } from "react";
import { registry } from "../engine/registry";
import { Icon } from "../lib/icons";
import { editor, useEditor } from "../state/editor";
import { useNav } from "../state/nav";

/** The strip under the top bar while editing: workspace name, add, undo and redo, reset, discard and save. */
export function EditBar() {
  const ed = useEditor();
  const { wsId, tpl } = useNav();
  const ws = tpl.workspaces.find((w) => w.id === wsId) ?? tpl.workspaces[0]!;
  const [name, setName] = useState(ws.name);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setName(ws.name); }, [ws.name, wsId]);
  if (!ed.active) return null;
  return (
    <div id="editBar" role="toolbar" aria-label="Edit layout">
      <b className="eb-title">Editing</b>
      <label className="eb-name">
        <span className="lbl">Workspace</span>
        <input type="text" id="ebName" maxLength={20} aria-label="Workspace name" value={name} onChange={(e) => setName(e.target.value)}
          onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; editor.rename(name); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      </label>
      <button type="button" className="btn" onClick={() => editor.setDrawer(!ed.drawer)}><Icon name="plus" />Module</button>
      <button type="button" className="btn" disabled={!ed.canUndo} title="Undo (Ctrl+Z)" onClick={() => editor.step("undo")}><Icon name="undo-2" />Undo</button>
      <button type="button" className="btn" disabled={!ed.canRedo} title="Redo (Ctrl+Y)" onClick={() => editor.step("redo")}><Icon name="redo-2" />Redo</button>
      <button type="button" className="btn" onClick={() => void editor.resetWs()}>Reset workspace</button>
      <span className="top-gap" style={{ flex: 1 }} />
      <span className="note eb-hint">Drag a header to move, the corner to resize. Tab selects a module; arrows move it, Shift+arrows resize.</span>
      <button type="button" className="btn" onClick={() => void editor.leave()}>Discard</button>
      <button type="button" className="btn primary" title="Save (Ctrl+S)" onClick={() => void editor.save()}>Save</button>
    </div>
  );
}

const GROUP_ORDER = ["Timing", "Strategy", "Pit", "Car", "Laps", "Analysis", "Log"];

/** The module catalogue, from the right. */
export function Drawer() {
  const ed = useEditor();
  const { wsId, tpl } = useNav();
  const [q, setQ] = useState("");
  if (!ed.active || !ed.drawer) return null;
  const ws = tpl.workspaces.find((w) => w.id === wsId) ?? tpl.workspaces[0]!;
  const here = new Set(ws.modules.map((m) => m.type));
  const groups = new Map<string, ReturnType<typeof registry.get>[]>();
  const needle = q.trim().toLowerCase();
  for (const def of registry.values()) {
    if (needle && !`${def.title} ${def.blurb} ${def.group} ${def.type}`.toLowerCase().includes(needle)) continue;
    groups.set(def.group, [...(groups.get(def.group) ?? []), def]);
  }
  const names = [...groups.keys()].sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
  return (
    <aside id="drawer" aria-label="Add a module">
      <header className="dlg-h"><h2>Add a module</h2><button type="button" className="btn icon" aria-label="Close" onClick={() => editor.setDrawer(false)}><Icon name="x" /></button></header>
      <input type="search" id="drQ" placeholder="Search modules" aria-label="Search modules" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
      <div id="drList" className="dr-list">
        {names.length ? names.map((g) => (
          <div key={g}>
            <h3 className="lbl">{g}</h3>
            {groups.get(g)!.map((d) => {
              const off = d!.multi === false && here.has(d!.type);
              return (
                <button type="button" className="dr-item" key={d!.type} disabled={off} onClick={() => editor.add(d!.type)}>
                  <b>{d!.title}</b><span className="note">{d!.blurb}</span><span className="n dr-size">{d!.size.w}×{d!.size.h}{off ? " · already here" : ""}</span>
                </button>
              );
            })}
          </div>
        )) : <p className="empty">No module matches.</p>}
      </div>
    </aside>
  );
}
