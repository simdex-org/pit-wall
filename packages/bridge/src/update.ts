import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UPDATE_DIR } from "./paths.js";

const BASE = "https://github.com/simdex-org/pit-wall/releases/download/edge";

export interface Stamp { sha: string; time: string }

export function parseStamp(raw: unknown): Stamp | null {
  const s = raw as Partial<Stamp> | null;
  return typeof s?.sha === "string" && typeof s.time === "string" && !Number.isNaN(Date.parse(s.time)) ? { sha: s.sha, time: s.time } : null;
}

/** The build this bridge belongs to; null when run from source, where there is nothing to update. */
export function installed(): Stamp | null {
  try { return parseStamp(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "app.json"), "utf8"))); } catch { return null; }
}

export const isNewer = (have: Stamp | null, latest: Stamp) => have !== null && Date.parse(latest.time) > Date.parse(have.time);

class NotPublished extends Error {}

async function get(name: string): Promise<Response> {
  const res = await fetch(`${BASE}/${name}`, { headers: { "cache-control": "no-cache" } });
  if (res.status === 404) throw new NotPublished(name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res;
}

export async function check(): Promise<{ available: boolean; installed: string | null; latest: string | null }> {
  const have = installed();
  try {
    const latest = parseStamp(await (await get("app.json")).json());
    if (!latest) throw new Error("app.json is not a build stamp");
    return { available: isNewer(have, latest), installed: have?.time ?? null, latest: latest.time };
  } catch (e) {
    if (e instanceof NotPublished) return { available: false, installed: have?.time ?? null, latest: null };
    throw e;
  }
}

export async function install(): Promise<string> {
  const staging = UPDATE_DIR + ".new";
  const zip = staging + ".zip";
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  writeFileSync(zip, Buffer.from(await (await get("app.zip")).arrayBuffer()));
  const tar = join(process.env.SystemRoot ?? "C:\Windows", "System32", "tar.exe");
  execFileSync(existsSync(tar) ? tar : "tar", ["-xf", zip, "-C", staging]);
  rmSync(zip, { force: true });
  const stamp = parseStamp(JSON.parse(readFileSync(join(staging, "app.json"), "utf8")));
  if (!stamp || !existsSync(join(staging, "bridge", "bridge.mjs")) || !existsSync(join(staging, "web", "index.html"))) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error("the download is incomplete");
  }
  rmSync(UPDATE_DIR, { recursive: true, force: true });
  renameSync(staging, UPDATE_DIR);
  return stamp.time;
}
