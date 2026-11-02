// Who may read and who may write. The access key (header) or the session cookie it buys from POST /auth opens every data
// endpoint; EventSource cannot send a header, so the stream relies on the cookie.
import { createHmac, timingSafeEqual } from "node:crypto";
import { IncomingMessage } from "node:http";
import { PIT } from "../state.js";

export const MIN_KEY = 12;
const COOKIE = "pitwall_session";
const FAILS = 10, WINDOW_MS = 60_000;

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const token = () => createHmac("sha256", PIT.key).update("pitwall-session").digest("base64url");

function cookie(req: IncomingMessage): string {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return "";
}

export const keyOk = (req: IncomingMessage) => PIT.open || same(String(req.headers["x-pit-key"] ?? ""), PIT.key);
export const presented = (req: IncomingMessage) => !!req.headers["x-pit-key"] || cookie(req) !== "";
export const sessionOk = (req: IncomingMessage) => keyOk(req) || same(cookie(req), token());

export function sessionCookie(secure: boolean): string {
  return `${COOKIE}=${token()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? "; Secure" : ""}`;
}

const misses = new Map<string, { n: number; since: number }>();

/** True while this address has failed too often in the last minute. */
export function blocked(addr: string, now = Date.now()): boolean {
  const m = misses.get(addr);
  if (m && now - m.since > WINDOW_MS) misses.delete(addr);
  return (misses.get(addr)?.n ?? 0) >= FAILS;
}

export function miss(addr: string, now = Date.now()): void {
  const m = misses.get(addr);
  if (!m || now - m.since > WINDOW_MS) misses.set(addr, { n: 1, since: now });
  else m.n++;
}

export function forgive(addr: string): void { misses.delete(addr); }

const isLoopback = (h: string) => h === "localhost" || h === "::1" || /^127\./.test(h);
const isPrivate = (h: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|25\.|26\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.)/.test(h) || /^f[cd]/i.test(h);

/** Why this bind address is not safe as it stands, or null. */
export function bindWarning(host: string, tls: boolean): string | null {
  if (isLoopback(host) || tls) return null;
  if (host === "0.0.0.0" || host === "::") return "Listening on every network adapter over plain HTTP. Bind to the VPN address instead, or use --tls-cert and --tls-key.";
  if (!isPrivate(host)) return "This looks like a public address and the link is plain HTTP: the access key and the telemetry can be read on the way. Use a VPN address, or --tls-cert and --tls-key.";
  return "The link is plain HTTP. That is fine inside an encrypted VPN (Hamachi, Radmin, Tailscale); on a bare LAN anyone on it can read the access key.";
}

export function keyProblem(key: string, host: string): string | null {
  if (isLoopback(host) || key.length >= MIN_KEY) return null;
  return `--key must be at least ${MIN_KEY} characters when the bridge is reachable from other PCs`;
}
