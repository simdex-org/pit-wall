import { useEffect, useRef } from "react";
import { Icon } from "../lib/icons";

const KEYS: [string, string][] = [
  ["1–9", "Workspace n of the template"], ["[  ]", "Previous / next workspace"], ["A", "Open or close the engineer drawer"],
  ["G", "Focus back to your car"], ["Esc", "Close the drawer, then focus back to your car"], ["?", "This list"],
  ["↑ ↓ then Enter", "In standings, relative or pit lane: pick a car to focus"],
];

export function KeysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={dlg} id="dlgKeys" aria-label="Keyboard shortcuts" onClose={onClose}>
      <form method="dialog" className="dlg-body">
        <header className="dlg-h"><h2>Keyboard shortcuts</h2><button className="btn icon" value="" aria-label="Close"><Icon name="x" /></button></header>
        <table className="tt keys"><tbody>{KEYS.map(([k, t]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{t}</td></tr>)}</tbody></table>
      </form>
    </dialog>
  );
}
