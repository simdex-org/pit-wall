import { createServer, Server } from "node:http";
import { importTrack } from "../ac-track.js";
import { Rec } from "../util.js";
import type { BroadcastState, FieldSource, Sink } from "./client.js";
import { RACE } from "./models.js";

export const PLUGIN_PORT = 9877;
const QUALI = 4;

interface Seen { track: string; ids: string; names: Map<number, string> }

const lap = (ms: number, car: number, valid = true): Rec => ({ ms: ms > 0 ? ms : null, car, drv: 0, s: [null, null, null], valid, out: false, in: false });

// The Pit Wall app inside Assetto Corsa sends every car about four times a second; this turns one packet into the
// messages ACC's broadcasting would have sent, so Field does not know the difference.
export function toMessages(p: Rec, hint: Rec | null, seen: Seen): [number, Rec][] {
  const out: [number, Rec][] = [];
  const cars: Rec[] = Array.isArray(p.cars) ? p.cars : [];
  const track = `${p.track}|${p.config}`;
  if (track !== seen.track) {
    seen.track = track;
    out.push([5, { conn: 1, name: [p.track, p.config].filter(Boolean).join(" "), id: 0, meters: Math.trunc(hint?.len || 0) }]);
  }
  const ids = cars.map((c) => c.i).join();
  if (ids !== seen.ids) { seen.ids = ids; out.push([4, { conn: 1, cars: cars.map((c) => c.i) }]); }
  for (const c of cars) {
    const name = `${c.name}|${c.car}`;
    if (seen.names.get(c.i) === name) continue;
    seen.names.set(c.i, name);
    const [first = "", ...rest] = String(c.name).split(" ");
    const last = rest.join(" ");
    out.push([6, { i: c.i, model: -1, team: String(c.car), num: c.i, cup: 0, cur_drv: 0, nat: 0,
      drivers: [{ first, last, short: (last || first).slice(0, 3).toUpperCase(), dcat: 1, nat: 0 }] }]);
  }
  const type = hint?.session === 2 ? RACE : hint?.session === 1 ? QUALI : 0;
  // the game's own position number does not move with the cars, so the order is worked out here
  const key2 = (c: Rec): number => (type === RACE ? -(c.laps + c.spl) : c.best > 0 ? c.best : Infinity);
  const pos = new Map([...cars].sort((a, b) => key2(a) - key2(b) || a.i - b.i).map((c, k) => [c.i as number, k + 1]));
  out.push([2, { event_idx: 0, session_idx: hint?.sidx ?? 0, type, phase: 5, time_ms: p.t * 1000, end_ms: 0, focus: 0, replay: false, tod_ms: 0,
    air: 0, track: 0, clouds: 0, rain: 0, wet: 0, best: lap(0, 0) }]);
  for (const c of cars) {
    out.push([3, { i: c.i, drv: 0, drivers: 1, gear: c.gear - 1, x: c.x, y: c.z, yaw: 0, loc: c.pit ? 2 : 1, kmh: Math.round(c.kmh), pos: pos.get(c.i), cpos: pos.get(c.i),
      tpos: pos.get(c.i), spl: c.spl, laps: c.laps, delta: 0, best: lap(c.best, c.i), last: lap(c.last, c.i), cur: lap(c.cur, c.i, !c.inv) }]);
  }
  return out;
}

// The latest packet from the app; the shared-memory reader takes what AC's memory lacks or gets wrong from here
export const PLUGIN: { at: number; cars: Rec[]; flag: number; ses: number; left: number; p: Rec } = { at: 0, cars: [], flag: 0, ses: 0, left: 0, p: {} };

export function withPlugin(r: Rec, now = Date.now()): Rec {
  const own = now - PLUGIN.at < 1500 ? PLUGIN.cars.find((c) => c.i === 0) : undefined;
  if (!own) return r;
  const g = [...r.g_flags];
  g[4] = PLUGIN.flag === 4 ? 1 : 0; g[6] = PLUGIN.flag === 5 ? 1 : 0; g[0] = PLUGIN.flag === 2 ? 1 : 0;
  return { ...r, me: 0, xyz: [own.x, 0, own.z], track_pos: own.spl, coords: Object.fromEntries(PLUGIN.cars.map((c) => [c.i, [c.x, c.z]])),
    flag: PLUGIN.flag, g_flags: g, session: PLUGIN.ses, time_left: PLUGIN.left,
    valid: PLUGIN.p.valid ?? 1, water: PLUGIN.p.wtemp ?? 0, wind: PLUGIN.p.wind ?? 0, wind_dir: PLUGIN.p.wdir ?? 0,
    rain: Array(3).fill(Math.round(Math.min(1, PLUGIN.p.rain ?? 0) * 5)) };
}

export class AcPlugin implements FieldSource {
  state: BroadcastState = { state: "waiting", msg: "Waiting for the Pit Wall app in Assetto Corsa: switch it on in the in-game app bar", port: PLUGIN_PORT };
  private srv: Server | null = null;
  private timer: NodeJS.Timeout | null = null;
  private heard = 0;
  private aiKey = "";

  constructor(private hint: () => Rec | null, private port = PLUGIN_PORT) { this.state.port = port; }

  start(sink: Sink): void {
    const seen: Seen = { track: "", ids: "", names: new Map() };
    // loopback only; the custom header makes a browser page unable to post here
    const srv = (this.srv = createServer((req, res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => { size += c.length; if (size < 1 << 20) chunks.push(c); });
      req.on("end", () => {
        const ok = req.method === "POST" && req.url === "/state" && req.headers["x-pit-source"] === "ac" && size < 1 << 20;
        res.writeHead(ok ? 204 : 403).end();
        if (ok) this.packet(Buffer.concat(chunks).toString("utf-8"), seen, sink);
      });
    }));
    srv.on("error", (e) => { this.state = Object.assign(this.state, { state: "error", msg: `Pit Wall app port ${this.port}: ${e.message}` }); });
    srv.listen(this.port, "127.0.0.1");
    this.timer = setInterval(() => {
      if (this.state.state === "live" && Date.now() - this.heard > 3000) Object.assign(this.state, { state: "waiting", msg: "The Pit Wall app stopped sending" });
    }, 1000);
  }

  private packet(text: string, seen: Seen, sink: Sink): void {
    let p: Rec;
    try { p = JSON.parse(text); } catch { return; }
    if (p.v !== 1 || !Array.isArray(p.cars)) return;
    this.heard = PLUGIN.at = Date.now();
    Object.assign(PLUGIN, { cars: p.cars, flag: p.flag | 0, ses: p.ses | 0, left: Number(p.left) || 0, p });
    Object.assign(this.state, { state: "live", msg: "Pit Wall app in Assetto Corsa" });
    const key = `${p.root}|${p.track}|${p.config}`;
    if (p.root && key !== this.aiKey) { this.aiKey = key; importTrack(p.root, p.track, p.config, [p.track, p.config].filter(Boolean).join(" ")); }
    for (const [kind, d] of toMessages(p, this.hint(), seen)) sink(kind, d);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    try { this.srv?.close(); } catch {  }
    this.srv = null;
  }
}
