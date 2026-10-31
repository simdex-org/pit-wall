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
      <b className="eb-title">EDITING</b>
      <span className="eb-tpl">{tpl.name} · </span>
      <input type="text" id="ebName" className="eb-in" maxLength={20} aria-label="Workspace name" value={name} onChange={(e) => setName(e.target.value)}
        onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; editor.rename(name); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      <span className="sp" />
      <span className="note eb-hint">Drag a header to move, the corner to resize. Tab selects a module; arrows move it, Shift+arrows resize.</span>
      <button type="button" className="btn sm gh" disabled={!ed.canUndo} title="Undo (Ctrl+Z)" onClick={() => editor.step("undo")}>Undo</button>
      <button type="button" className="btn sm gh" disabled={!ed.canRedo} title="Redo (Ctrl+Y)" onClick={() => editor.step("redo")}>Redo</button>
      <button type="button" className="btn sm" onClick={() => editor.setDrawer(!ed.drawer)}>+ Add module</button>
      <button type="button" className="btn sm gh" onClick={() => void editor.resetWs()}>Reset</button>
      <button type="button" className="btn sm gh" onClick={() => void editor.leave()}>Discard</button>
      <button type="button" className="btn sm primary" title="Save (Ctrl+S)" onClick={() => void editor.save()}>Save</button>
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
  const here = new Set(ws.modules.map((m) => m.type));
  const needle = q.trim().toLowerCase();
  const all = [...registry.values()];
  const names = [...new Set(all.map((d) => d!.group))].sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
  const ord = (g: string) => GROUP_ORDER.indexOf(g) + 1 || 99;
  const list = all.filter((d) => (grp === "ALL" || d!.group === grp) && (!needle || `${d!.title} ${d!.blurb} ${d!.group} ${d!.type}`.toLowerCase().includes(needle))).sort((a, b) => ord(a!.group) - ord(b!.group));
  return (
    <div id="drawer" role="dialog" aria-label="Add a module">
      <div className="cat">
        <header className="dlg-h"><h2>ADD A MODULE</h2><button type="button" className="btn icon" aria-label="Close" onClick={() => editor.setDrawer(false)}><Icon name="x" /></button></header>
        <div className="cat-b">
          <nav className="cat-n" aria-label="Groups">
            {["ALL", ...names].map((g) => (
              <button type="button" key={g} aria-current={grp === g} onClick={() => setGrp(g)}>{g.toUpperCase()} {g === "ALL" ? all.length : all.filter((d) => d!.group === g).length}</button>
            ))}
          </nav>
          <div className="cat-r">
            <input type="search" id="drQ" className="inp w" placeholder="Search modules" aria-label="Search modules" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
            <div id="drList" className="dr-list">
              {list.length ? list.map((d) => {
                const off = d!.multi === false && here.has(d!.type);
                return (
                  <div className="dr-item" key={d!.type}>
                    <div className="dr-t"><b>{d!.title}</b> <span className="tag n">{d!.group.toUpperCase()}</span><span className="note">{d!.blurb}</span></div>
                    <span className="v di dr-size">{d!.size.w}×{d!.size.h}</span>
                    <button type="button" className="btn sm" disabled={off} onClick={() => editor.add(d!.type)}>{off ? "Here" : "Add"}</button>
                  </div>
                );
              }) : <p className="empty">No module matches.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
