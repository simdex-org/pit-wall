import { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";

const base = "inline-flex cursor-pointer items-center justify-center font-semibold transition-[filter] hover:brightness-110 disabled:cursor-not-allowed";

const kinds = {
  primary: "h-[60px] w-full rounded-md bg-accent text-[21px] font-bold tracking-[.14em] text-bg",
  outline: "h-[60px] w-full rounded-md border-2 border-accent text-[19px] font-bold tracking-[.12em] text-accent",
  plain: "rounded border border-edge text-[14px] text-text",
  danger: "rounded border border-bad font-bold tracking-[.1em] text-bad",
  warn: "h-[30px] rounded bg-warn px-[14px] text-[13px] font-bold tracking-[.06em] text-bg disabled:bg-line disabled:text-dim disabled:hover:brightness-100",
  link: "p-0 text-[12px] text-text underline",
} as const;

export function Button({ kind = "plain", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: keyof typeof kinds }) {
  return <button type="button" className={`${base} ${kinds[kind]} ${className}`} {...rest} />;
}

export function Label({ tone = "muted", className = "", ...rest }: LabelHTMLAttributes<HTMLLabelElement> & { tone?: "muted" | "bad" }) {
  return <label className={`text-[12px] font-semibold uppercase tracking-[.14em] ${tone === "bad" ? "text-bad" : "text-muted"} ${className}`} {...rest} />;
}

export function Caption({ children }: { children: ReactNode }) {
  return <div className="text-[12px] font-semibold uppercase tracking-[.14em] text-muted">{children}</div>;
}

export function TextInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input spellCheck={false} className={`box-border w-full min-w-0 rounded border border-line bg-raise font-mono text-text ${className}`} {...rest} />;
}

export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-md border bg-panel ${className}`} {...rest} />;
}

export function LogBox({ lines, className = "" }: { lines: string[]; className?: string }) {
  return <pre className={`m-0 box-border select-text whitespace-pre-wrap font-mono text-[11.5px] leading-[1.65] text-muted ${className}`}>{lines.join("\n")}</pre>;
}
