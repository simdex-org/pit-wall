// Appearance: the colour tokens and layout settings of this browser. Built-ins are read-only; changing one forks it into
// "<Name> (custom)", as templates do. Applied as CSS variables on <html>, so the page, the modules and the canvases all follow.
import { useSyncExternalStore } from "react";
import { aux } from "../engine/versions";
import { lsGet, lsSet } from "../lib/storage";
import { BAD_KEYS, cleanText, deep, isObj, newId } from "../lib/text";

export const TOKENS: [key: string, cssVar: string, role: string, group: string][] = [
  ["bg", "--bg", "Page background", "Surface"], ["panel", "--panel", "Module body fill (boxed and flat panels)", "Surface"],
  ["raise", "--raise", "Hover, row cursor, inputs", "Surface"], ["line", "--line", "Borders, rules, grid", "Surface"],
  ["line2", "--line2", "Table row dividers, meter tracks", "Surface"], ["text", "--txt", "Primary text and values", "Surface"],
  ["muted", "--mut", "Secondary text, titles", "Surface"], ["dim", "--dim", "Labels, axes, disabled", "Surface"],
  ["accent", "--acc", "Focus car, selection, keyboard focus, links", "Identity"], ["me", "--me", "Your car: row bar, map disc, YOU tag", "Identity"],
  ["best", "--best", "Session best (always with ◆)", "Timing"], ["pb", "--pb", "Personal best, improved (always with ●)", "Timing"],
  ["slow", "--slow", "Slower than the previous sector", "Timing"], ["invalid", "--inv", "Invalid lap (struck through, INV)", "Timing"],
  ["ok", "--ok", "In the window, gain, on track", "State"], ["warn", "--warn", "Out of the window, near a limit, out-lap", "State"],
  ["bad", "--bad", "Critical, loss, stopped", "State"], ["cold", "--cold", "Below the window, pit lane, wet compound", "State"],
  ["chSpeed", "--c-speed", "Speed trace", "Traces"], ["chThr", "--c-thr", "Throttle trace", "Traces"], ["chBrk", "--c-brk", "Brake trace", "Traces"],
  ["chSteer", "--c-steer", "Steering trace", "Traces"], ["chGear", "--c-gear", "Gear trace", "Traces"], ["chRpm", "--c-rpm", "RPM trace", "Traces"],
  ["chRef", "--c-ref", "Reference lap in overlays (solid)", "Traces"], ["chCmp", "--c-cmp", "Comparison lap in overlays (dashed)", "Traces"],
  ["chLap", "--c-lap", "Current lap line on the map", "Traces"], ["chFL", "--c-fl", "Front left traces", "Traces"], ["chFR", "--c-fr", "Front right traces", "Traces"],
  ["chRL", "--c-rl", "Rear left traces", "Traces"], ["chRR", "--c-rr", "Rear right traces", "Traces"],
];

/** The tokens checked for contrast; an invalid time is always struck through and tagged, so it may be dimmer than text. */
export const CONTRAST_KEYS = new Set(["text", "muted", "dim", "ok", "warn", "bad", "cold", "best", "pb", "slow", "me", "accent"]);

export const BASE_TOKENS: Record<string, string> = {
  bg: "#0a0b0d", panel: "#101216", raise: "#171a1f", line: "#262a31", line2: "#1b1e24", text: "#e6e8eb", muted: "#a1a7b0", dim: "#7a818b",
  accent: "#2ad4c4", me: "#ffd400", best: "#c27aff", pb: "#3ddc84", slow: "#f5c518", invalid: "#6b717a", ok: "#3ddc84", warn: "#ff9f1a", bad: "#ff5468", cold: "#5aaeff",
  chSpeed: "#e6e8eb", chThr: "#3ecf7a", chBrk: "#ff5e57", chSteer: "#f2c230", chGear: "#a98bff", chRpm: "#8a929c", chRef: "#e6e8eb", chCmp: "#ff9f1a", chLap: "#5aaeff",
  chFL: "#35b9d6", chFR: "#3ecf7a", chRL: "#f2c230", chRR: "#f06ab8",
};

