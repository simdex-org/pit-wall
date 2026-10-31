import { useSyncExternalStore } from "react";
import { registry } from "../engine/registry";
import { Field } from "../shell/ModuleOptions";

const open = new Set<string>();
const subs = new Set<() => void>();
let version = 0;

export const labelsPanel = {
  toggle(id: string) {
    if (!open.delete(id)) open.add(id);
    version++;
    subs.forEach((fn) => fn());
  },
};

export function useLabelsOpen(id: string): boolean {
  useSyncExternalStore((fn) => { subs.add(fn); return () => { subs.delete(fn); }; }, () => version);
  return open.has(id);
}

const KEYS = ["fields", "which", "dim", "colours", "size", "corners", "sectors", "sectorTint"];

export function LabelsPanel({ id, opts }: { id: string; opts: Record<string, unknown> }) {
  const def = registry.get("track-map");
  return (
    <div className="map-labels" aria-label="Map labels">
      {KEYS.map((k) => { const op = def?.options.find((o) => o.key === k); return op ? <Field key={k} op={op} value={opts[k] !== undefined ? opts[k] : op.def} mid={id} /> : null; })}
    </div>
  );
}
