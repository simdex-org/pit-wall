export interface Prefs {
  ip: string;
  port: string;
  key: string;
  vjoy: boolean;
  open: boolean;
}

const STORE = "pitwall.launcher";

export const isLoopback = (ip: string): boolean => ip.startsWith("127.");

/** The first address that is not loopback; loopback when there is none. */
export function pickIp(ips: string[]): string {
  return ips.find((ip) => !isLoopback(ip)) ?? "127.0.0.1";
}

export function newKey(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** The first problem with the form, or null when it can start. */
export function validate(port: string, key: string, ip = "127.0.0.1"): string | null {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip.trim()) || ip.trim().split(".").some((n) => Number(n) > 255)) return "The address is four numbers from 0 to 255, like 192.168.1.24.";
  const n = Number(port.trim());
  if (!/^\d{1,5}$/.test(port.trim()) || n < 1 || n > 65535) return "The port is a number from 1 to 65535 (8765 if unsure).";
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(key.trim())) return "The key needs 12 to 64 letters, digits, dashes or underscores.";
  return null;
}

export function bridgeArgs(p: Prefs): string[] {
  return ["--http", `${p.ip.trim()}:${p.port.trim()}`, "--key", p.key.trim(), "--no-browser", ...(p.vjoy ? ["--vjoy"] : []), ...(p.open ? ["--open"] : [])];
}

export const linkFor = (p: Prefs): string => `http://${p.ip.trim()}:${p.port.trim()}/${p.open ? "" : `?key=${p.key.trim()}`}`;

export function loadPrefs(addresses: string[]): Prefs {
  let saved: Partial<Prefs> = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) ?? "{}"); } catch { /* private window or bad data */ }
  return {
    ip: saved.ip || pickIp(addresses),
    port: saved.port ?? "8765",
    key: saved.key && saved.key.length >= 12 ? saved.key : newKey(),
    vjoy: !!saved.vjoy,
    open: !!saved.open,
  };
}

export function savePrefs(p: Prefs): void {
  try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* storage unavailable */ }
}
