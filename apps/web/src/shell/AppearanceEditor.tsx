import { useRef, useState } from "react";
import { Icon } from "../lib/icons";
import { download } from "../lib/files";
import { slug } from "../lib/text";
import {
  appearance, BUILTIN_THEMES, CONTRAST_KEYS, contrast, HEX, isBuiltinTheme, LAYOUT, LayoutKey, resolved, Theme, themeLayoutKeys, TOKENS, tokenLabel, unreadable, useAppearance,
} from "../state/appearance";
import { ask } from "./confirm";

const LAYOUT_LABELS: Record<LayoutKey, [string, string[]]> = {
  density: ["Density", ["Follows size", "Compact", "Comfortable"]], radius: ["Corner radius", ["0", "2", "4", "8"]], panel: ["Panels", ["Ruled", "Boxed", "Flat"]],
  numFont: ["Numbers", ["Mono", "Sans"]], labels: ["Labels", ["UPPER", "Sentence"]], fontScale: ["Font scale", []],
};

function Token({ k, role, tok, bg, onChange }: { k: string; role: string; tok: string; bg: string; onChange: (v: string) => void }) {
  const [hex, setHex] = useState(tok);
  const [focus, setFocus] = useState(false);
  const shown = focus ? hex : tok;
  let cr = null;
  if (CONTRAST_KEYS.has(k)) {
    const r = +contrast(tok, bg).toFixed(1), min = k === "dim" ? 3 : 4.5; // judged on the figure shown
    cr = <span className={"ap-cr n" + (r < min ? " s-warn" : "")}>{r >= 7 ? `${r.toFixed(1)}:1 AAA` : r >= min ? `${r.toFixed(1)}:1 AA` : <><Icon name="triangle-alert" />{r.toFixed(1)}:1 low</>}</span>;
  } else cr = <span className="ap-cr n" />;
  return (
    <div className="ap-tok" data-k={k}>
      <label htmlFor={`apc-${k}`}>{tokenLabel(k)}</label><span className="note">{role}</span>
      <input type="color" id={`apc-${k}`} value={tok} aria-label={`${tokenLabel(k)} colour`} onChange={(e) => onChange(e.target.value.toLowerCase())} />
      <input type="text" className="ap-hex n" value={shown} maxLength={7} spellCheck={false} aria-label={`${tokenLabel(k)} hex`}
        onFocus={() => { setHex(tok); setFocus(true); }} onChange={(e) => { setHex(e.target.value); if (HEX.test(e.target.value.trim())) onChange(e.target.value.trim().toLowerCase()); }}
        onBlur={() => setFocus(false)} />
      {cr}
    </div>
  );
}

function ThemeRow({ t, cur, status, setStatus }: { t: Theme; cur: Theme; status: string; setStatus: (s: string) => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(t.name);
  const bi = isBuiltinTheme(t.id), inUse = t.id === cur.id;
  const commit = () => { setRenaming(false); const m = appearance.rename(t.id, name); if (m) setStatus(m); };
  void status;
  return (
    <li className={"ap-row" + (inUse ? " on" : "")}>
      {renaming ? (
        <span className="ap-use">
          {bi ? <Icon name="lock" /> : <span className="ico-gap" />}
          <input type="text" className="ap-ren" maxLength={40} value={name} aria-label="New name" autoFocus onChange={(e) => setName(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setRenaming(false); } }} />
          {inUse ? <b className="tag">IN USE</b> : null}
        </span>
      ) : (
        <button type="button" className="ap-use" onClick={() => { appearance.use(t.id); setStatus(""); }}>
          {bi ? <Icon name="lock" /> : <span className="ico-gap" />}<span className="ap-name">{t.name}</span>{inUse ? <b className="tag">IN USE</b> : null}
        </button>
      )}
      <span className="ap-acts">
        <button type="button" className="linkbtn" onClick={() => { const c = appearance.copy(t, `${t.name} (copy)`); appearance.use(c.id); setStatus(`Made '${c.name}'.`); }}>Duplicate</button>
        {bi ? null : <>
          <button type="button" className="linkbtn" onClick={() => { setName(t.name); setRenaming(true); }}>Rename</button>
          <button type="button" className="linkbtn" onClick={async () => {
            if ((await ask(`Delete the appearance '${t.name}'?`, [["del", "Delete", true], ["", "Cancel"]])) !== "del") return;
            appearance.remove(t.id); setStatus(`Deleted '${t.name}'.`);
          }}>Delete</button>
        </>}
        <button type="button" className="linkbtn" onClick={() => download(`${slug(t.name)}.pitwall-theme.json`, appearance.pack(t))}>Export</button>
      </span>
    </li>
  );
}

