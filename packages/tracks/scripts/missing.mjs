// Lists the tracks that still have no sector lines, in tracks.json or in the bridge's saved layouts.
// Usage: node scripts/missing.mjs [folder of the bridge's saved layouts]
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const layouts = process.argv[2];
const tracks = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "tracks.json"), "utf-8"));
const has = (name) => {
  if (tracks[name].sec?.length) return true;
  const f = layouts && join(layouts, name + ".json");
  return !!f && existsSync(f) && !!JSON.parse(readFileSync(f, "utf-8")).sec?.length;
};
const todo = Object.keys(tracks).filter((n) => !has(n));
console.log(todo.length ? `${todo.length} without sectors:\n${todo.join("\n")}` : "every track has sectors");
