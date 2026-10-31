import { useEffect, useRef } from "react";
import { registry } from "../engine/registry";
import type { OptionDef } from "../engine/types";
import { Icon } from "../lib/icons";
import { cleanText } from "../lib/text";
import { editor, useEditor } from "../state/editor";
import { isBuiltin, sanitizeOptions } from "../state/templates";
import { useNav } from "../state/nav";

const pairs = (op: OptionDef): [string, string][] => (op.choices ?? []).map((c) => (Array.isArray(c) ? c : [c, String(c)]));

export function Field({ op, value, mid }: { op: OptionDef; value: unknown; mid?: string }) {
  const set = (v: unknown) => editor.setOpt((m, def) => { m.options = sanitizeOptions(def!, { ...m.options, [op.key]: v }, () => {}); }, mid);
  const id = `mo-${op.key}`;
  if (op.type === "select") {
    return <label className="fld"><span>{op.label}</span><select id={id} value={String(value)} onChange={(e) => set(e.target.value)}>{pairs(op).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  }
  if (op.type === "number") {
    return <label className="fld"><span>{op.label}</span><input type="number" id={id} defaultValue={value as number} key={String(value)} min={op.min} max={op.max} step={op.step ?? 1} onChange={(e) => { const v = parseFloat(e.target.value); if (isFinite(v)) set(v); }} /></label>;
  }
  if (op.type === "toggle") {
    return <label className="fld check"><span>{op.label}</span><input type="checkbox" id={id} checked={!!value} onChange={(e) => set(e.target.checked)} /></label>;
  }
  if (op.type === "text") {
    return <label className="fld"><span>{op.label}</span><input type="text" id={id} maxLength={40} defaultValue={String(value ?? "")} onBlur={(e) => set(e.target.value)} /></label>;
  }
  // multi: the chosen ones first in their order, then the rest
  const ch = pairs(op), on = Array.isArray(value) ? (value as string[]) : [];
  const rows = [...on.filter((x) => ch.some((c) => c[0] === x)), ...ch.map((c) => c[0]).filter((x) => !on.includes(x))];
  const move = (x: string, d: number) => { const a = on.slice(), i = a.indexOf(x), j = i + d; if (i < 0 || j < 0 || j >= a.length) return; a.splice(j, 0, a.splice(i, 1)[0]!); set(a); };
  return (
    <fieldset className="fld multi">
      <legend>{op.label}</legend>
      {rows.map((x) => {
        const label = ch.find((c) => c[0] === x)?.[1] ?? x, sel = on.includes(x);
        return (
          <div className="mrow" key={x}>
            <label className="check"><input type="checkbox" checked={sel} onChange={(e) => set(e.target.checked ? [...on, x] : on.filter((y) => y !== x))} /><span>{label}</span></label>
            {sel ? <><button type="button" className="btn icon" aria-label={`Move ${label} up`} onClick={() => move(x, -1)}>↑</button><button type="button" className="btn icon" aria-label={`Move ${label} down`} onClick={() => move(x, 1)}>↓</button></> : null}
          </div>
        );
      })}
    </fieldset>
  );
}

/** A module's title, header and options. Every change applies live. */
export function ModuleOptions() {
  const ed = useEditor();
  const { tpl } = useNav();
  const dlg = useRef<HTMLDialogElement>(null);
  const m = editor.modById(ed.optId);
  const def = m ? registry.get(m.type) : undefined;
  const open = !!(m && def);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog id="dlgModule" ref={dlg} aria-label="Module options" onClose={() => editor.openOptions(null)}>
      {m && def ? (
        <form method="dialog" className="dlg-body">
          <header className="dlg-h"><h2>{m.title || def.title} <span className="note">options</span></h2><button className="btn icon" value="" aria-label="Close"><Icon name="x" /></button></header>
          <div className="dlg-scroll">
            <label className="fld"><span>Title</span><input type="text" maxLength={40} defaultValue={m.title} placeholder={def.title} key={m.id + "t"} onBlur={(e) => editor.setOpt((q) => { q.title = cleanText(e.target.value, 40); })} /></label>
            <label className="fld check"><span>Show header</span><input type="checkbox" checked={m.header !== false} onChange={(e) => editor.setOpt((q) => { q.header = e.target.checked; })} /></label>
            {def.options.filter((op) => !op.hidden).map((op) => <Field key={op.key} op={op} value={m.options[op.key] !== undefined ? m.options[op.key] : op.def} />)}
          </div>
          <div className="dlg-foot">
            <span className="note">{ed.active ? "Saved with the layout." : isBuiltin(tpl.id) ? "A change makes your own copy of this built-in template." : "Changes are saved at once."}</span>
            <button type="button" className="btn" onClick={() => editor.setOpt((q, d) => { q.options = sanitizeOptions(d!, {}, () => {}); q.title = ""; q.header = true; })}>Reset options</button>
            <button className="btn primary" value="">Done</button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}
