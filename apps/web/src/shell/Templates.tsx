import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "../lib/icons";
import { download } from "../lib/files";
import { cleanText, deep, isObj, newId, slug } from "../lib/text";
import { accessKey, say } from "../state/bridge";
import { appearance, unreadable } from "../state/appearance";
import { editor } from "../state/editor";
import { nav, useNav } from "../state/nav";
import { isBuiltin, SCHEMA, sanitize, Template, templates } from "../state/templates";
import { ui, useUi } from "../state/ui";
import { ask } from "./confirm";

const date = (s: string) => { const t = Date.parse(s); return isNaN(t) ? "" : new Date(t).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }); };

// A change in the template list has no store of its own, so the dialog keeps a counter.
let version = 0;
const subs = new Set<() => void>();
const bump = () => { version++; subs.forEach((fn) => fn()); };
const useVersion = () => useSyncExternalStore((fn) => { subs.add(fn); return () => { subs.delete(fn); }; }, () => version);

function exportTemplate(t: Template, withAppearance: boolean): string {
  const o: Record<string, unknown> = { format: "pitwall-template", schemaVersion: SCHEMA, id: t.id, name: t.name };
  if (t.basedOn) o.basedOn = t.basedOn;
  o.created = t.created; o.updated = t.updated; o.workspaces = deep(t.workspaces);
  if (withAppearance) o.appearance = appearance.pack(appearance.cur);
  const text = JSON.stringify(o, null, 1), key = accessKey.value;
  // The key as a whole JSON string (a template name or text field equal to it), or anywhere when it is long enough not to be a word.
  if (key && (text.includes(JSON.stringify(key)) || (key.length >= 12 && text.includes(key)))) return "Export blocked: it would contain the access key";
  download(`${slug(t.name)}.pitwall.json`, text);
  return `Exported '${t.name}'.`;
}

async function importTemplate(file: File): Promise<string> {
  if (file.size > 512 * 1024) return "File too large";
  let raw: unknown;
  try { raw = JSON.parse(await file.text()); } catch { return "Not a valid JSON file."; }
  if (!isObj(raw) || raw.format !== "pitwall-template") return "Not a Pit Wall template file.";
  if (!Number.isInteger(raw.schemaVersion) || (raw.schemaVersion as number) < 0) return "This template has no valid schema version.";
  if ((raw.schemaVersion as number) > SCHEMA) return "This template was made by a newer Pit Wall.";
  if ((raw.schemaVersion as number) < SCHEMA) return `Cannot read schema version ${raw.schemaVersion}.`;
  let res;
  try { res = sanitize(raw, { keepAppearance: true }); } catch { return "Not a Pit Wall template file."; }
  const t = res.t, ap = t.appearance;
  delete t.appearance;
  if (!(await editor.leave())) return ""; // before the appearance question: 'Keep editing' must leave nothing adopted
  t.id = newId("t-");
  t.name = templates.uniqueName(t.name);
  t.created = t.updated = new Date().toISOString();
  let apWhy = "";
  if (ap && (await ask("This template carries an appearance. Apply it?", [["apply", "Apply", true], ["", "Keep mine"]])) === "apply") {
    const a = appearance.adopt(ap);
    apWhy = a ? unreadable(a).replace(/,? so it was not applied\.?/, ".") : "";
  }
  templates.save(t);
  nav.useTemplate(t.id);
  const nm = t.workspaces.reduce((a, w) => a + w.modules.length, 0), nd = res.dropped.length;
  return `Imported '${t.name}': ${t.workspaces.length} workspace${t.workspaces.length === 1 ? "" : "s"}, ${nm} module${nm === 1 ? "" : "s"}${nd ? `, ${nd} unknown module${nd === 1 ? "" : "s"} dropped` : ""}${res.fixed ? `, ${res.fixed} value${res.fixed === 1 ? "" : "s"} corrected` : ""}${apWhy ? `. Its appearance was kept but not applied: ${apWhy}` : "."}`;
}

