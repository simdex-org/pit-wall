// The REF and CMP laps and the cursor along the lap shared by the traces, the segments and the map.
import { useSyncExternalStore } from "react";
import { aux } from "../engine/versions";
import { clamp } from "../lib/format";

export interface Sel { ref: string | null; cmp: string | null; /** 0 to 1 along the lap. */ cursor: number | null; /** The corner the coach, the map and the traces are looking at. */ corner: number | null }

class Selection {
  private sel: Sel = { ref: null, cmp: null, cursor: null, corner: null };
  private subs = new Set<() => void>();

  get = (): Sel => this.sel;
  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };

  private set(next: Sel): void {
    this.sel = next;
    aux.bump("sel");
    this.subs.forEach((fn) => fn());
  }

  select(which: "ref" | "cmp", lapId: string | null): void {
    this.set({ ...this.sel, [which]: lapId });
  }

  setCorner(n: number | null): void {
    this.set({ ...this.sel, corner: n });
  }

  setCursor(f: number | null): void {
    this.set({ ...this.sel, cursor: f == null || !isFinite(f) ? null : clamp(+f, 0, 1) });
  }
}

export const selection = new Selection();
export const useSelection = (): Sel => useSyncExternalStore(selection.subscribe, selection.get);