export const LAYOUT = {
  density: ["compact", "comfortable"], fontScale: [0.9, 1, 1.1, 1.25], radius: [0, 2, 4, 8], panel: ["ruled", "boxed", "flat"], numFont: ["mono", "sans"], labels: ["upper", "sentence"],
} as const;
export type LayoutKey = keyof typeof LAYOUT;
const DEF_LAYOUT: Pick<Theme, "density" | "fontScale" | "radius" | "panel" | "numFont" | "labels"> = { density: "compact", fontScale: 1, radius: 2, panel: "ruled", numFont: "mono", labels: "upper" };

export interface Theme {
  format: "pitwall-theme"; schemaVersion: 1; id: string; name: string; base: string; tokens: Record<string, string>;
  density: string; fontScale: number; radius: number; panel: string; numFont: string; labels: string;
}

const BUILTIN_SRC: [string, string, Record<string, string>, Partial<typeof DEF_LAYOUT>][] = [
  ["pitwall", "Pit Wall", {}, {}],
  ["broadcast", "Broadcast", { bg: "#050608", panel: "#0e1014", line: "#23272e", accent: "#ffffff", me: "#ff8ad8" }, { radius: 4, panel: "boxed", labels: "sentence" }],
  ["night", "Night stint", { bg: "#000000", panel: "#07080a", raise: "#101215", line: "#1a1d22", line2: "#121418", text: "#c9ccd1", muted: "#8a9099", dim: "#646a73", accent: "#5fb3a6", me: "#c9ccd1", ok: "#36b56e", warn: "#d9892a", bad: "#d9475a", best: "#a46ad8" }, {}],
  ["daylight", "Daylight", {
    bg: "#f3f4f6", panel: "#ffffff", raise: "#e9ebee", line: "#d3d7dd", line2: "#e6e8ec", text: "#111418", muted: "#4a515b", dim: "#6b727c", accent: "#007b76", me: "#111418",
    best: "#7b2fbe", pb: "#0d7e3d", slow: "#8c6900", ok: "#0d7e3d", warn: "#ab5800", bad: "#c8102e", cold: "#1565c0", chSpeed: "#111418", chRef: "#111418", chCmp: "#b55d00",
    chLap: "#1565c0", chThr: "#0f8a43", chBrk: "#c8102e", chSteer: "#9a7400", chRpm: "#6b727c",
  }, {}],
];
export const BUILTIN_THEMES: readonly Theme[] = BUILTIN_SRC.map(([id, name, tokens, layout]) =>
  Object.freeze({ format: "pitwall-theme", schemaVersion: 1, id, name, base: id, tokens: { ...BASE_TOKENS, ...tokens }, ...DEF_LAYOUT, ...layout }) as Theme);

export const HEX = /^#[0-9a-f]{6}$/i;
const builtin = (id: string) => BUILTIN_THEMES.find((b) => b.id === id) ?? null;
export const isBuiltinTheme = (id: string) => !!builtin(id);

const lum = (hex: string) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
};
export const contrast = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

export const tokenLabel = (k: string): string => (({
  bg: "Background", line2: "Line 2", chSpeed: "Speed", chThr: "Throttle", chBrk: "Brake", chSteer: "Steering", chGear: "Gear", chRpm: "RPM", chRef: "Reference",
  chCmp: "Comparison", chLap: "Current lap", chFL: "FL", chFR: "FR", chRL: "RL", chRR: "RR", pb: "Personal best", me: "Your car",
} as Record<string, string>)[k] ?? k[0]!.toUpperCase() + k.slice(1));

const newThemeId = () => "th-" + newId("t-").slice(2, 8);

