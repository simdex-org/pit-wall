import { useEffect } from "react";
import { feed } from "../feed/store";
import { say } from "../state/bridge";
import { editor } from "../state/editor";
import { nav } from "../state/nav";
import { recorder } from "../state/recorder";
import { ui } from "../state/ui";

interface Actions { toggleDrawer: (on?: boolean) => void; drawerOpen: boolean; showKeys: () => void }

/** Single-key shortcuts. Dialogs and text fields keep their own keys. */
export function useShortcuts({ toggleDrawer, drawerOpen, showKeys }: Actions): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ui.get().settings) return; // the settings screen has its own Esc
      if (document.querySelector("dialog[open]") || document.querySelector(":popover-open")) return;
      if (editor.get().active && editor.key(e)) return;
      const t = e.target as HTMLElement;
      if (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (k === "Escape") { if (drawerOpen) toggleDrawer(false); else feed.setFocus("self"); }
      else if (/^[1-9]$/.test(k)) { const w = nav.get().tpl.workspaces[Number(k) - 1]; if (w) nav.showWorkspace(w.id); }
      else if (k === "[") nav.stepWorkspace(-1);
      else if (k === "]") nav.stepWorkspace(1);
      else if (k === "a" || k === "A") toggleDrawer();
      else if (k === "g" || k === "G") feed.setFocus("self");
      else if (k === "e" || k === "E") toggleEdit();
      else if (k === ",") ui.openSettings();
      else if (k === "t" || k === "T") ui.openTemplates();
      else if (k === "p" || k === "P") recorder.setPaused(!recorder.frozen);
      else if (k === "?") showKeys();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleDrawer, drawerOpen, showKeys]);
}

/** Enter or leave edit mode; the grid is one column in a narrow window, so there is nothing to edit there. */
export function toggleEdit(): void {
  if (!editor.get().active && document.getElementById("ws")?.classList.contains("narrow")) {
    say("Widen the window to edit layouts", 1);
    return;
  }
  editor.toggle();
}