function Row({ t, curId, renaming, setRenaming, act, rename }: {
  t: Template; curId: string; renaming: string | null; setRenaming: (id: string | null) => void; act: (a: string, t: Template) => void; rename: (id: string, name: string) => void;
}) {
  const bi = isBuiltin(t.id), isCur = t.id === curId;
  const [name, setName] = useState(t.name);
  return (
    <tr className={isCur ? "focus" : undefined} aria-selected={isCur || undefined}>
      <td className="tm-name">
        {renaming === t.id
          ? <input type="text" className="tm-ren" maxLength={40} value={name} aria-label="New name" autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)}
              onBlur={() => rename(t.id, name)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); rename(t.id, name); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setRenaming(null); } }} />
          : <b>{t.name}</b>}
        {bi ? <span className="note"> <Icon name="lock" /> built-in</span> : null}{isCur ? <> <b className="tag">ACTIVE</b></> : null}
      </td>
      <td className="n">{t.workspaces.length}</td><td className="n">{t.workspaces.reduce((a, w) => a + w.modules.length, 0)}</td><td>{bi ? "" : date(t.updated)}</td>
      <td className="tm-acts">
        <button type="button" className="btn" disabled={isCur} onClick={() => act("use", t)}>Use</button>
        <button type="button" className="btn" onClick={() => act("dup", t)}>Duplicate</button>
        {bi ? null : <><button type="button" className="btn" onClick={() => { setName(t.name); setRenaming(t.id); }}>Rename</button><button type="button" className="btn" onClick={() => act("del", t)}>Delete</button></>}
        <button type="button" className="btn" onClick={() => act("exp", t)}>Export</button>
      </td>
    </tr>
  );
}

/** Use, duplicate, rename, delete, export and import templates. */
export function Templates() {
  const { open } = { open: useUi().templates };
  const { tpl } = useNav();
  useVersion();
  const dlg = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [incAp, setIncAp] = useState(false);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) { setStatus(""); setRenaming(null); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);

  const act = async (a: string, t: Template) => {
    if (a === "use") { if (!(await editor.leave())) return; nav.useTemplate(t.id); setStatus(`Using '${t.name}'.`); }
    else if (a === "dup") { const c = templates.fork(t, `${t.name} (copy)`); setStatus(`Made '${c.name}'.`); }
    else if (a === "del") {
      if ((await ask(`Delete the template '${t.name}'? This cannot be undone.`, [["del", "Delete", true], ["", "Cancel"]])) !== "del") return;
      const was = nav.get().tpl.id === t.id;
      if (was && editor.get().active) editor.discard();
      templates.remove(t.id);
      if (was) nav.useTemplate("builtin-race");
      setStatus(`Deleted '${t.name}'.`);
    } else if (a === "exp") setStatus(exportTemplate(t, incAp));
    bump();
  };

  const blank = async () => {
    if (!(await editor.leave())) return; // first: cancelling "Discard changes?" must not leave a 'New template' behind
    const n = templates.save({ format: "pitwall-template", schemaVersion: SCHEMA, id: newId("t-"), name: templates.uniqueName("New template"), created: new Date().toISOString(), updated: "", workspaces: [{ id: "w-workspace", name: "Workspace", modules: [] }] });
    nav.useTemplate(n.id);
    setRenaming(n.id);
    setStatus(`Made '${n.name}'. Press E to add modules.`);
    bump();
  };

  const rename = (id: string, name: string) => {
    setRenaming(null);
    const t = templates.get(id), n = cleanText(name, 40);
    if (t && !isBuiltin(id) && n && n !== t.name) {
      t.name = templates.uniqueName(n, id);
      templates.save(t);
      if (nav.get().tpl.id === id) nav.replace(t);
      setStatus(`Renamed to '${t.name}'.`);
    }
    bump();
  };

  return (
    <dialog id="dlgTemplates" ref={dlg} aria-label="Templates" onClose={() => ui.closeTemplates()} onCancel={(e) => { if (renaming) e.preventDefault(); }}>
      <form method="dialog" className="dlg-body wide">
        <header className="dlg-h"><h2>Templates</h2><button className="btn icon" value="" aria-label="Close"><Icon name="x" /></button></header>
        <p className="note">A template is a set of workspaces (the tabs). Built-in templates are read-only: editing one makes your own copy. Templates move between PCs by export and import.</p>
        <div className="dlg-scroll">
          <table className="tt">
            <thead><tr><th>Name</th><th className="n">Workspaces</th><th className="n">Modules</th><th>Updated</th><th /></tr></thead>
            <tbody>{[...templates.builtins, ...templates.items].map((t) => <Row key={t.id} t={t} curId={tpl.id} renaming={renaming} setRenaming={setRenaming} act={(a, x) => void act(a, x)} rename={rename} />)}</tbody>
          </table>
        </div>
        <p className="note tm-status" role="status">{status}</p>
        <div className="dlg-foot">
          <label className="btn">Import…<input type="file" accept=".json,application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { const m = await importTemplate(f); if (m) setStatus(m); bump(); } }} /></label>
          <button type="button" className="btn" onClick={() => void blank()}>New from blank</button>
          <label className="check"><input type="checkbox" checked={incAp} onChange={(e) => setIncAp(e.target.checked)} />Include my appearance when exporting</label>
          <span className="top-gap" style={{ flex: 1 }} />
          <button className="btn primary" value="">Done</button>
        </div>
      </form>
    </dialog>
  );
}

void say;
