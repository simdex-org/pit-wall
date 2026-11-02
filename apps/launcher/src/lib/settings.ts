export interface Prefs {
  ip: string;
  port: string;
  key: string;
  vjoy: boolean;
  open: boolean;
  sim: boolean;
  simSession: string;
  simTrack: string;
  simMinutes: string;
  simCars: string;
  simClasses: string;
  simPace: string;
  simGrid: string;
  simSpeed: string;
}

export const SIM_TRACKS = ["demo", "nordschleife", "monza", "spa", "silverstone", "nurburgring", "brands_hatch", "suzuka", "laguna_seca", "mount_panorama", "imola", "barcelona", "zandvoort", "paul_ricard", "hungaroring", "misano", "zolder", "kyalami", "cota", "indianapolis", "watkins_glen", "red_bull_ring", "valencia", "donington", "oulton_park", "snetterton"];

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

const simArgs = (p: Prefs): string[] => !p.sim ? [] : [
  "--simulate-acc", "--sim-session", p.simSession, "--sim-track", p.simTrack, "--sim-speed", p.simSpeed.trim() || "1",
  ...([["--sim-minutes", p.simMinutes], ["--sim-cars", p.simCars], ["--sim-classes", p.simClasses], ["--sim-pace", p.simPace], ["--sim-grid", p.simGrid]] as const)
    .flatMap(([flag, v]) => (v.trim() ? [flag, v.trim()] : [])),
];

export function bridgeArgs(p: Prefs): string[] {
  return ["--http", `${p.ip.trim()}:${p.port.trim()}`, "--key", p.key.trim(), "--no-browser", ...(p.vjoy ? ["--vjoy"] : []), ...(p.open ? ["--open"] : []), ...simArgs(p)];
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
    sim: !!saved.sim,
    simSession: saved.simSession ?? "race",
    simTrack: saved.simTrack ?? "demo",
    simMinutes: saved.simMinutes ?? "",
    simCars: saved.simCars ?? "20",
    simClasses: saved.simClasses ?? "",
    simPace: saved.simPace ?? "",
    simGrid: saved.simGrid ?? "",
    simSpeed: saved.simSpeed ?? "1",
  };
}

export function savePrefs(p: Prefs): void {
  try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* storage unavailable */ }
}
