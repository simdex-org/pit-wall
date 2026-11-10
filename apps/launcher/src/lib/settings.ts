export interface Prefs {
  game: "auto" | "acc" | "ac";
  ip: string;
  port: string;
  key: string;
  open: boolean;
  // sharing the car: the code every teammate's PC uses, and teammates' IP addresses (one is enough)
  teamOn: boolean;
  teamCode: string;
  team: string;
}

const STORE = "pitwall.launcher";

export const isLoopback = (ip: string): boolean => ip.startsWith("127.");

export function pickIp(ips: string[]): string {
  return ips.find((ip) => !isLoopback(ip)) ?? "127.0.0.1";
}

export function newKey(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const ipOk = (ip: string): boolean => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split(".").every((n) => Number(n) <= 255);
const portOk = (port: string): boolean => /^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;
// 25.1.2.3, 25.1.2.3:8770, or the link a teammate's window shows
const mateOk = (s: string): boolean => {
  const m = /^(?:https?:\/\/)?([\d.]+)(?::(\d+))?\/?(?:\?.*)?$/.exec(s);
  return !!m && ipOk(m[1]!) && (m[2] === undefined || portOk(m[2]));
};
export const mates = (team: string): string[] => team.split(/[\s,]+/).filter(Boolean);
export const keyLike = (code: string): boolean => /^[A-Za-z0-9_-]{12,64}$/.test(code.trim());

export function validate(port: string, key: string, ip = "127.0.0.1", team?: { on: boolean; code: string; mates: string }): string | null {
  if (!ipOk(ip.trim())) return "The address is four numbers from 0 to 255, like 192.168.1.24.";
  if (!portOk(port.trim())) return "The port is a number from 1 to 65535 (8765 if unsure).";
  if (!keyLike(key)) return "The key needs 12 to 64 letters, digits, dashes or underscores.";
  if (team?.on && !keyLike(team.code)) return "The team code needs 12 to 64 letters, digits, dashes or underscores, the same on every teammate's PC.";
  if (team?.on && mates(team.mates).some((s) => !mateOk(s))) return "A teammate is their IP address, like 25.1.2.3, or 25.1.2.3:8770 if they use another port.";
  return null;
}

export function bridgeArgs(p: Prefs, game: "acc" | "ac" = "acc"): string[] {
  return ["--http", `${p.ip.trim()}:${p.port.trim()}`, "--key", p.key.trim(), "--no-browser", ...(p.open ? ["--open"] : []), ...(game === "ac" ? ["--game", "ac"] : []), ...(p.teamOn ? ["--team-code", p.teamCode.trim(), ...mates(p.team).flatMap((s) => ["--team", s])] : [])];
}

export const linkFor = (p: Prefs): string => `http://${p.ip.trim()}:${p.port.trim()}/${p.open ? "" : `?key=${p.key.trim()}`}`;

export function loadPrefs(addresses: string[]): Prefs {
  let saved: Partial<Prefs> = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) ?? "{}"); } catch {  }
  return {
    game: saved.game === "acc" || saved.game === "ac" ? saved.game : "auto",
    ip: saved.ip || pickIp(addresses),
    port: saved.port ?? "8765",
    key: saved.key && saved.key.length >= 12 ? saved.key : newKey(),
    open: !!saved.open,
    teamOn: saved.teamOn ?? !!saved.team,
    teamCode: typeof saved.teamCode === "string" ? saved.teamCode : "",
    team: typeof saved.team === "string" ? saved.team : "",
  };
}

export function savePrefs(p: Prefs): void {
  try { localStorage.setItem(STORE, JSON.stringify(p)); } catch {  }
}