export function sanitizeTheme(raw: unknown): Theme | null {
  if (!isObj(raw)) return null;
  const base = builtin(raw.base) ? raw.base : "pitwall", b = builtin(base)!;
  const t: Theme = { ...b, id: newThemeId(), name: cleanText(raw.name, 40) || "Imported theme", base, tokens: {} };
  if (isObj(raw.tokens)) for (const [k, v] of Object.entries(raw.tokens)) if (!BAD_KEYS.has(k) && k in BASE_TOKENS && typeof v === "string" && HEX.test(v)) t.tokens[k] = v.toLowerCase();
  for (const [k, vals] of Object.entries(LAYOUT)) (t as unknown as Record<string, unknown>)[k] = (vals as readonly unknown[]).includes(raw[k]) ? raw[k] : (b as unknown as Record<string, unknown>)[k];
  return t;
}

export const resolved = (t: Theme): Record<string, string> => ({ ...(builtin(t.base)?.tokens ?? BASE_TOKENS), ...t.tokens });

/**
 * Text, muted and dim must stay readable on the background and the panels, or the editor (drawn with these same tokens) could be made
 * unreadable and the person locked out of undoing it. Returns why not, or "".
 */
export function unreadable(t: Theme): string {
  const k = resolved(t);
  for (const x of ["text", "muted", "dim"]) for (const s of ["bg", "panel"]) {
    const r = contrast(k[x]!, k[s]!);
    if (r < 3) return `${tokenLabel(x)} on ${tokenLabel(s).toLowerCase()} would be ${r.toFixed(1)}:1. Below 3:1 this screen becomes unreadable, so it was not applied.`;
  }
  return "";
}

export function themeLayoutKeys(): LayoutKey[] { return Object.keys(LAYOUT) as LayoutKey[]; }

class AppearanceStore {
  cur: Theme = BUILTIN_THEMES[0]!;
  users: Theme[] = [];
  private subs = new Set<() => void>();
  private ver = 0;

  get = (): number => this.ver;
  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  private emit() { this.ver++; this.subs.forEach((fn) => fn()); }

  all(): Theme[] { return [...BUILTIN_THEMES, ...this.users]; }
  get_(id: string): Theme | null { return this.all().find((t) => t.id === id) ?? null; }

  boot(): void {
    const st = lsGet<{ items?: unknown[] } | null>("pitwall.themes", null);
    this.users = (st && Array.isArray(st.items) ? st.items : []).map((x) => {
      const s = sanitizeTheme(x);
      if (s && isObj(x) && typeof x.id === "string" && /^th-[a-z0-9]{6}$/.test(x.id)) s.id = x.id;
      return s;
    }).filter((x, i, a): x is Theme => !!x && a.findIndex((y) => y && y.id === x.id) === i);
    const a = lsGet<Record<string, unknown> | null>("pitwall.appearance", null);
    this.cur = (a && typeof a.id === "string" && builtin(a.id)) || (a && this.users.find((u) => u.id === a.id)) || (a && sanitizeTheme(a)) || BUILTIN_THEMES[0]!;
    this.apply(this.cur);
  }

