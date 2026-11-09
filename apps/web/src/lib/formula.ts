// A small calculator for the Custom figure module: numbers, + - * / ( ), unary minus, min max abs round,
// and names from the live data. No eval: the page's CSP forbids it, and a formula must never run code.
export type Vars = Record<string, number>;

export class FormulaError extends Error {}

const FUNCS: Record<string, (a: number[]) => number> = {
  min: (a) => Math.min(...a), max: (a) => Math.max(...a), abs: (a) => Math.abs(a[0]!),
  round: (a) => { const k = 10 ** (a[1] ?? 0); return Math.round(a[0]! * k) / k; },
};
const ARITY: Record<string, [number, number]> = { min: [1, 9], max: [1, 9], abs: [1, 1], round: [1, 2] };

// The names a formula can read, without their values: checked once when the formula changes
export function names(src: string): string[] {
  return [...new Set(tokens(src).filter((t) => /^[a-z_]/i.test(t) && !Object.hasOwn(FUNCS, t.toLowerCase())))];
}

function tokens(src: string): string[] {
  const out: string[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([a-z_][a-z0-9_]*)|([-+*/(),]))/giy;
  let at = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) { out.push(m[1] ?? m[2] ?? m[3]!); at = re.lastIndex; }
  if (src.slice(at).trim()) throw new FormulaError(`cannot read "${src.slice(at).trim().slice(0, 12)}"`);
  return out;
}

export function evaluate(src: string, vars: Vars): number {
  const t = tokens(src);
  if (!t.length) throw new FormulaError("empty formula");
  let i = 0;
  const peek = () => t[i], next = () => t[i++];
  const expect = (s: string) => { if (next() !== s) throw new FormulaError(`expected "${s}"`); };
  const expr = (): number => {
    let v = term();
    while (peek() === "+" || peek() === "-") v = next() === "+" ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (peek() === "*" || peek() === "/") v = next() === "*" ? v * factor() : v / factor();
    return v;
  };
  const factor = (): number => {
    const s = next();
    if (s === undefined) throw new FormulaError("the formula ends too early");
    if (s === "-") return -factor();
    if (s === "+") return factor();
    if (s === "(") { const v = expr(); expect(")"); return v; }
    if (/^[\d.]/.test(s)) return Number(s);
    if (!/^[a-z_]/i.test(s)) throw new FormulaError(`unexpected "${s}"`);
    const name = s.toLowerCase();
    if (Object.hasOwn(FUNCS, name)) {
      expect("(");
      const args = [expr()];
      while (peek() === ",") { next(); args.push(expr()); }
      expect(")");
      const [lo, hi] = ARITY[name]!;
      if (args.length < lo || args.length > hi) throw new FormulaError(`${name} takes ${lo === hi ? lo : `${lo} to ${hi}`} values`);
      return FUNCS[name]!(args);
    }
    if (!Object.hasOwn(vars, name)) throw new FormulaError(`unknown name "${s}"`);
    return vars[name]!;
  };
  const v = expr();
  if (i < t.length) throw new FormulaError(`unexpected "${t[i]}"`);
  return v;
}

const CORNERS = ["fl", "fr", "rl", "rr"];

// Every number in the driver's car, session and fixed data, flat: tyre arrays become name_fl ... name_rr,
// other arrays name_0, name_1 ...; true and false read as 1 and 0
export function flatten(groups: (Record<string, unknown> | null | undefined)[]): Vars {
  const out: Vars = {};
  for (const g of groups) {
    if (!g) continue;
    for (const [k, v] of Object.entries(g)) {
      const key = k.toLowerCase();
      if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
      else if (typeof v === "boolean") out[key] = v ? 1 : 0;
      else if (Array.isArray(v) && v.length <= 8) v.forEach((x, j) => { if (typeof x === "number" && Number.isFinite(x)) out[`${key}_${v.length === 4 ? CORNERS[j] : j}`] = x; });
    }
  }
  return out;
}

export type Level = 0 | 1 | 2;

// 0 fine, 1 warning, 2 critical; "above" means high values are bad, "below" low ones; a missing threshold never fires
export function level(v: number, dir: string, warn: number | null, crit: number | null): Level {
  if (!Number.isFinite(v) || (dir !== "above" && dir !== "below")) return 0;
  const past = (x: number | null) => x !== null && (dir === "above" ? v >= x : v <= x);
  return past(crit) ? 2 : past(warn) ? 1 : 0;
}
