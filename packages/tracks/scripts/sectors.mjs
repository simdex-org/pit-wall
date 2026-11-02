// Puts the sector lines from files made by the bridge's --sectors into tracks.json.
// Usage: node scripts/sectors.mjs <pitwall-sectors.json> [more files]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "tracks.json");
const tracks = JSON.parse(readFileSync(file, "utf-8"));
for (const f of process.argv.slice(2)) {
  for (const [name, sec] of Object.entries(JSON.parse(readFileSync(f, "utf-8")))) {
    const key = name.toLowerCase();
    if (!tracks[key]) { console.log(`unknown track ${name}`); continue; }
    tracks[key].sec = sec;
    console.log(`${key}: ${JSON.stringify(sec)}`);
  }
}
writeFileSync(file, JSON.stringify(tracks));
