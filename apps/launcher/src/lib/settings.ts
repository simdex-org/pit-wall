export interface Prefs {
  ip: string;
  port: string;
  key: string;
  vjoy: boolean;
}

const STORE = "pitwall.launcher";

/** Hamachi's 25.x first, then Radmin VPN's 26.x, then any other address; loopback when there is none. */
export function pickIp(ips: string[]): string {
  const usable = ips.filter((ip) => !ip.startsWith("127."));
  const rank = (ip: string) => (ip.startsWith("25.") ? 0 : ip.startsWith("26.") ? 1 : 2);
  return [...usable].sort((a, b) => rank(a) - rank(b))[0] ?? "127.0.0.1";
}

export function vpnName(ip: string): string {
  return ip.startsWith("25.") ? "Hamachi" : ip.startsWith("26.") ? "Radmin VPN" : "";
}

export function newKey(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** The first problem with the form, or null when it can start. */
export function validate(port: string, key: string, ip = "127.0.0.1"): string | null {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip.trim()) || ip.trim().split(".").some((n) => Number(n) > 255)) return "The address is four numbers from 0 to 255, like 25.1.2.3.";
  const n = Number(port.trim());
  if (!/^\d{1,5}$/.test(port.trim()) || n < 1 || n > 65535) return "The port is a number from 1 to 65535 (8765 if unsure).";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(key.trim())) return "The key needs 4 to 64 letters, digits, dashes or underscores.";
  return null;
}

export function bridgeArgs(p: Prefs): string[] {
  return ["--http", `${p.ip.trim()}:${p.port.trim()}`, "--key", p.key.trim(), "--no-browser", ...(p.vjoy ? ["--vjoy"] : [])];
}

export const linkFor = (p: Prefs): string => `http://${p.ip.trim()}:${p.port.trim()}/?key=${p.key.trim()}`;

export function loadPrefs(addresses: string[]): Prefs {
  let saved: Partial<Prefs> = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) ?? "{}"); } catch { /* private window or bad data */ }
  return {
    ip: saved.ip || pickIp(addresses),
    port: saved.port ?? "8765",
    key: saved.key || newKey(),
    vjoy: !!saved.vjoy,
  };
}

export function savePrefs(p: Prefs): void {
  try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* storage unavailable */ }
}
