// Pit Wall: the race engineer's dashboard for Assetto Corsa Competizione.
//
// Runs on the driver's PC. Reads ACC's shared memory and, when ACC's broadcasting port is on, the timing of the whole field.
// Serves the page plus a Server-Sent-Events stream it draws from, and, when the engineer sends a pit plan, sets it in the
// game's pit page. Sending a plan or changing the shared thresholds needs the access key printed at start; watching does not.
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { enable } from "./broadcast/config.js";
import { createBridgeServer } from "./http/server.js";
import { accLoop, startField } from "./loops.js";
import { FakeMfd } from "./pit/fake-mfd.js";
import { PIT, STATE, TEL } from "./state.js";
import { FakePages } from "./telemetry/fake-pages.js";
import { CLASSES, DEFAULT_FIELD, Field, MAX_FIELD, MIN_FIELD } from "./sim/roster.js";
import { SIM_TRACKS } from "./telemetry/sim-tracks.js";
import { Telemetry } from "./telemetry/telemetry.js";

const HELP = `Usage: pitwall-bridge [options]

  --http ADDRESS:PORT        where the page is served: this PC's VPN address and a port (default 127.0.0.1:8765, this PC only)
  --no-browser               do not open the page automatically
  --key KEY                  access key for sending pit plans and changing thresholds (default: a new one each start)
  --pit-key KEY              ACC's key for the pitstop MFD page (default p)
  --key-ms MS                how long each key is held and released, ms (default 40)
  --vjoy [N]                 press the MFD through vJoy device N (default 1) instead of the keyboard
  --simulate-acc             a pretend session, 20-car field and pit page instead of the game
  --broadcast-port PORT      ACC's broadcasting UDP port for field timing, on 127.0.0.1 only (default: updListenerPort in
                             broadcasting.json; 0 turns field timing off, also with --simulate-acc)
  --broadcast-password PW    connectionPassword for ACC's broadcasting (default: the one in broadcasting.json)
  --sim-session race|quali|practice|weekend   with --simulate-acc: a race (default), qualifying or practice, or all three in a row
  --sim-minutes N            with --simulate-acc: the session's length (race 60, practice 30, qualifying 12 or more by default)
  --sim-track TRACK          with --simulate-acc: the made-up circuit (default: demo) or a real layout at a GT3's pace:
                             ${Object.keys(SIM_TRACKS).join(", ")}
  --sim-cars N               with --simulate-acc: how many cars in the field, ${MIN_FIELD} to ${MAX_FIELD} (default ${DEFAULT_FIELD.cars})
  --sim-classes MIX          with --simulate-acc: the share of each class, e.g. GT3=60,GT4=25,GTC=10,GT2=5 (classes: ${CLASSES.join(", ")}; default GT3=80,GT4=20)
  --sim-pace N               with --simulate-acc: how fast your driver is, 1 (back of the field) to 5 (front); default: random like the rest
  --sim-grid N|random        with --simulate-acc: your grid slot in a race (1 is pole); default: where your pace puts you. Not used in a weekend race
  --sim-speed N              with --simulate-acc: run the pretend session N times faster (e.g. 8)
  --control-stdin            exit cleanly when a line "quit" arrives on stdin (the launcher stops the bridge this way)

  --enable-broadcast [PORT]  once, ACC closed: switch ACC's broadcasting port on in broadcasting.json, then exit
  --info                     print this PC's addresses and ACC's broadcasting port as JSON, then exit
  --probe                    print the not-yet-verified shared-memory fields once a second from a live session
  --bind-vjoy [N]            help bind ACC's MFD actions to vJoy buttons 1-6, then exit
`;

/** `--vjoy` and the other optional-number flags may stand alone: give them their default. */
function normalize(argv: string[]): string[] {
  const out: string[] = [];
  const optionalNumber = new Set(["--vjoy", "--bind-vjoy", "--enable-broadcast"]);
  argv.forEach((a, i) => {
    out.push(a);
    if (optionalNumber.has(a) && !/^\d+$/.test(argv[i + 1] ?? "")) out.push(a === "--enable-broadcast" ? "9000" : "1");
  });
  return out;
}

function fail(msg: string): never {
  console.error(`pitwall-bridge: ${msg}`);
  process.exit(2);
}

