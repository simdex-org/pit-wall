import { request } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { bindWarning, blocked, keyProblem, miss } from "../src/http/auth.js";
import { secure } from "../src/http/headers.js";
import { createBridgeServer, hostOk } from "../src/http/server.js";
import { PIT } from "../src/state.js";
import { TEAM } from "../src/team/link.js";

const KEY = "k".repeat(16);
let port = 0;
const server = createBridgeServer();

function call(method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<{ status: number; headers: Record<string, unknown> }> {
  const data = body === undefined ? undefined : JSON.stringify(body);
  if (data) headers = { ...headers, "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(data)) };
  return new Promise((ok, bad) => {
    const r = request({ host: "127.0.0.1", port, method, path, headers }, (res) => { res.resume(); res.on("end", () => ok({ status: res.statusCode!, headers: res.headers })); });
    r.on("error", bad); r.end(data);
  });
}

beforeAll(async () => {
  PIT.key = KEY;
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => { server.close(); });

describe("http security", () => {
  test("data endpoints need the key or the session cookie", async () => {
    for (const p of ["/events", "/lap?n=1", "/session?id=1", "/field/laps?car=0", "/track"]) expect((await call("GET", p)).status).toBe(401);
    expect((await call("GET", "/track", { "X-Pit-Key": KEY })).status).toBe(204);
  });

  test("POST /auth sets an HttpOnly strict cookie that opens the reads", async () => {
    const r = await call("POST", "/auth", { "X-Pit-Key": KEY });
    expect(r.status).toBe(204);
    const c = String((r.headers["set-cookie"] as string[])[0]);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).not.toContain(KEY);
    expect((await call("GET", "/track", { Cookie: c.split(";")[0]! })).status).toBe(204);
    expect((await call("GET", "/track", { Cookie: "pitwall_session=nope" })).status).toBe(401);
  });

  test("a wrong key is refused", async () => {
    expect((await call("POST", "/auth", { "X-Pit-Key": "wrong" })).status).toBe(403);
    expect((await call("POST", "/pit")).status).toBe(403);
  });

  test("only the team code links a bridge; the engineer's key does not", async () => {
    TEAM.code = "team-code-1234";
    const me = { port: 1, tls: false, id: TEAM.id };
    expect((await call("POST", "/team/join", { "X-Pit-Key": KEY }, me)).status).toBe(403);
    expect((await call("POST", "/team/join", { "X-Pit-Team": "team-code-9999" }, me)).status).toBe(403);
    expect((await call("POST", "/team/join", { "X-Pit-Team": TEAM.code }, me)).status).toBe(409);
    expect((await call("GET", "/track", { "X-Pit-Team": TEAM.code })).status).toBe(204);
    TEAM.code = "";
  });

  test("responses carry the security headers", async () => {
    const h = (await call("GET", "/track")).headers;
    expect(String(h["content-security-policy"])).toContain("default-src 'self'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
  });

  test("the module frame gets its own locked-down policy", () => {
    const page = String(secure({})["Content-Security-Policy"]), frame = String(secure({}, true)["Content-Security-Policy"]);
    expect(page).toContain("frame-src 'self'");
    expect(page).toContain("script-src 'self';");
    expect(frame).toContain("default-src 'none'");
    expect(frame).toContain("sandbox allow-scripts");
    expect(frame).not.toMatch(/connect-src|allow-same-origin/);
  });

  test("repeated wrong keys lock an address out", () => {
    for (let i = 0; i < 10; i++) miss("9.9.9.9");
    expect(blocked("9.9.9.9")).toBe(true);
    expect(blocked("9.9.9.9", Date.now() + 61_000)).toBe(false);
  });

  test("host, key length and bind address checks", () => {
    expect(hostOk("evil.example:8765")).toBe(false);
    expect(hostOk("25.1.2.3:8765")).toBe(true);
    expect(keyProblem("demo", "127.0.0.1")).toBeNull();
    expect(keyProblem("demo", "25.1.2.3")).toMatch(/at least/);
    expect(bindWarning("127.0.0.1", false)).toBeNull();
    expect(bindWarning("0.0.0.0", false)).toMatch(/every network/);
    expect(bindWarning("8.8.8.8", false)).toMatch(/public/);
    expect(bindWarning("25.1.2.3", false)).toMatch(/VPN/);
    expect(bindWarning("8.8.8.8", true)).toBeNull();
  });
});
