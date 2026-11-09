import { useRef, useState } from "react";
import type { OptionDef } from "../engine/types";
import { download } from "../lib/files";
import { MAX_SOURCE, sourceProblem } from "../lib/sandbox";
import { ask } from "./confirm";

export function CodeField({ op, value, set }: { op: OptionDef; value: string; set: (v: string) => void }) {
  const [err, setErr] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const take = (s: string) => {
    const p = sourceProblem(s);
    setErr(p ?? "");
    if (!p) set(s);
  };
  const examples = (op.choices ?? []).filter((c): c is [string, string] => Array.isArray(c));
  const load = async (src: string, name: string) => {
    if (area.current?.value.trim() && (await ask(`Replace the current source with the ${name} example?`, [["ok", "Replace", true], ["", "Cancel"]])) !== "ok") return;
    take(src);
  };
  return (
    <div className="fld multi">
      <span className="lab" style={{ display: "block", paddingBottom: 4, color: "var(--mut)" }}>{op.label}</span>
      <textarea ref={area} key={value} defaultValue={value} rows={16} spellCheck={false} aria-label={op.label}
        style={{ width: "100%", fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12, whiteSpace: "pre", overflowWrap: "normal" }}
        onBlur={(e) => { if (e.target.value !== value) take(e.target.value); }} />
      {err ? <p role="alert" style={{ color: "var(--bad)", margin: "4px 0" }}>{err}</p> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 6 }}>
        <label className="btn sm">Import .html<input type="file" accept=".html,.htm,text/html" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) take(await f.text()); }} /></label>
        <button type="button" className="btn sm" onClick={() => download("pitwall-module.html", area.current?.value ?? value, "text/html")}>Export .html</button>
        {examples.length ? (
          <select aria-label="Load an example" value="" onChange={(e) => { const x = examples.find((c) => c[1] === e.target.value); if (x) void load(x[0], x[1]); }}>
            <option value="">Load an example…</option>
            {examples.map(([, name]) => <option key={name} value={name}>{name}</option>)}
          </select>
        ) : null}
        <span className="note">{value.length.toLocaleString("en")} / {MAX_SOURCE.toLocaleString("en")} characters</span>
      </div>
      {op.hint ? <p className="note" style={{ margin: "6px 0 0" }}>{op.hint}</p> : null}
    </div>
  );
}