/** Settings › Appearance: pick, copy, import and edit the colours and layout. */
export function AppearanceEditor() {
  const cur = useAppearance();
  const [status, setStatus] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const tok = resolved(cur), bi = isBuiltinTheme(cur.id);
  const change = (fn: (t: Theme) => void) => { const why = appearance.change(fn); setStatus(why); };

  const importFile = async (f: File) => {
    if (f.size > 65536) return setStatus("File too large.");
    let j: unknown;
    try { j = JSON.parse(await f.text()); } catch { return setStatus("Not a valid JSON file."); }
    const o = j as Record<string, unknown> | null;
    if (!o || o.format !== "pitwall-theme") return setStatus("Not a Pit Wall theme file.");
    if (!Number.isInteger(o.schemaVersion) || (o.schemaVersion as number) > 1) return setStatus("This theme was made by a newer Pit Wall.");
    const t = appearance.adopt(o);
    if (!t) return setStatus("Not a Pit Wall theme file.");
    const why = unreadable(t).replace(/,? so it was not applied\.?/, ".");
    setStatus(why ? `Imported '${t.name}' but not applied: ${why}` : `Imported '${t.name}'.`);
  };

  return (
    <div className="ap">
      <div className="ap-list">
        <div className="ap-h"><h3 className="mt">Appearances</h3>
          <label className="btn">Import…<input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} /></label>
        </div>
        <ul>{[...BUILTIN_THEMES, ...appearance.users].map((t) => <ThemeRow key={t.id} t={t} cur={cur} status={status} setStatus={setStatus} />)}</ul>
      </div>
      <div className="ap-edit">
        <div className="ap-h"><h3 className="mt">{cur.name}{bi ? <span className="note"> built-in: changes make your own copy</span> : null}</h3>
          <button type="button" className="btn" disabled={bi} title={bi ? "Built-ins are already their base" : undefined} onClick={() => {
            const base = BUILTIN_THEMES.find((b) => b.id === cur.base) ?? BUILTIN_THEMES[0]!;
            change((t) => { t.tokens = {}; for (const k of themeLayoutKeys()) (t as unknown as Record<string, unknown>)[k] = base[k]; });
            setStatus(`Back to ${base.name}.`);
          }}>Reset to base</button>
        </div>
        <p className="note ap-status" role="status">{status}</p>
        <fieldset className="ap-grp">
          <legend>Layout</legend>
          {(["density", "radius", "panel", "numFont", "labels"] as const).map((k) => (
            <div className="ap-lay" key={k}>
              <span className="lbl">{LAYOUT_LABELS[k][0]}</span>
              <div className="seg" role="group" aria-label={LAYOUT_LABELS[k][0]}>
                {LAYOUT[k].map((v, i) => <button type="button" key={String(v)} aria-pressed={cur[k] === v} onClick={() => change((t) => { (t as unknown as Record<string, unknown>)[k] = v; })}>{LAYOUT_LABELS[k][1][i]}</button>)}
              </div>
            </div>
          ))}
          <div className="ap-lay"><label className="lbl" htmlFor="apFs">Font scale</label>
            <select id="apFs" value={cur.fontScale} onChange={(e) => change((t) => { t.fontScale = +e.target.value; })}>{LAYOUT.fontScale.map((v) => <option key={v} value={v}>{Math.round(v * 100)} %</option>)}</select>
          </div>
        </fieldset>
        {["Surface", "Identity", "Timing", "State", "Traces"].map((g) => (
          <fieldset className="ap-grp" key={g}>
            <legend>{g}</legend>
            {TOKENS.filter((x) => x[3] === g).map(([k, , role]) => <Token key={k} k={k} role={role} tok={tok[k]!} bg={tok.bg!} onChange={(v) => change((t) => { t.tokens[k] = v; })} />)}
          </fieldset>
        ))}
      </div>
    </div>
  );
}
