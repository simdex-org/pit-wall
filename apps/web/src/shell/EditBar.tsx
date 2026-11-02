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
      <b className="eb-title"><Icon name="pencil" />Editing</b>
      <span className="eb-tpl">{tpl.name} /</span>
      <input type="text" id="ebName" className="eb-in" maxLength={20} aria-label="Workspace name" title="Rename this workspace" value={name} onChange={(e) => setName(e.target.value)}
        onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; editor.rename(name); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      <button type="button" className="btn primary eb-add" onClick={() => editor.setDrawer(!ed.drawer)}><Icon name="plus" />Add module</button>
      <span className="note eb-hint">Drag a header to move, the corner to resize. Tab selects a module; arrows move it, Shift+arrows resize.</span>
      <span className="sp" />
      <button type="button" className="btn icon" disabled={!ed.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo" onClick={() => editor.step("undo")}><Icon name="undo-2" /></button>
      <button type="button" className="btn icon" disabled={!ed.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo" onClick={() => editor.step("redo")}><Icon name="redo-2" /></button>
      <button type="button" className="btn gh" title="Put this workspace back as it was in the built-in template" onClick={() => void editor.resetWs()}>Reset</button>
      <span className="eb-sep" />
      <button type="button" className="btn gh" onClick={() => void editor.leave()}>Discard</button>
      <button type="button" className="btn primary" title="Save (Ctrl+S)" onClick={() => void editor.save()}>Save</button>
    </div>
  );
}

const GROUP_ORDER = ["Timing", "Strategy", "Pit", "Car", "Laps", "Analysis", "Log"];

/** The module catalogue: a dialog with the groups at the left, a search and the modules at the right. */
export function Drawer() {
  const ed = useEditor();
  const { wsId, tpl } = useNav();
  const [q, setQ] = useState("");
  const [grp, setGrp] = useState("ALL");
  if (!ed.active || !ed.drawer) return null;
  const ws = tpl.workspaces.find((w) => w.id === wsId) ?? tpl.workspaces[0]!;
  const needle = q.trim().toLowerCase();
  const all = [...registry.values()];
  const names = [...new Set(all.map((d) => d!.group))].sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
  const ord = (g: string) => GROUP_ORDER.indexOf(g) + 1 || 99;
  const list = all.filter((d) => (grp === "ALL" || d!.group === grp) && (!needle || `${d!.title} ${d!.blurb} ${d!.group} ${d!.type}`.toLowerCase().includes(needle))).sort((a, b) => ord(a!.group) - ord(b!.group));
  return (
    <div id="drawer" role="dialog" aria-label="Add a module" onMouseDown={(e) => { if (e.target === e.currentTarget) editor.setDrawer(false); }}>
      <div className="cat">
        <header className="dlg-h"><h2>ADD A MODULE</h2><span className="note">to {ws.name}</span><span className="sp" /><button type="button" className="btn icon" aria-label="Close" onClick={() => editor.setDrawer(false)}><Icon name="x" /></button></header>
        <div className="cat-b">
          <nav className="cat-n" aria-label="Groups">
            {["ALL", ...names].map((g) => (
              <button type="button" key={g} aria-current={grp === g} onClick={() => setGrp(g)}>{g.toUpperCase()}<span className="n">{g === "ALL" ? all.length : all.filter((d) => d!.group === g).length}</span></button>
            ))}
          </nav>
          <div className="cat-r">
            <input type="search" id="drQ" className="inp w" placeholder="Search modules" aria-label="Search modules" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
            <div id="drList" className="dr-grid">
              {list.length ? list.map((d) => {
                const n = ws.modules.filter((m) => m.type === d!.type).length, off = d!.multi === false && n > 0;
                return (
                  <button type="button" className="dr-card" key={d!.type} disabled={off} onClick={() => editor.add(d!.type)}>
                    <span className="dr-top"><b>{d!.title}</b><span className="dr-size">{d!.size.w}×{d!.size.h}</span></span>
                    <span className="note">{d!.blurb}</span>
                    <span className="dr-foot"><span className="tag n">{d!.group.toUpperCase()}</span><span className="dr-go">{off ? "In this workspace" : n ? `Add another (${n} here)` : "+ Add"}</span></span>
                  </button>
                );
              }) : <p className="empty">No module matches.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
