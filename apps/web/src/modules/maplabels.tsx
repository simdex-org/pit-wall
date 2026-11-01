import { FIELD_COLOUR } from "../draw/map";
import { useSyncExternalStore, type ReactNode } from "react";
import { editor } from "../state/editor";
import { sanitizeOptions } from "../state/templates";
import { registry } from "../engine/registry";

const open = new Set<string>();
const subs = new Set<() => void>();
let version = 0;
const notify = () => { version++; subs.forEach((f) => f()); };

export const labelsPanel = {
  toggle(id: string): void { if (!open.delete(id)) open.add(id); notify(); },
};
export const useLabelsOpen = (id: string): boolean => {
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => version);
  return open.has(id);
};

const FIELDS: [string, string][] = [["pos", "Position"], ["num", "Race number"], ["code", "Three letters"], ["name", "Surname"], ["gap", "Gap to you"]];
const WHICH: [string, string][] = [["all", "All"], ["near", "±30 s"], ["class", "Class"], ["focus", "Focus"]];
const ROADS: [string, string][] = [["s", "Thin"], ["m", "Normal"], ["l", "Wide"]];
const SIZES: [string, string][] = [["s", "S"], ["m", "M"], ["l", "L"]];
const PRESETS: [string, string, string[]][] = [["gap", "Gap", ["gap"]], ["num", "Number + gap", ["num", "gap"]], ["code", "Code + gap", ["code", "gap"]], ["name", "Full name", ["name"]], ["pos", "Position + number", ["pos", "num"]], ["none", "Dots only", []]];

const set = (id: string, patch: Record<string, unknown>) =>
  editor.setOpt((m) => { m.options = sanitizeOptions(registry.get(m.type)!, { ...m.options, ...patch }, () => {}); }, id);

function Seg({ items, on, onPick }: { items: [string, string][]; on: string; onPick: (v: string) => void }) {
  return <div className="seg">{items.map(([v, l]) => <button key={v} type="button" aria-pressed={v === on} onClick={() => onPick(v)}>{l}</button>)}</div>;
}
const Row = ({ label, children }: { label: string; children: ReactNode }) => <div className="ml-row"><span>{label}</span>{children}</div>;
const Sw = ({ label, on, onSet }: { label: string; on: boolean; onSet: (v: boolean) => void }) => <input type="checkbox" aria-label={label} checked={on} onChange={(e) => onSet(e.target.checked)} />;

/** The track map's label options as a panel over the map; every change is saved with the layout at once. */
export function LabelsPanel({ id, opts }: { id: string; opts: Record<string, unknown> }) {
  const fields = (opts.fields as string[]) ?? [], on = (k: string) => fields.includes(k);
  const same = (a: string[]) => a.length === fields.length && a.every((x, i) => x === fields[i]);
  const preset = PRESETS.find((p) => same(p[2]));
  return (
    <aside className="ml" aria-label="Map labels">
      <div className="ml-sec">
        <Row label="Preset">
          <select aria-label="Preset" value={preset ? preset[0] : "custom"} onChange={(e) => { const p = PRESETS.find((x) => x[0] === e.target.value); if (p) set(id, { fields: p[2] }); }}>
            {preset ? null : <option value="custom">Custom</option>}
            {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Row>
      </div>
      <div className="ml-sec">
        <span className="lbl">Track</span>
        <Row label="Road width"><Seg items={ROADS} on={String(opts.road ?? "m")} onPick={(v) => set(id, { road: v })} /></Row>
        <span className="lbl">Turns</span>
        <Row label="Show turn names"><Sw label="Show turn names" on={!!opts.corners} onSet={(v) => set(id, { corners: v })} /></Row>
      </div>
      <div className="ml-sec">
        <span className="lbl">Sectors</span>
        <Row label="Colour the sectors"><Sw label="Colour the sectors" on={opts.sectors !== false} onSet={(v) => set(id, { sectors: v })} /></Row>
      </div>
      <div className="ml-sec">
        <span className="lbl">Other cars</span>
        <Row label="Show other cars"><Sw label="Show other cars" on={opts.field !== false} onSet={(v) => set(id, { field: v })} /></Row>
        <Row label="Cars"><Seg items={WHICH} on={String(opts.which)} onPick={(v) => set(id, { which: v })} /></Row>
        <Row label="Size"><Seg items={SIZES} on={String(opts.size)} onPick={(v) => set(id, { size: v })} /></Row>
        <Row label="Dim far cars"><Sw label="Dim far cars" on={!!opts.dim} onSet={(v) => set(id, { dim: v })} /></Row>
      </div>
      <div className="ml-sec">
        <span className="lbl">Label fields <span className="s-dim">shown in this order</span></span>
        <Row label="Colour each field"><Sw label="Colour each field" on={!!opts.colours} onSet={(v) => set(id, { colours: v })} /></Row>
        <div className="ml-grid">
          {FIELDS.map(([k, l]) => (
            <button key={k} type="button" className="chip" aria-pressed={on(k)} onClick={() => set(id, { fields: on(k) ? fields.filter((x) => x !== k) : [...fields, k] })}><i style={opts.colours ? { background: FIELD_COLOUR[k] } : undefined} />{l}</button>
          ))}
        </div>
      </div>
    </aside>
  );
}
