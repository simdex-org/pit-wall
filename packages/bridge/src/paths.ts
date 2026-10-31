// Where things live, relative to this package, so nothing else hard-codes a path.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** The page the bridge serves: the built web app, unless the launcher points to its own copy. */
export const WEB_DIR = resolve(process.env.PITWALL_WEB ?? join(ROOT, "apps", "web", "dist"));
/** Layouts learned from the driver's own laps, kept between sessions. */
export const TRACK_DIR = resolve(process.env.PITWALL_TRACKS ?? join(ROOT, "data", "tracks"));
/** Where a downloaded build is kept; the launcher prefers it over the one it was installed with. */
export const UPDATE_DIR = resolve(process.env.PITWALL_UPDATE ?? join(ROOT, "data", "update"));
