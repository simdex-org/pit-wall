import { useEffect, useRef, useSyncExternalStore } from "react";

export type Choice = [value: string, label: string, primary?: boolean];

interface Pending { text: string; buttons: Choice[]; done: (v: string | null) => void }

let pending: Pending | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((fn) => fn());

/** A question with buttons; resolves to the chosen button's value, or null on Esc. */
export function ask(text: string, buttons: Choice[] = [["ok", "OK", true], ["", "Cancel"]]): Promise<string | null> {
  return new Promise((resolve) => {
    pending?.done(null);
    pending = { text, buttons, done: (v) => { pending = null; notify(); resolve(v || null); } };
    notify();
  });
}

/** Mounted once: shows the question asked by ask(). */
export function ConfirmHost() {
  const p = useSyncExternalStore((fn) => { subs.add(fn); return () => { subs.delete(fn); }; }, () => pending);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (p && !d.open) { d.returnValue = ""; d.showModal(); d.querySelector<HTMLElement>(".btn.primary")?.focus(); }
    if (!p && d.open) d.close();
  }, [p]);
  return (
    <dialog id="dlgConfirm" ref={dlg} aria-label="Confirm" onClose={() => p?.done(dlg.current?.returnValue || null)}>
      {p && (
        <form method="dialog" className="dlg-body">
          <p>{p.text}</p>
          <div className="dlg-foot">{p.buttons.map(([v, l, primary]) => <button key={v + l} className={"btn" + (primary ? " primary" : "")} value={v}>{l}</button>)}</div>
        </form>
      )}
    </dialog>
  );
}
