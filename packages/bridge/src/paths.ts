import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const WEB_DIR = resolve(process.env.PITWALL_WEB ?? join(ROOT, "apps", "web", "dist"));
export const TRACK_DIR = resolve(process.env.PITWALL_TRACKS ?? join(ROOT, "data", "tracks"));
export const UPDATE_DIR = resolve(process.env.PITWALL_UPDATE ?? join(ROOT, "data", "update"));
export const AC_APP_DIR = resolve(process.env.PITWALL_ACAPP ?? join(ROOT, "packages", "ac-app", "PitWall"));
