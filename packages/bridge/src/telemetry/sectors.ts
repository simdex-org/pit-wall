// --sectors: watches the sector lines while someone drives and keeps where each one is, per track, in a JSON file.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { AccPages } from "./pages.js";

export const SECTORS_FILE = "pitwall-sectors.json";

export async function recordSectors(file = SECTORS_FILE): Promise<never> {
  const pages = new AccPages();
  const saved: Record<string, number[]> = existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : {};
  const at: number[] = [];
  let track = "", prev = 0;
  console.log(`Drive over the sector lines and the finish line, then on to the next track. Saving to ${file}. Ctrl+C to stop.`);
  for (;;) {
    const r = pages.read();
    if (r.track !== track) { track = r.track; prev = r.sector; at.length = 0; }
    const n = (r.sectors || 3) - 1;
    if (track && !r.pit_lane && r.sector === prev + 1 && prev < n) { // a jump of more than one sector is not a line crossed
      at[prev] = Math.round(r.track_pos * 1e5) / 1e5;
      console.log(`${track}: sector ${prev + 1} ends at ${at[prev]}`);
      if (Array.from({ length: n }, (_, i) => at[i]).every((v) => v !== undefined)) {
        saved[track] = at.slice(0, n);
        writeFileSync(file, JSON.stringify(saved, null, 1));
        console.log(`${track}: saved ${JSON.stringify(saved[track])}`);
      }
    }
    prev = r.sector;
    await new Promise((res) => setTimeout(res, 50));
  }
}
