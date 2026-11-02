// Rebuilds tracks.json from ACC's own racing lines.
// Usage: node scripts/build.mjs <ACC folder>/AC2/Content/Cache [folder of the bridge's saved layouts]
// The saved layouts add the sector lines, which only a driven lap knows.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drawingFrom } from "./layout.mjs";

const [cache, layouts] = process.argv.slice(2);
if (!cache) { console.error("Give ACC's AC2/Content/Cache folder."); process.exit(1); }
const file = join(dirname(fileURLToPath(import.meta.url)), "..", "tracks.json");
const tracks = JSON.parse(readFileSync(file, "utf-8"));
for (const name of readdirSync(cache)) {
  const src = join(cache, name, "fastlane.ai");
  if (!existsSync(src)) continue;
  const lay = layouts && existsSync(join(layouts, name + ".json")) ? JSON.parse(readFileSync(join(layouts, name + ".json"), "utf-8")) : null;
  const d = drawingFrom(readFileSync(src), lay);
  if (!d) { console.log(`skipped ${name}: not a whole lap`); continue; }
  tracks[name] = d;
  console.log(`${name}: ${d.loop.length} points${d.sec.length ? ", sectors" : ""}`);
}
writeFileSync(file, JSON.stringify(tracks));
