// The broadcasting client: registers with ACC on 127.0.0.1 and hands every message to the sink. It only listens: it sends
// the registration and requests 9-11, never a focus, camera, HUD or replay message.
import { createSocket, Socket } from "node:dgram";
import { isIPv4 } from "node:net";
import { Rec, ValueError } from "../util.js";
import { packRegister, packRequest, parse } from "./wire.js";

export type Sink = (kind: number, d: Rec) => void;
export interface BroadcastState { state: string; msg: string; port: number }

/** What bridge.ts needs from the real client and from FakeField alike. */
export interface FieldSource {
  state: BroadcastState;
  start(sink: Sink): void;
  close(): void;
}

export class Client implements FieldSource {
  state: BroadcastState;
  private sock: Socket | null = null;
  private conn: number | null = null;
  private known = new Map<number, number>();
  private asked = 0;
  private sidx: number | null = null;
  private heard = -1e9;
  private reg = -1e9;
  private pauseUntil = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(private port: number, private password: string, private interval = 250, private host = "127.0.0.1",
    private name = "Pit Wall", private cmd = "") {
    if (!isIPv4(host) || !host.startsWith("127.")) throw new ValueError("the broadcasting port is only ever used on this PC");
    this.state = { state: "off", msg: "", port };
  }

  private send(b: Buffer): void {
    this.sock?.send(b, (e) => { void e; }); // ACC not listening: the next error says so
  }

  private askEntries(now: number): void {
    if (this.conn !== null && now - this.asked > 1.0) { this.asked = now; this.send(packRequest(10, this.conn)); }
  }

  start(sink: Sink): void {
    const sock = (this.sock = createSocket("udp4"));
    sock.on("error", () => { // ICMP port unreachable: ACC is not listening
      this.state = Object.assign(this.state, { state: "waiting", msg: `ACC is not answering on port ${this.port}` });
      this.pauseUntil = performance.now() / 1000 + 5;
    });
    sock.on("message", (data) => {
      let kind: number, d: Rec;
      try { [kind, d] = parse(data); } catch (e) { if (e instanceof ValueError) return; throw e; }
      const now = (this.heard = performance.now() / 1000);
      if (kind === 1) {
        if (!d.success) { Object.assign(this.state, { state: "error", msg: d.msg || "ACC refused the connection: check connectionPassword" }); return; }
        this.conn = d.conn;
        Object.assign(this.state, { state: "live", msg: `ACC broadcasting on port ${this.port}` + (d.readonly ? " (read-only)" : "") });
        this.asked = now;
        this.send(packRequest(10, d.conn));
        this.send(packRequest(11, d.conn));
      } else if (kind === 2) {
        if (this.sidx !== null && d.session_idx !== this.sidx) this.askEntries(now);
        this.sidx = d.session_idx;
      } else if (kind === 3) {
        if ((this.known.get(d.i) ?? -1) !== d.drivers) this.askEntries(now); // unknown car or a driver count that disagrees: entry list again
      } else if (kind === 4) {
        this.known = new Map((d.cars as number[]).map((i) => [i, -1]));
      } else if (kind === 6) {
        this.known.set(d.i, d.drivers.length);
      }
      sink(kind, d);
    });
    sock.connect(this.port, this.host, () => {
      Object.assign(this.state, { state: "waiting", msg: `Waiting for ACC on port ${this.port}` });
      const tick = () => {
        const now = performance.now() / 1000;
        if (now < this.pauseUntil) return;
        if (now - this.heard > 5 && now - this.reg > 5) { // nothing for 5 s: register (again)
          if (this.state.state === "live") Object.assign(this.state, { state: "waiting", msg: `ACC stopped sending on port ${this.port}` });
          this.conn = null; this.reg = now;
          this.send(packRegister(this.name, this.password, this.interval, this.cmd));
        }
      };
      tick();
      this.timer = setInterval(tick, 1000);
    });
  }

  close(): void {
    const sock = this.sock;
    if (!sock) return;
    this.sock = null;
    if (this.timer) clearInterval(this.timer);
    if (this.conn !== null) sock.send(packRequest(9, this.conn), () => {});
    setTimeout(() => { try { sock.close(); } catch { /* already closed */ } }, 50).unref();
  }
}
