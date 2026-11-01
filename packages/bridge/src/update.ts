import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UPDATE_DIR } from "./paths.js";

const LATEST = "https://api.github.com/repos/simdex-org/pit-wall/releases/latest";

interface Asset { name: string; size: number; browser_download_url: string }
export interface Release { version: string; assets: Asset[] }

/** The version this bridge belongs to; null when run from source, where there is nothing to update. */
export function installed(): string | null {
  try {
    const v = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "app.json"), "utf8")).version;
    return typeof v === "string" ? v : null;
  } catch { return null; }
}

const parts = (v: string) => v.replace(/^v/, "").split(".").map(Number);

export function isNewer(have: string | null, latest: string): boolean {
  if (have === null) return false;
  const [a, b] = [parts(have), parts(latest)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

/** The installer is Pit.Wall_x.y.z_x64-setup.exe; the portable build is PitWall.exe (PitWall-portable.exe in v0.1.x). */
export function pick(assets: Asset[], portable: boolean): Asset | undefined {
  return assets.find((a) => (portable ? /^PitWall(-portable)?\.exe$/ : /-setup\.exe$/).test(a.name));
}

export function parseRelease(raw: unknown): Release | null {
  const r = raw as { tag_name?: unknown; assets?: unknown } | null;
  if (typeof r?.tag_name !== "string" || !Array.isArray(r.assets)) return null;
  return { version: r.tag_name.replace(/^v/, ""), assets: r.assets.filter((a): a is Asset => typeof a?.name === "string" && typeof a.browser_download_url === "string" && typeof a.size === "number") };
}

async function latest(): Promise<Release | null> {
  const res = await fetch(LATEST, { headers: { accept: "application/vnd.github+json", "user-agent": "pitwall" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub: HTTP ${res.status}`);
  const release = parseRelease(await res.json());
  if (!release) throw new Error("GitHub sent an unexpected release");
  return release;
}

const isPortable = () => process.env.PITWALL_PORTABLE === "1";

export async function check(): Promise<{ available: boolean; installedVersion: string | null; latestVersion: string | null }> {
  const have = installed();
  const release = await latest();
  if (!release) return { available: false, installedVersion: have, latestVersion: null };
  return { available: isNewer(have, release.version) && !!pick(release.assets, isPortable()), installedVersion: have, latestVersion: release.version };
}

/** Downloads the installer or the portable exe of the latest release and returns where it was saved. */
export async function download(): Promise<string> {
  const release = await latest();
  const asset = release && pick(release.assets, isPortable());
  if (!asset) throw new Error(`the latest release has no ${isPortable() ? "portable" : "installer"} file`);
  const res = await fetch(asset.browser_download_url);
  if (!res.ok) throw new Error(`${asset.name}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length !== asset.size) throw new Error("the download is incomplete");
  rmSync(UPDATE_DIR, { recursive: true, force: true });
  mkdirSync(UPDATE_DIR, { recursive: true });
  const file = join(UPDATE_DIR, asset.name);
  writeFileSync(file + ".part", bytes);
  renameSync(file + ".part", file);
  return file;
}
