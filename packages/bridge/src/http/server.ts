// The page, GET /events (SSE), /lap, /session, /field/laps, /track (signed in) and POST /auth, /pit, /config, /mfd/close.
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { isIP } from "node:net";
import { cleanConfig } from "../config.js";
import { WEB_DIR } from "../paths.js";
import { applyPlan } from "../pit/apply.js";
import { cleanPlan } from "../pit/plan.js";
import { FAST, FIELD, log, PIT, setJob, STATE, TEL } from "../state.js";
import { loadLayout } from "../tracks.js";
import { Rec, rnd, ValueError } from "../util.js";
import { blocked, forgive, keyOk, miss, presented, sessionCookie, sessionOk } from "./auth.js";
import { secure, setTls, tls } from "./headers.js";
import { serveStatic } from "./static.js";

type Res = ServerResponse;

function reply(res: Res, code: number, text: string, kind = "text/plain; charset=utf-8"): void {
  const body = Buffer.from(text);
  res.writeHead(code, secure({ "Content-Type": kind, "Content-Length": body.length, "Cache-Control": "no-cache" }));
  res.end(body);
}
const replyJson = (res: Res, code: number, obj: unknown) => reply(res, code, JSON.stringify(rnd(obj)), "application/json");

/** Only requests addressed to an IP or localhost: a page on some other site that rebinds its DNS name to this PC sends its
 * own name as Host, and is turned away. */
export function hostOk(host: string | undefined): boolean {
  const h = (host ?? "").replace(/:\d*$/, "").replace(/^\[|\]$/g, "").trim();
  return isIP(h) !== 0 || h === "localhost";
}

function pitSnapshot(): Rec | null {
  try {
    if (!PIT.mfd) return null;
    const s: Rec = PIT.mfd.read();
    s.busy = PIT.busy ? PIT.doing : ""; // "plan" or "close" (a Close pit page has no pit_job)
    return s;
  } catch { return null; }
}

async function closePage(): Promise<void> {
  let sev: number, text: string;
  try {
    await PIT.mfd!.press("close");
    PIT.closed_at = Date.now() / 1000;
    sev = 0; text = "Cycle MFD sent to close the pit page"; // what was pressed: ACC does not say which MFD page is showing
  } catch (e) { // not focused, vJoy gone: said in the log rather than lost
    sev = 2; text = `Could not close the pit page: ${(e as Error).message}`;
  } finally {
    PIT.busy = false;
  }
  console.log(text);
  log(sev, "PLAN", text);
}

