import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const sha = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "app.json"), JSON.stringify({ sha, time: new Date().toISOString() }) + "\n");
