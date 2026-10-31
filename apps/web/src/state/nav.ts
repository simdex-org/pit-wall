// Which template and workspace this tab shows. They live in the address bar (#t=..&w=..), so each tab keeps its own.
import { useSyncExternalStore } from "react";
import { lsRaw, lsSet } from "../lib/storage";
import { prefs } from "./prefs";
import { Template, templates, Workspace } from "./templates";

export interface NavState { tpl: Template; wsId: string }

const readHash = () => {
  const h = new URLSearchParams(location.hash.slice(1));
  return { t: h.get("t"), w: h.get("w") };
};

class Nav {
  private state!: NavState;
  private subs = new Set<() => void>();

  /** Called once every module has registered and the templates are loaded. */
  start(): void {
    const h = readHash();
    const tpl = templates.get(h.t) ?? templates.get(lsRaw("pitwall.active")) ?? templates.get("builtin-race")!;
    lsSet("pitwall.active", tpl.id);
    this.show(tpl, h.t === tpl.id && h.w ? h.w : prefs.get().lastWs[tpl.id]);
    window.addEventListener("hashchange", () => {
      const n = readHash();
      if (n.t && n.t !== this.state.tpl.id && templates.get(n.t)) this.useTemplate(n.t, n.w ?? undefined);
      else if (n.w && n.w !== this.state.wsId) this.showWorkspace(n.w);
    });
  }

  get = (): NavState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  };

  workspace(): Workspace {
    const { tpl, wsId } = this.state;
    return tpl.workspaces.find((w) => w.id === wsId) ?? tpl.workspaces[0]!;
  }

  private show(tpl: Template, wsId?: string): void {
    const ws = tpl.workspaces.find((w) => w.id === wsId) ?? tpl.workspaces[0]!;
    this.state = { tpl, wsId: ws.id };
    prefs.rememberWorkspace(tpl.id, ws.id);
    history.replaceState(null, "", `${location.pathname}#t=${encodeURIComponent(tpl.id)}&w=${encodeURIComponent(ws.id)}`);
    for (const fn of this.subs) fn();
  }

  showWorkspace(wsId: string): void { this.show(this.state.tpl, wsId); }

  /** The tab's template changed in place (the editor): same tab, new contents. */
  replace(tpl: Template, wsId?: string): void { this.show(tpl, wsId ?? this.state.wsId); }

  stepWorkspace(d: number): void {
    const ws = this.state.tpl.workspaces, i = ws.findIndex((w) => w.id === this.state.wsId);
    this.showWorkspace(ws[(i + d + ws.length) % ws.length]!.id);
  }

  /** The tab's template, and the default for new tabs. */
  useTemplate(id: string, wsId?: string): void {
    const tpl = templates.get(id) ?? templates.get("builtin-race")!;
    lsSet("pitwall.active", tpl.id);
    this.show(tpl, wsId ?? prefs.get().lastWs[tpl.id]);
  }
}

export const nav = new Nav();
export const useNav = (): NavState => useSyncExternalStore(nav.subscribe, nav.get);