async function runPlan(plan: ReturnType<typeof cleanPlan>, by: string): Promise<void> {
  setJob({ state: "running", plan, by, only: plan.only });
  let end: Rec;
  try {
    const res = await applyPlan(plan, PIT.mfd!);
    end = { state: "done", res };
    console.log("pit plan applied:", res);
  } catch (e) { // anything: the page must hear it rather than see "running" forever
    end = { state: "error", msg: (e as Error).message };
    console.log("pit plan failed:", (e as Error).message);
  }
  setJob({ plan, by, only: plan.only, ...end });
  STATE.pit_log = [...STATE.pit_log, { ...end, t: Date.now() / 1000, by, only: plan.only, plan }].slice(-50);
  STATE.pit_log_ver++;
  log(end.state === "done" ? 0 : 2, "PLAN", `Pit plan (${plan.only.join(", ")}) ` + (end.state === "done" ? `applied, sent by ${by}` : `failed, sent by ${by}: ${end.msg}`));
  PIT.busy = false;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const n = Number(req.headers["content-length"] ?? 0);
  if (!(n > 0 && n <= 4096)) throw new ValueError("bad request");
  const chunks: Buffer[] = [];
  let got = 0;
  for await (const c of req) { got += (c as Buffer).length; if (got > 4096) throw new ValueError("bad request"); chunks.push(c as Buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf-8")); } catch (e) { throw new ValueError((e as Error).message); }
}

async function post(req: IncomingMessage, res: Res, path: string): Promise<void> {
  if (!hostOk(req.headers.host)) return reply(res, 403, "use the PC's IP address");
  if (!["/auth", "/pit", "/config", "/mfd/close"].includes(path)) return reply(res, 404, "not found");
  const from = req.socket.remoteAddress ?? "?";
  if (blocked(from)) return reply(res, 429, "too many wrong keys; wait a minute");
  if (!keyOk(req)) { miss(from); return reply(res, 403, "wrong or missing access key"); }
  forgive(from);
  if (path === "/auth") { // trades the key for the session cookie the event stream and the other reads use
    res.setHeader("Set-Cookie", sessionCookie(tls));
    return reply(res, 204, "");
  }
  if (path === "/mfd/close") { // take the pit page off the driver's screen (ACC's Cycle MFD)
    if (!PIT.mfd) return reply(res, 503, "pit control is not available on this PC");
    const snap = pitSnapshot(); // outside a live session Cycle MFD would only move the driver's MFD to another page
    if (!snap || snap.status !== "live") return reply(res, 409, "ACC is not live on the driver's PC");
    if (PIT.busy) return reply(res, 409, PIT.doing === "plan" ? "a plan is still being applied" : "the pit page is already being closed");
    if (Date.now() / 1000 - PIT.closed_at < 2) return reply(res, 409, "the pit page was just closed; wait 2 s"); // a second Cycle MFD would move the driver's MFD on
    PIT.busy = true; PIT.doing = "close";
    void closePage();
    return reply(res, 202, "closing");
  }
  if (path === "/config") {
    try {
      const raw = await readBody(req);
      const cfg = cleanConfig(raw, STATE.config);
      STATE.config = cfg; STATE.config_ver++;
      log(0, "CFG", `Thresholds changed by ${from}: ${Object.keys(raw as object).join(", ")}`);
      return replyJson(res, 200, cfg);
    } catch (e) {
      if (e instanceof ValueError || e instanceof TypeError) return reply(res, 400, e.message);
      throw e;
    }
  }
  if (!PIT.mfd) return reply(res, 503, "pit control is not available on this PC");
  let plan;
  try { plan = cleanPlan(await readBody(req)); } catch (e) {
    if (e instanceof ValueError) return reply(res, 400, e.message);
    throw e;
  }
  if (PIT.busy) return reply(res, 409, PIT.doing === "plan" ? "a plan is still being applied" : "the pit page is being closed");
  PIT.busy = true; PIT.doing = "plan";
  void runPlan(plan, from);
  reply(res, 202, "applying");
}

function intParam(q: URLSearchParams, name: string, lo: number, hi: number): number | null {
  const s = q.get(name) ?? "";
  if (!/^\s*[+-]?\d+\s*$/.test(s)) return null;
  const v = Number(s);
  return v >= lo && v <= hi ? v : null;
}

const DATA = new Set(["/events", "/lap", "/field/laps", "/session", "/track"]);

function get(req: IncomingMessage, res: Res): void {
  if (!hostOk(req.headers.host)) return reply(res, 403, "use the PC's IP address");
  const u = new URL(req.url ?? "/", "http://x");
  if (DATA.has(u.pathname)) {
    const from = req.socket.remoteAddress ?? "?";
    if (blocked(from)) return reply(res, 429, "too many wrong keys; wait a minute");
    if (!sessionOk(req)) { if (presented(req)) miss(from); return reply(res, 401, "sign in first"); }
  }
  if (u.pathname === "/events") return events(req, res, u.searchParams);
  if (u.pathname === "/lap" || u.pathname === "/field/laps") {
    const lap = u.pathname === "/lap";
    const name = lap ? "n" : "car";
    const v = intParam(u.searchParams, name, lap ? 1 : 0, lap ? 99999 : 65535);
    if (v === null) return reply(res, 400, `${name} must be a whole number`);
    if (lap) {
      const s = u.searchParams.has("s") ? intParam(u.searchParams, "s", 1, 99999) : undefined;
      if (s === null) return reply(res, 400, "s must be a whole number");
      const t = TEL.t?.lapTrace(v, s);
      return t ? replyJson(res, 200, t) : replyJson(res, 404, {});
    }
    return replyJson(res, 200, { car: v, laps: FIELD.f ? FIELD.f.carLaps(v) : [] });
  }
  if (u.pathname === "/session") { // an earlier session's field: standings, slow fields, entries and every car's laps
    const id = intParam(u.searchParams, "id", 1, 99999);
    if (id === null) return reply(res, 400, "id must be a whole number");
    const f = TEL.t?.vault.get(id)?.field;
    return f ? replyJson(res, 200, f) : replyJson(res, 404, {});
  }
  if (u.pathname === "/track") { // the saved layout of the track being driven: the map needs no lap of its own
    const name = STATE.reading?.reading?.fixed?.track;
    const lay = name && loadLayout(name);
    return lay ? replyJson(res, 200, lay) : replyJson(res, 404, {});
  }
  serveStatic(req, res, WEB_DIR, u.pathname);
}

function events(req: IncomingMessage, res: Res, q: URLSearchParams): void {
  const hz = q.get("hz") ?? "30";
  const gap = 1000 / (["5", "10", "15", "30", "60"].includes(hz) ? Number(hz) : 30);
  const fast = hz === "60";
  if (fast) FAST.n++;
  res.writeHead(200, secure({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }));
  // what this client was last sent; -1: everything on the first message
  const sent = { ver: -1, summary: null as number | null, laps: -1, field: -1, slow: -1, entries: -1, log: 0, pit_log: -1, config: -1 };
  let lastBeat = 0, due = 0; // due: when the next reading may go, on a fixed beat so polling never rounds the rate down
  const timer = setInterval(() => {
    if (res.writableNeedDrain) return; // a slow client is sent the whole difference next time, not a queue of frames
    const now = Date.now();
    const changed = STATE.ver !== sent.ver;
    if (!((changed && now >= due) || now - lastBeat > 1000)) return;
    const newLog = STATE.log.filter((l: Rec) => l.seq > sent.log);
    let field: Rec | null = null, slowSeq = sent.slow;
    if (STATE.field && STATE.field_ver !== sent.field && FIELD.f) {
      const [slow, seq] = FIELD.f.slowSince(sent.slow);
      field = { ...STATE.field, slow: rnd(slow) };
      slowSeq = seq;
    }
    const s = STATE;
    const payload = { // each key only when it changed for this client; the reading at most hz times a second
      reading: s.reading,
      summary: s.t_summary !== sent.summary ? s.summary : null,
      laps: s.laps_ver !== sent.laps ? s.laps : null,
      past: s.laps_ver !== sent.laps ? s.past : null,
      field,
      entries: s.entries_ver !== sent.entries ? s.entries : null,
      log: newLog.length ? newLog : null,
      pit_log: s.pit_log_ver !== sent.pit_log ? s.pit_log : null,
      config: s.config_ver !== sent.config ? s.config : null,
      reading_age_ms: s.t_reading ? Math.trunc(now - s.t_reading * 1000) : null,
      summary_age_ms: s.t_summary ? Math.trunc(now - s.t_summary * 1000) : null,
      field_age_ms: s.t_field ? Math.trunc(now - s.t_field * 1000) : null,
      bc: { ...s.bc },
      pit: rnd(pitSnapshot()),
      pit_job: rnd(s.pit_job),
    };
    res.write("data: " + JSON.stringify(payload) + "\n\n");
    Object.assign(sent, { ver: s.ver, summary: s.t_summary, laps: s.laps_ver, entries: s.entries_ver, pit_log: s.pit_log_ver, config: s.config_ver, slow: slowSeq });
    if (field) sent.field = s.field_ver;
    if (newLog.length) sent.log = newLog[newLog.length - 1].seq;
    lastBeat = now; due = Math.max(due + gap, now - gap);
  }, 10);
  req.on("close", () => { clearInterval(timer); if (fast) FAST.n--; });
}

export function createBridgeServer(tlsFiles?: { cert: Buffer; key: Buffer }): Server {
  setTls(!!tlsFiles);
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const run = req.method === "POST" ? post(req, res, new URL(req.url ?? "/", "http://x").pathname) : Promise.resolve(get(req, res));
    run.catch((e) => { console.error(e); if (!res.headersSent) reply(res, 500, "server error"); else res.end(); });
  };
  return tlsFiles ? createHttpsServer(tlsFiles, handler) : createServer(handler);
}
