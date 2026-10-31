// Gathers what the installed app needs next to it: Node, the bundled bridge and the page. Output is ignored by git.
import { execFileSync, execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const out = resolve(here, "../src-tauri/resources");
const web = process.env.PITWALL_WEB_SRC ?? join(root, "apps/web/dist");

execFileSync(process.execPath, [join(root, "packages/bridge/scripts/bundle.mjs")], { stdio: "inherit" });
if (!process.env.PITWALL_WEB_SRC) execSync("pnpm --filter @pitwall/web build", { stdio: "inherit" });

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "node"), { recursive: true });
cpSync(process.execPath, join(out, "node", "node.exe"));
cpSync(join(root, "packages/bridge/dist"), join(out, "bridge"), { recursive: true });
cpSync(web, join(out, "web"), { recursive: true });
console.log(`resources ready in ${out}`);
