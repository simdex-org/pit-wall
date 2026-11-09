// End-to-end check of a built Pit Wall: runs the bundled bridge with the simulator and drives the page in Chromium.
// Needs `pnpm build` first. Usage: pnpm smoke [--port 18765]
import { spawn } from "node:child_process";
import { join } from "node:path";
import { chromium } from "playwright";
import { BUILTIN_TEMPLATES } from "../apps/web/src/state/builtins.ts";

const args = process.argv.slice(2);
const port = Number(args.includes("--port") ? args[args.indexOf("--port") + 1] : 18765);
const base = `http://127.0.0.1:${port}`;
const KEY = "ci-smoke-test-key";
const LIMIT_MS = 5 * 60_000;

const bridge = spawn(process.execPath, [
  join(import.meta.dirname, "..", "packages", "bridge", "dist", "bridge.mjs"),
  "--simulate-acc", "--sim-session", "practice", "--sim-speed", "8", "--key", KEY, "--no-browser", "--http", `127.0.0.1:${port}`,
], { stdio: ["ignore", "pipe", "pipe"] });
let bridgeOut = "";
bridge.stdout.on("data", (d) => { bridgeOut += d; });
bridge.stderr.on("data", (d) => { bridgeOut += d; });
bridge.on("exit", (code) => { if (code !== null) fail(`the bridge exited with code ${code}`); });

process.on("exit", () => { bridge.removeAllListeners("exit"); bridge.kill(); });
function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  if (bridgeOut) console.error(`--- bridge output ---\n${bridgeOut}`);
  process.exit(1);
}
const ok = (msg: string) => console.log(`ok   ${msg}`);
setTimeout(() => fail(`not done after ${LIMIT_MS / 1000} s`), LIMIT_MS).unref();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForPage(): Promise<string> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return await res.text();
    } catch { /* not listening yet */ }
    await sleep(500);
  }
  fail("the bridge did not serve the page within 30 s");
}

// Reads the SSE stream until `until` accepts a payload
async function stream(until: (p: Record<string, unknown>) => boolean, ms: number, what: string): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${base}/events?hz=5`, { headers: { "x-pit-key": KEY }, signal: ctrl.signal });
    if (res.status !== 200 || !res.body) fail(`/events answered ${res.status}`);
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
        const data = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
        buf = buf.slice(i + 2);
        if (!data) continue;
        const p = JSON.parse(data.slice(6)) as Record<string, unknown>;
        if (until(p)) return p;
      }
    }
  } catch (e) {
    if (!ctrl.signal.aborted) throw e;
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
  fail(`${what} within ${ms / 1000} s`);
}

const html = await waitForPage();
if (!/<div id="root">/.test(html) || !/<script[^>]+src="\/assets\//.test(html)) fail("the page is not the built web app");
ok("the page loads");

const auth = (key: string) => fetch(`${base}/auth`, { method: "POST", headers: { "x-pit-key": key } });
const wrong = await auth("not-the-right-key");
if (wrong.status !== 403) fail(`a wrong key got ${wrong.status}, expected 403`);
const right = await auth(KEY);
if (right.status !== 204 || !/pitwall_session=/.test(right.headers.get("set-cookie") ?? "")) fail(`the key got ${right.status} without a session cookie`);
const anon = await fetch(`${base}/events`);
if (anon.status !== 401) fail(`/events without a key got ${anon.status}, expected 401`);
await anon.body?.cancel();
ok("/auth: the key signs in, a wrong key gets 403, no key gets 401");

await stream((p) => !!(p.reading as { reading?: unknown } | undefined)?.reading, 15_000, "no reading on /events");
ok("/events streams a reading");

const lapped = await stream((p) => Array.isArray(p.laps) && p.laps.some((l: { ms?: number }) => (l.ms ?? 0) > 0), 120_000, "no completed lap");
ok(`a completed lap: ${(lapped.laps as { n: number; ms: number }[]).map((l) => `#${l.n} ${(l.ms / 1000).toFixed(1)} s`).join(", ")}`);

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const problems: string[] = [];
  for (const tpl of BUILTIN_TEMPLATES) {
    for (const ws of tpl.workspaces) {
      const where = `${tpl.name} / ${ws.name}`;
      const page = await context.newPage();
      page.on("pageerror", (e) => problems.push(`${where}: ${e.message}`));
      page.on("console", (m) => { if (m.type() === "error") problems.push(`${where}: console: ${m.text()}`); });
      await page.goto(`${base}/?key=${KEY}#t=${tpl.id}&w=${ws.id}`);
      const want = ws.modules.map((m) => m.type).sort();
      try {
        await page.waitForFunction((n) => document.querySelectorAll("section.mod").length === n, want.length, { timeout: 20_000 });
      } catch {
        fail(`${where}: expected ${want.length} modules, found ${await page.locator("section.mod").count()}`);
      }
      const got = (await page.locator("section.mod").evaluateAll((els) => els.map((e) => e.getAttribute("data-type") ?? ""))).sort();
      if (got.join() !== want.join()) fail(`${where}: modules ${got.join(", ")} instead of ${want.join(", ")}`);
      const missing = await page.getByText("is not available in this version").count();
      if (missing) fail(`${where}: ${missing} modules are missing from the build`);
      // give live data a moment to reach every module before reading errors
      await page.waitForTimeout(1500);
      ok(`${where}: ${want.length} modules`);
      await page.close();
    }
  }
  if (problems.length) fail(`errors in the page:\n  ${problems.join("\n  ")}`);
  ok("no errors in the page");
} finally {
  await browser.close();
}

console.log("smoke test passed");
process.exit(0);
