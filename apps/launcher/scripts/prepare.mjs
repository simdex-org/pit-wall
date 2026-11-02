// Gathers what the installed app needs next to it: Node, the bundled bridge and the page. Output is ignored by git.
import { execFileSync, execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rcedit } from "rcedit";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const out = resolve(here, "../src-tauri/resources");
const web = process.env.PITWALL_WEB_SRC ?? join(root, "apps/web/dist");

execFileSync(process.execPath, [join(root, "packages/bridge/scripts/bundle.mjs")], { stdio: "inherit" });
if (!process.env.PITWALL_WEB_SRC) execSync("pnpm --filter @pitwall/web build", { stdio: "inherit" });

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "node"), { recursive: true });
cpSync(process.execPath, join(out, "node", "node.exe"));
// The Windows Firewall prompt shows the exe's description, publisher and icon.
await rcedit(join(out, "node", "node.exe"), {
  icon: resolve(here, "../src-tauri/icons/icon.ico"),
  "version-string": { FileDescription: "Pit Wall", ProductName: "Pit Wall", CompanyName: "Simdex", InternalName: "Pit Wall", OriginalFilename: "node.exe" },
});
cpSync(join(root, "packages/bridge/dist"), join(out, "bridge"), { recursive: true });
cpSync(web, join(out, "web"), { recursive: true });
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const sha = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
writeFileSync(join(out, "app.json"), JSON.stringify({ version, sha, time: new Date().toISOString() }) + "\n");
console.log(`resources ready in ${out}`);
