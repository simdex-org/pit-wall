// Which overlay is open.
import { useSyncExternalStore } from "react";

export type Section = "conn" | "units" | "th" | "strat" | "layout" | "ap" | "tpl" | "data" | "about";
export interface UiState { settings: boolean; section: Section; templates: boolean }

class Ui {
  private s: UiState = { settings: false, section: "conn", templates: false };
  private subs = new Set<() => void>();

  get = (): UiState => this.s;
  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };

  private set(patch: Partial<UiState>): void {
    this.s = { ...this.s, ...patch };
    this.subs.forEach((fn) => fn());
  }

  openSettings(section?: Section): void { this.set({ settings: true, ...(section ? { section } : {}) }); }
  closeSettings(): void { this.set({ settings: false }); }
  section(section: Section): void { this.set({ section }); }
  openTemplates(): void { this.set({ templates: true }); }
  closeTemplates(): void { this.set({ templates: false }); }
}

export const ui = new Ui();
export const useUi = (): UiState => useSyncExternalStore(ui.subscribe, ui.get);
