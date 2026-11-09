import { request as httpRequest, IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { log, STATE } from "../state.js";
import { isObj, Rec } from "../util.js";

export interface Reply { status: number; text: string }
type OnData = (p: Peer, d: Rec, first: boolean) => void;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// A teammate's link, http://25.1.2.3:8765/?key=..., as the bridge's address and its access key
export function parseLink(s: string): { url: string; key: string } | null {
  let u: URL;
  try { u = new URL(s.trim()); } catch { return null; }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !isIP(u.hostname.replace(/^\[|\]$/g, ""))) return null;
  return { url: u.origin, key: u.searchParams.get("key") ?? "" };
}

export class Peer {
  name = "";
  driving = false;
  up = false;
  private gone = false;

  constructor(readonly url: string, public key: string, private onData: OnData) {}

  private open(method: string, path: string, body: string | null, onRes: (res: IncomingMessage) => void): ReturnType<typeof httpRequest> {
    const u = new URL(path, this.url);
    const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(u, {
      method, headers: { "X-Pit-Key": this.key, "X-Pit-Team": "1", ...(body !== null ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}) },
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

  async run(join: () => Rec): Promise<void> {
    let said = "";
    while (!this.gone) {
      const r = await this.call("POST", "/team/join", join());
      if (r.status === 403 || r.status === 429) {
        if (said !== "key") log(2, "TEAM", `${this.url} refused the access key: check the link`);
        said = "key";
        await sleep(60_000);
        continue;
      }
      if (r.status === 200) {
        said = "";
        let peers: unknown = [];
        try { peers = JSON.parse(r.text).peers; } catch { }
        for (const p of Array.isArray(peers) ? peers : []) if (isObj(p) && typeof p.url === "string" && typeof p.key === "string") addPeer(p.url, p.key);
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

export const TEAM: { self: { host: string; port: number; tls: boolean; key: string } | null; name: string; driving: boolean; peers: Peer[]; onData: OnData } = {
  self: null, name: "", driving: false, peers: [], onData: () => {},
};

const ownUrl = () => TEAM.self && `${TEAM.self.tls ? "https" : "http"}://${TEAM.self.host}:${TEAM.self.port}`;

export function addPeer(url: string, key: string): void {
  if (url === ownUrl()) return;
  const known = TEAM.peers.find((p) => p.url === url);
  if (known) { known.key = key; return; }
  const p = new Peer(url, key, (...a) => TEAM.onData(...a));
  TEAM.peers.push(p);
  void p.run(() => ({ port: TEAM.self!.port, tls: TEAM.self!.tls, key: TEAM.self!.key }));
}

// A teammate's bridge asked to link: link back to it and tell it who else is on the team
export function join(from: string, b: unknown): Rec | null {
  if (!isObj(b) || !Number.isInteger(b.port) || b.port < 1 || b.port > 65535 || typeof b.tls !== "boolean" || typeof b.key !== "string" || b.key.length > 200) return null;
  const ip = from.replace(/^::ffff:/, "");
  if (!isIP(ip)) return null;
  const url = `${b.tls ? "https" : "http"}://${isIP(ip) === 6 ? `[${ip}]` : ip}:${b.port}`;
  addPeer(url, b.key);
  return { peers: TEAM.peers.filter((p) => p.url !== url).map((p) => ({ url: p.url, key: p.key })) };
}

// The teammate whose driver is in the car, while this PC's driver is not
export const following = (): Peer | null => (TEAM.driving ? null : TEAM.peers.find((p) => p.up && p.driving) ?? null);
