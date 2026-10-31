import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "dist");
rmSync(out, { recursive: true, force: true });

await build({
  entryPoints: { bridge: join(here, "../src/main.ts"), "hook-worker": join(here, "../src/pit/hook-worker.ts") },
  outdir: out,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["koffi"],
  minify: false,
  logLevel: "info",
});

// koffi loads a native binary, so it ships as files next to the bundle instead of being bundled
const pkgRoot = (file) => {
  let d = dirname(realpathSync(file));
  while (!existsSync(join(d, "package.json"))) d = dirname(d);
  return d;
};
const require = createRequire(join(here, "../package.json"));
const koffiDir = pkgRoot(require.resolve("koffi"));
const nativeDir = pkgRoot(createRequire(join(koffiDir, "package.json")).resolve("@koromix/koffi-win32-x64"));
mkdirSync(join(out, "node_modules", "@koromix"), { recursive: true });
cpSync(koffiDir, join(out, "node_modules", "koffi"), { recursive: true });
cpSync(nativeDir, join(out, "node_modules", "@koromix", "koffi-win32-x64"), { recursive: true });
