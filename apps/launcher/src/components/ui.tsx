import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, useState } from "react";

const base = "inline-flex items-center justify-center rounded-md border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function Button({ kind = "plain", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "plain" | "danger" }) {
  const look = {
    primary: "h-12 w-full border-accent bg-accent text-bg text-[17px] hover:bg-accent-hover hover:border-accent-hover",
    plain: "h-9 px-4 border-line bg-raise text-text hover:bg-line",
    danger: "h-8 border-bad bg-raise px-5 text-text hover:bg-bad",
  }[kind];
  return <button className={`${base} ${look} ${className}`} {...rest} />;
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</span>;
}

export function TextInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input spellCheck={false} className={`h-10 w-full rounded-md border border-line bg-raise px-3 text-[15px] text-text ${className}`} {...rest} />;
}

export function ComboInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; hint: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onBlur={() => setOpen(false)}>
      <TextInput value={value} onChange={(e) => onChange(e.target.value)} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)} inputMode="decimal" className="pr-9" />
      <button type="button" tabIndex={-1} aria-label="Show addresses" onMouseDown={(e) => { e.preventDefault(); setOpen(!open); }}
        className="absolute right-0 top-0 h-10 w-9 text-[11px] text-muted hover:text-text">▾</button>
      {open && options.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-line bg-panel py-1 shadow-lg">
          {options.map((o) => (
            <li key={o.value}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onChange(o.value); setOpen(false); }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-[15px] hover:bg-line ${o.value === value ? "text-accent" : "text-text"}`}>
                {o.value}<span className="text-[12px] text-muted">{o.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-panel ${className}`}>{children}</div>;
}

export function Switch({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-[15px]">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full border border-line transition-colors ${checked ? "bg-accent" : "bg-line"}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-text transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
      {children}
    </label>
  );
}
