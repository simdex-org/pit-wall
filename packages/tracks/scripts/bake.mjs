import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drawingFromLayout } from "./layout.mjs";

// Bakes the tracks the bridge saved while you drove (or learned from the game) into tracks.json, sectors included.
// A track already in tracks.json is kept as it is, but gets its sectors if it has none; --force replaces it.
const args = process.argv.slice(2), force = args.includes("--force"), watch = args.includes("--watch");
const here = dirname(fileURLToPath(import.meta.url));
const folder = args.find((a) => !a.startsWith("--")) ?? join(here, "..", "..", "..", "data", "tracks");
if (!existsSync(folder)) { console.error(`No folder ${folder}. Give the bridge's saved layouts (the launcher keeps them in %APPDATA%/org.simdex.pitwall/tracks).`); process.exit(1); }
const file = join(here, "..", "tracks.json");
const seen = new Map();

function bake() {
  const tracks = JSON.parse(readFileSync(file, "utf-8"));
  let added = 0, sectors = 0;
  for (const f of readdirSync(folder).filter((n) => n.endsWith(".json"))) {
    const stamp = statSync(join(folder, f)).mtimeMs;
    if (seen.get(f) === stamp) continue;
    seen.set(f, stamp);
    const lay = JSON.parse(readFileSync(join(folder, f), "utf-8"));
    const name = String(lay.track ?? "").toLowerCase();
    if (!name) continue;
    if (tracks[name] && !force) {
      if (!tracks[name].sec?.length && lay.sec?.length) { tracks[name].sec = lay.sec; sectors++; console.log(`${name}: sectors added`); }
      else console.log(`${name}: already in tracks.json`);
      continue;
    }
    const d = drawingFromLayout(lay);
    if (!d) { console.log(`skipped ${name}: not a whole lap yet`); continue; }
    tracks[name] = d; added++;
    console.log(`${name}: ${d.loop.length} points${d.sec.length ? ", sectors" : ", no sectors yet"}`);
  }
  if (added || sectors) { writeFileSync(file, JSON.stringify(tracks)); console.log(`${added} tracks added, sectors added to ${sectors}`); }
}

bake();
if (watch) {
  console.log(`Watching ${folder}. Drive with the bridge running; Ctrl+C to stop.`);
  setInterval(() => { try { bake(); } catch (e) { console.log(e.message); } }, 3000);
}