  apply(t: Theme): void {
    const root = document.documentElement, s = root.style, tok = resolved(t);
    for (const [k, v] of TOKENS) s.setProperty(v, tok[k]!);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(tok.accent!.slice(i, i + 2), 16));
    s.setProperty("--acc-ink", 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 140 ? "#08090b" : "#ffffff"); // text on the accent
    const comf = t.density === "comfortable";
    s.setProperty("--row", comf ? "32px" : "28px"); s.setProperty("--trow", comf ? "28px" : "24px"); s.setProperty("--pad", comf ? "12px" : "8px"); s.setProperty("--hh", comf ? "32px" : "28px");
    s.setProperty("--fs", String(t.fontScale)); s.setProperty("--r", t.radius + "px");
    s.setProperty("--num", t.numFont === "sans" ? '"Barlow Semi Condensed", system-ui, sans-serif' : '"JetBrains Mono", ui-monospace, Consolas, monospace');
    root.dataset.panel = t.panel; root.dataset.labels = t.labels; root.dataset.num = t.numFont;
    // A theme the editor would refuse: Settings keeps the default colours, so it can always be undone from there.
    const set = document.getElementById("settings"), safe = unreadable(t);
    if (set) for (const [k, v] of TOKENS) { if (safe) set.style.setProperty(v, BASE_TOKENS[k]!); else set.style.removeProperty(v); }
    s.colorScheme = lum(tok.bg!) > 0.4 ? "light" : "dark";
    const m = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (m) m.content = tok.bg!;
    aux.bump("theme");
    this.emit();
  }

  use(id: string): void {
    const t = this.get_(id);
    if (!t) return;
    this.cur = t;
    lsSet("pitwall.appearance", t);
    this.apply(t);
  }

  uniqueName(name: string): string {
    const taken = new Set(this.all().map((t) => t.name));
    let n = name.slice(0, 40), k = 2;
    while (taken.has(n)) n = `${name.slice(0, 34)} (${k++})`;
    return n;
  }

  saveUsers(): void { lsSet("pitwall.themes", { items: this.users }); }

  copy(t: Theme, name: string): Theme {
    const c: Theme = { ...deep(t), id: newThemeId(), name: this.uniqueName(name), base: t.base };
    c.tokens = isBuiltinTheme(t.id) ? {} : { ...t.tokens };
    this.users.push(c);
    this.saveUsers();
    return c;
  }

  /** Any change to a built-in forks it first; returns the theme to change. */
  private editable(): Theme {
    if (!isBuiltinTheme(this.cur.id)) return this.cur;
    const c = this.copy(this.cur, `${this.cur.name} (custom)`);
    this.use(c.id);
    return c;
  }

  /** Returns "" when applied, or why it was refused. */
  change(fn: (t: Theme) => void): string {
    const probe = deep(this.cur);
    fn(probe);
    const why = unreadable(probe);
    if (why) return why;
    const t = this.editable();
    fn(t);
    lsSet("pitwall.appearance", t);
    this.saveUsers();
    this.apply(t);
    return "";
  }

  remove(id: string): void {
    this.users = this.users.filter((u) => u.id !== id);
    this.saveUsers();
    if (this.cur.id === id) this.use("pitwall"); else this.emit();
  }

  rename(id: string, name: string): string {
    const t = this.users.find((u) => u.id === id), n = cleanText(name, 40);
    if (!t || !n || n === t.name) return "";
    t.name = this.uniqueName(n);
    this.saveUsers();
    if (this.cur.id === t.id) lsSet("pitwall.appearance", t);
    this.emit();
    return `Renamed to '${t.name}'.`;
  }

  /** An imported theme, made this browser's; one that looks exactly like a theme already here is that theme. */
  adopt(raw: unknown): Theme | null {
    const t = sanitizeTheme(raw);
    if (!t) return null;
    const look = (x: Theme) => JSON.stringify([resolved(x), themeLayoutKeys().map((k) => x[k])]);
    const same = this.all().find((x) => look(x) === look(t));
    if (same) { if (!unreadable(same)) this.use(same.id); return same; }
    t.name = this.uniqueName(t.name);
    this.users.push(t);
    this.saveUsers();
    if (!unreadable(t)) this.use(t.id); // kept in the list, not applied: the dashboard would become unreadable
    else this.emit();
    return t;
  }

  /** The export form of a theme. */
  pack(t: Theme): Record<string, unknown> {
    const o: Record<string, unknown> = { format: "pitwall-theme", schemaVersion: 1, id: t.id, name: t.name, base: t.base, tokens: isBuiltinTheme(t.id) ? {} : t.tokens };
    for (const k of themeLayoutKeys()) o[k] = t[k];
    return o;
  }
}

export const appearance = new AppearanceStore();
export const useAppearance = (): Theme => { useSyncExternalStore(appearance.subscribe, appearance.get); return appearance.cur; };
