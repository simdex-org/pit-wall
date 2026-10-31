// One exe that carries Node, the bridge and the page and unpacks them on first start. Output: dist-portable/PitWall.exe
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const tauri = join(app, "src-tauri");
const run = (cmd, args, cwd = app) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: true });

run("node", ["scripts/prepare.mjs"]);
rmSync(join(tauri, "resources.zip"), { force: true });
run(join(process.env.SystemRoot ?? "C:\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", "resources.zip", "-C", "resources", "node", "bridge", "web", "app.json"], tauri);
run("pnpm", ["tauri", "build", "--no-bundle", "--", "--features", "portable"]);

const out = join(app, "dist-portable");
mkdirSync(out, { recursive: true });
cpSync(join(tauri, "release", "pitwall-launcher.exe"), join(out, "PitWall.exe"));
console.log(`built ${join(out, "PitWall.exe")}`);
