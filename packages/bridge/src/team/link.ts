import { randomBytes } from "node:crypto";
import { request as httpRequest, IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { log, STATE } from "../state.js";
import { isObj, Rec } from "../util.js";

export interface Reply { status: number; text: string }
type OnData = (p: Peer, d: Rec, first: boolean) => void;

export const TEAM_PORT = 8765;
const MAX_PEERS = 16;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// A teammate's bridge as 25.1.2.3, 25.1.2.3:8770 or the link their window shows; the port is 8765 unless given
export function parseMate(s: string): string | null {
  const t = s.trim();
  let u: URL;
  try { u = new URL(t.includes("://") ? t : `http://${t}`); } catch { return null; }
  // the address as typed: the URL parser would read a mistyped 25.1.2 as 25.1.0.2
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !isIP(u.hostname.replace(/^\[|\]$/g, "")) || !t.includes(u.hostname)) return null;
  return `${u.protocol}//${u.hostname}:${u.port || (t.includes("://") ? (u.protocol === "https:" ? 443 : 80) : TEAM_PORT)}`;
}

export class Peer {
  name = "";
  driving = false;
  up = false;
  private gone = false;

  constructor(readonly url: string, private onData: OnData) {}

  private open(method: string, path: string, body: string | null, onRes: (res: IncomingMessage) => void): ReturnType<typeof httpRequest> {
    const u = new URL(path, this.url);
    const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(u, {
      method, headers: { "X-Pit-Team": TEAM.code, ...(body !== null ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}) },
    }, onRes);
    req.end(body ?? undefined);
    return req;
  }

  call(method: string, path: string, body?: unknown, ms = 4000): Promise<Reply> {
    return new Promise((ok) => {
      const req = this.open(method, path, body === undefined ? null : JSON.stringify(body), (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => ok({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf-8") }));
        res.on("error", () => ok({ status: 0, text: "" }));
      });
      req.setTimeout(ms, () => req.destroy());
      req.on("error", () => ok({ status: 0, text: "" }));
    });
  }

  private stream(): Promise<void> {
    return new Promise((done) => {
      let buf = "", first = true;
      const req = this.open("GET", "/events?hz=30&peer=1", null, (res) => {
        if (res.statusCode !== 200) { res.resume(); return done(); }
        res.setEncoding("utf-8");
        res.on("data", (c: string) => {
          buf += c;
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const msg = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (!msg.startsWith("data: ")) continue;
            try { this.onData(this, JSON.parse(msg.slice(6)), first); } catch (e) { console.error(e); }
            first = false;
            if (!this.up) { this.up = true; STATE.ver++; log(0, "TEAM", `Linked to ${this.name || "a teammate"}'s bridge`); }
          }
        });
        res.on("end", done);
        res.on("error", done);
      });
      // a live bridge sends at least once a second
      req.setTimeout(5000, () => req.destroy());
      req.on("error", done);
    });
  }

  async run(): Promise<void> {
    let said = "";
    while (!this.gone) {
      const r = await this.call("POST", "/team/join", { port: TEAM.self!.port, tls: TEAM.self!.tls, id: TEAM.id });
      if (r.status === 409) { TEAM.notMe.add(this.url); dropPeer(this); return; }
      if (r.status === 403 || r.status === 429) {
        if (said !== "code") log(2, "TEAM", `${this.url} refused the team code: it must be the same on every PC`);
        said = "code";
        await sleep(60_000);
        continue;
      }
      if (r.status === 204) {
        said = "";
        await this.stream();
        if (this.up) log(1, "TEAM", `Lost the link to ${this.name || "a teammate"}'s bridge`);
      } else if (said !== "down") { said = "down"; console.log(`Team: waiting for ${this.url}`); }
      this.up = this.driving = false;
      STATE.ver++;
      await sleep(3000);
    }
  }

  stop(): void { this.gone = true; }
}

export const TEAM: { self: { host: string; port: number; tls: boolean } | null; id: string; code: string; notMe: Set<string>; name: string; driving: boolean; peers: Peer[]; onData: OnData } = {
  self: null, id: randomBytes(8).toString("hex"), code: "", notMe: new Set(), name: "", driving: false, peers: [], onData: () => {},
};

const ownUrl = () => TEAM.self && `${TEAM.self.tls ? "https" : "http"}://${TEAM.self.host}:${TEAM.self.port}`;

function dropPeer(p: Peer): void {
  p.stop();
  TEAM.peers = TEAM.peers.filter((q) => q !== p);
  STATE.ver++;
}

// ponytail: one bridge reached at two addresses is linked twice; harmless, both links carry the same data
export function addPeer(url: string): void {
  if (!TEAM.code || url === ownUrl() || TEAM.notMe.has(url) || TEAM.peers.some((p) => p.url === url) || TEAM.peers.length >= MAX_PEERS) return;
  const p = new Peer(url, (...a) => TEAM.onData(...a));
  TEAM.peers.push(p);
  void p.run();
}

// A teammate's bridge asked to link: link back to its own address. "self" when the caller is this bridge
export function join(from: string, b: unknown): "ok" | "self" | "bad" {
  if (!isObj(b) || !Number.isInteger(b.port) || b.port < 1 || b.port > 65535 || typeof b.tls !== "boolean" || typeof b.id !== "string") return "bad";
  if (b.id === TEAM.id) return "self";
  const ip = from.replace(/^::ffff:/, "");
  if (!isIP(ip)) return "bad";
  addPeer(`${b.tls ? "https" : "http"}://${isIP(ip) === 6 ? `[${ip}]` : ip}:${b.port}`);
  return "ok";
}

// Teammates introduce the bridges they are linked to, so each PC only needs one teammate's address
export function meet(urls: unknown): void {
  if (!Array.isArray(urls)) return;
  for (const s of urls.slice(0, MAX_PEERS)) {
    const url = typeof s === "string" ? parseMate(s) : null;
    if (url) addPeer(url);
  }
}

// The teammate whose driver is in the car, while this PC's driver is not
export const following = (): Peer | null => (TEAM.driving ? null : TEAM.peers.find((p) => p.up && p.driving) ?? null);
