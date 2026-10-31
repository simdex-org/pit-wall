import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const sha = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
const { version } = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "app.json"), JSON.stringify({ version, sha, time: new Date().toISOString() }) + "\n");
