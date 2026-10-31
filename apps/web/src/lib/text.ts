export const isObj = (o: unknown): o is Record<string, any> => !!o && typeof o === "object" && !Array.isArray(o); // eslint-disable-line @typescript-eslint/no-explicit-any

export const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Control characters out, trimmed and cut to n. */
export const cleanText = (s: unknown, n: number): string =>
  typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, n) : "";

export const deep = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

export const slug = (s: string): string =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pitwall";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function newId(prefix: "t-" | "m-"): string {
  const n = prefix === "t-" ? 10 : 6;
  const a = crypto.getRandomValues(new Uint8Array(n));
  return prefix + Array.from(a, (b) => ALPHABET[b % 36]).join("");
}