async function main(): Promise<void> {
  let v;
  try {
    v = parseArgs({
      args: normalize(process.argv.slice(2)),
      options: {
        http: { type: "string", default: "127.0.0.1:8765" }, "no-browser": { type: "boolean" }, key: { type: "string" },
        "pit-key": { type: "string", default: "p" }, "key-ms": { type: "string", default: "40" }, vjoy: { type: "string" },
        "simulate-acc": { type: "boolean" }, "broadcast-port": { type: "string" }, "broadcast-password": { type: "string" },
        "sim-session": { type: "string", default: "race" }, "sim-track": { type: "string", default: "demo" }, "sim-speed": { type: "string", default: "1" }, "sim-minutes": { type: "string" }, "sim-cars": { type: "string" }, "sim-pace": { type: "string" }, "sim-grid": { type: "string" }, "sim-classes": { type: "string" },
        "control-stdin": { type: "boolean" }, "enable-broadcast": { type: "string" }, info: { type: "boolean" }, probe: { type: "boolean" }, "bind-vjoy": { type: "string" }, "update-check": { type: "boolean" }, update: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }).values;
  } catch (e) { return fail((e as Error).message); }
  if (v.help) return void console.log(HELP);

  if (v.info) return void console.log(JSON.stringify(await info()));
  if (v["enable-broadcast"] !== undefined) return void console.log(enable(Number(v["enable-broadcast"])));
  if (v["update-check"] || v.update) {
    const u = await import("./update.js");
    try {
      return void console.log(v.update ? JSON.stringify({ file: await u.download() }) : JSON.stringify(await u.check()));
    } catch (e) {
      const cause = (e as { cause?: { message?: string } }).cause?.message;
      console.error([(e as Error).message, cause].filter(Boolean).join(": "));
      process.exit(1);
    }
  }
  if (v.probe) { const { probe } = await import("./telemetry/pages.js"); return void (await probe()); }
  if (v["bind-vjoy"] !== undefined) { const { bindVjoy } = await import("./pit/vjoy.js"); return void (await bindVjoy(Number(v["bind-vjoy"]))); }

  const simulate = !!v["simulate-acc"];
  const [, hh = "", hp = ""] = /^(.*):(\d+)$/.exec(v.http!) ?? [];
  if (!hh || !hp) return fail("--http must be ADDRESS:PORT, e.g. --http 25.1.2.3:8765");
  const simSession = v["sim-session"];
  if (simSession !== "race" && simSession !== "quali" && simSession !== "practice" && simSession !== "weekend") return fail("--sim-session must be race, quali, practice or weekend");
  const simMinutes = v["sim-minutes"] === undefined ? undefined : Number(v["sim-minutes"]);
  if (simMinutes !== undefined && !(simMinutes >= 3 && simMinutes <= 1440)) return fail("--sim-minutes must be 3 to 1440");
  const cars = v["sim-cars"] === undefined ? DEFAULT_FIELD.cars : Number(v["sim-cars"]);
  if (!Number.isInteger(cars) || cars < MIN_FIELD || cars > MAX_FIELD) return fail(`--sim-cars must be ${MIN_FIELD} to ${MAX_FIELD}`);
  const mix: Record<string, number> = {};
  for (const part of (v["sim-classes"] ?? "").split(/[,\s]+/).filter(Boolean)) {
    const [cls, share] = part.split("=");
    if (!CLASSES.includes(cls!.toUpperCase()) || !(Number(share) > 0)) return fail(`--sim-classes: "${part}" is not CLASS=SHARE with a class of ${CLASSES.join(", ")}`);
    mix[cls!.toUpperCase()] = Number(share);
  }
  const pace = v["sim-pace"] === undefined ? undefined : Number(v["sim-pace"]);
  if (pace !== undefined && !(Number.isInteger(pace) && pace >= 1 && pace <= 5)) return fail("--sim-pace must be 1 to 5");
  const gridArg = v["sim-grid"];
  const grid = gridArg === undefined ? undefined : gridArg === "random" ? "random" : Number(gridArg);
  if (grid !== undefined && grid !== "random" && !(Number.isInteger(grid) && grid >= 1 && grid <= cars)) return fail(`--sim-grid must be random or 1 to ${cars}`);
  const field: Field = { cars, mix: Object.keys(mix).length ? mix : DEFAULT_FIELD.mix, pace, grid };
  const simTrack = v["sim-track"]!;
  if (simTrack !== "demo" && !(simTrack in SIM_TRACKS)) return fail(`--sim-track must be demo or one of ${Object.keys(SIM_TRACKS).join(", ")}`);
  const key = v.key ?? randomBytes(16).toString("base64url");

  PIT.key = key;
  const fakeMfd = new FakeMfd();
  try {
    if (simulate) PIT.mfd = fakeMfd;
    else { const { AccMfd } = await import("./pit/acc-mfd.js"); PIT.mfd = new AccMfd(v["pit-key"], Number(v["key-ms"]), v.vjoy === undefined ? undefined : Number(v.vjoy)); }
  } catch (e) { console.log(`pit control off: ${(e as Error).message}`); } // not Windows (no named mappings / user32), a bad --pit-key, or no vJoy

  let pages: FakePages | null = null;
  try {
    const t0 = performance.now() / 1000, k = Math.max(0.1, Number(v["sim-speed"]));
    const clock = simulate ? () => t0 + (performance.now() / 1000 - t0) * k : () => performance.now() / 1000; // the pretend session's own time
    let src;
    if (simulate) src = pages = new FakePages({ session: simSession === "quali" ? 1 : simSession === "practice" ? 0 : 2, minutes: simMinutes, weekend: simSession === "weekend", clock, track: simTrack === "demo" ? undefined : simTrack, mfd: fakeMfd, field });
    else { const { AccPages } = await import("./telemetry/pages.js"); src = new AccPages(); }
    TEL.t = new Telemetry(STATE.config, clock);
    void accLoop(src, TEL.t, simulate);
  } catch (e) { console.log(`telemetry off: ${(e as Error).message}`); } // not Windows: no named shared memory
  startField({ simulateAcc: simulate, simSession, broadcastPort: v["broadcast-port"] === undefined ? undefined : Number(v["broadcast-port"]),
    broadcastPassword: v["broadcast-password"] }, pages);

  const server = createBridgeServer();
  server.on("error", (e: NodeJS.ErrnoException) => {
    console.log(`Cannot serve on ${v.http}: ${e.message}`);
    if (e.code === "EADDRINUSE" || e.code === "EACCES") {
      console.log(`Port ${hp} is in use or reserved: another bridge or program has it, or Windows reserves it (netsh int ipv4 show excludedportrange tcp). Pass another port, e.g. --http ${hh}:${Number(hp) + 1}`);
    } else if (e.code === "EADDRNOTAVAIL") {
      console.log("That address is not one of this PC's. Use this PC's own VPN address (Hamachi's is 25.x.x.x):");
      for (const ip of myAddresses()) console.log(`    pitwall-bridge --http ${ip}:${hp}`);
    }
    process.exit(1);
  });

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    FIELD_CLOSE();
    PIT.mfd?.close?.();
    server.close();
    setTimeout(() => process.exit(0), 200).unref(); // the unregister message goes out first
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  if (v["control-stdin"]) createInterface({ input: process.stdin }).on("line", (l) => { if (l.trim() === "quit") shutdown(); }).on("close", shutdown);

  server.listen({ host: hh, port: Number(hp), exclusive: true }, () => {
    console.log(`Pit Wall on ${v.http}   (Ctrl+C to stop)`);
    if (hh === "127.0.0.1" || hh === "localhost") {
      console.log("Only this PC can open it. For the engineer, start it on your VPN address (Hamachi's is 25.x.x.x):");
      for (const ip of myAddresses()) console.log(`    pitwall-bridge --http ${ip}:${hp}`);
    } else console.log(`Engineer, open:   http://${hh}:${hp}/?key=${key}`);
    if (!v["no-browser"]) {
      const url = `http://${hh === "0.0.0.0" ? "127.0.0.1" : hh}:${hp}/?key=${key}`;
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    }
  });
}

async function info() {
  let broadcastPort = 0;
  try { broadcastPort = (await import("./broadcast/config.js")).readConfig().port; } catch { /* ACC has not written it yet */ }
  return { addresses: myAddresses(), hamachi: hamachiAddress(), broadcastPort };
}

/** This PC's IPv4 addresses, Hamachi's (25.x) first. */
function myAddresses(): string[] {
  const ips = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a!.address);
  return [...new Set(ips)].sort((a, b) => Number(!a.startsWith("25.")) - Number(!b.startsWith("25.")));
}

/** The address of the Hamachi adapter: found by its name, else by the 25.x range. */
function hamachiAddress(): string {
  const all = Object.entries(networkInterfaces()).flatMap(([name, list]) => (list ?? []).filter((a) => a.family === "IPv4").map((a) => ({ name, ip: a.address })));
  return (all.find((a) => /hamachi/i.test(a.name)) ?? all.find((a) => a.ip.startsWith("25.")))?.ip ?? "";
}

import { FIELD } from "./state.js";
const FIELD_CLOSE = () => FIELD.src?.close();

main().catch((e) => { console.error(e); process.exit(1); });
