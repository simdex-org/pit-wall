import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./paths.js";
import type { Rec } from "./util.js";

const TRACKS = join(ROOT, "packages", "tracks");

// Keeps packages/tracks/tracks.json up to date after a clean lap, so no bake command is needed. Only in a repo
// checkout (an installed bridge has no such folder). A drawing already there is kept; it only gets sectors it lacks.
export async function bakeTrack(name: string, lay: Rec, file = join(TRACKS, "tracks.json")): Promise<boolean> {
  if (!name || !lay.valid || !lay.line || !existsSync(file)) return false;
  const mod = await import(pathToFileURL(join(TRACKS, "scripts", "layout.mjs")).href) as { drawingFromLayout(l: Rec): Rec | null };
  const tracks: Rec = JSON.parse(readFileSync(file, "utf-8"));
  const key = name.toLowerCase(), have = tracks[key];
  if (have) {
    if (have.sec?.length || !lay.sec?.length) return false;
    have.sec = lay.sec;
  } else {
    const d = mod.drawingFromLayout(lay);
    if (!d) return false;
    tracks[key] = d;
  }
  writeFileSync(file, JSON.stringify(tracks));
  return true;
}
