// ACC broadcasting protocol version 4, little-endian, laid out as in Kunos' ksBroadcastingNetwork SDK.
// Only this file builds outgoing messages, and only types 1 (register), 9 (unregister), 10 (entry list) and 11 (track data):
// anything else would move the driver's camera, HUD or replay.
import { Rec, ValueError } from "../util.js";

/** Int32.MaxValue: "no time" in every lap and split. */
export const MAXI = 2147483647;

/** Bounds-checked reads: a short or lying datagram throws ValueError, never reads past the end. */
class Reader {
  o = 0;
  private v: DataView;
  constructor(private b: Buffer) { this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }

  private need(n: number, what = "packet"): void {
    if (this.o + n > this.b.length) throw new ValueError(`truncated ${what}`);
  }
  u8(): number { this.need(1); return this.v.getUint8(this.o++); }
  u16(): number { this.need(2); const x = this.v.getUint16(this.o, true); this.o += 2; return x; }
  i32(): number { this.need(4); const x = this.v.getInt32(this.o, true); this.o += 4; return x; }
  f32(): number { this.need(4); const x = this.v.getFloat32(this.o, true); this.o += 4; return x; }

  text(limit?: number): string {
    const n = this.u16();
    this.need(n, "string");
    const t = this.b.subarray(this.o, this.o + n).toString("utf-8");
    this.o += n;
    const clean = t.replace(/\p{C}/gu, ""); // no control or format characters from the network
    return limit ? clean.slice(0, limit) : clean;
  }

  lap(): Rec {
    const ms = this.i32(), car = this.u16(), drv = this.u16(), n = this.u8();
    const splits: (number | null)[] = Array.from({ length: n }, () => this.i32());
    const bad = this.u8(); this.u8(); const out = this.u8(), inl = this.u8();
    const s = [...splits.map((x) => (x === MAXI ? null : x)), ...Array<null>(Math.max(0, 3 - n)).fill(null)];
    return { ms: ms === MAXI ? null : ms, car, drv, s, valid: !bad, out: !!out, in: !!inl };
  }
}

/** One datagram from ACC -> [message type, data]. Pure; throws ValueError on a truncated or empty packet. */
export function parse(datagram: Uint8Array): [number, Rec] {
  const r = new Reader(Buffer.from(datagram));
  const kind = r.u8();
  switch (kind) {
    case 1: { // REGISTRATION_RESULT
      const conn = r.i32(), ok = r.u8(), writable = r.u8();
      return [kind, { conn, success: ok > 0, readonly: writable === 0, msg: r.text(200) }];
    }
    case 2: { // REALTIME_UPDATE
      const ev = r.u16(), sidx = r.u16(), stype = r.u8(), phase = r.u8(), t = r.f32(), end = r.f32(), focus = r.i32();
      r.text(); r.text(); r.text(); // camera set, camera, HUD page
      const replay = r.u8() > 0;
      if (replay) { r.f32(); r.f32(); }
      const tod = r.f32(), air = r.u8(), track = r.u8(), clouds = r.u8(), rain = r.u8(), wet = r.u8();
      return [kind, { event_idx: ev, session_idx: sidx, type: stype, phase, time_ms: t, end_ms: end, focus, replay, tod_ms: tod, air, track,
        clouds: clouds / 10, rain: rain / 10, wet: wet / 10, best: r.lap() }];
    }
    case 3: { // REALTIME_CAR_UPDATE
      const i = r.u16(), drv = r.u16(), ndrv = r.u8(), gear = r.u8(), x = r.f32(), y = r.f32(), yaw = r.f32(), loc = r.u8(), kmh = r.u16();
      const pos = r.u16(), cpos = r.u16(), tpos = r.u16(), spl = r.f32(), laps = r.u16(), delta = r.i32();
      return [kind, { i, drv, drivers: ndrv, gear: gear - 2, x, y, yaw, loc, kmh, pos, cpos, tpos, spl, laps, delta, best: r.lap(), last: r.lap(), cur: r.lap() }];
    }
    case 4: { // ENTRY_LIST: the car indexes; each car's details follow as type 6
      const conn = r.i32(), n = r.u16();
      return [kind, { conn, cars: Array.from({ length: n }, () => r.u16()) }];
    }
    case 5: { // TRACK_DATA
      const conn = r.i32(), name = r.text(64), id = r.i32(), meters = r.i32();
      for (let n = r.u8(); n > 0; n--) { r.text(); for (let m = r.u8(); m > 0; m--) r.text(); } // camera sets, then HUD pages: read only to check the packet is whole
      for (let n = r.u8(); n > 0; n--) r.text();
      return [kind, { conn, name, id, meters }];
    }
    case 6: { // ENTRY_LIST_CAR
      const i = r.u16(), model = r.u8(), team = r.text(48), num = r.i32(), cup = r.u8(), cur = r.u8(), nat = r.u16(), n = r.u8();
      const drivers = Array.from({ length: n }, () => {
        const first = r.text(32), last = r.text(32), short = r.text(8), dcat = r.u8(), dnat = r.u16();
        return { first, last, short, dcat, nat: dnat };
      });
      return [kind, { i, model, team, num, cup, cur_drv: cur, nat, drivers }];
    }
    case 7: { // BROADCASTING_EVENT
      const type = r.u8(), msg = r.text(200), time_ms = r.i32(), car = r.i32();
      return [kind, { type, msg, time_ms, car }];
    }
    default:
      return [kind, {}];
  }
}

const str = (s: string): Buffer => {
  const b = Buffer.from(s, "utf-8");
  const h = Buffer.alloc(2);
  h.writeUInt16LE(b.length);
  return Buffer.concat([h, b]);
};

/** REGISTER_COMMAND_APPLICATION, protocol version 4. */
export function packRegister(name: string, password: string, intervalMs: number, commandPassword = ""): Buffer {
  const i = Buffer.alloc(4);
  i.writeInt32LE(intervalMs);
  return Buffer.concat([Buffer.from([1, 4]), str(name), str(password), i, str(commandPassword)]);
}

/** Unregister, request entry list, request track data. Nothing else is ever sent: anything else moves the driver's view. */
export function packRequest(kind: number, connId: number): Buffer {
  if (kind !== 9 && kind !== 10 && kind !== 11) throw new ValueError("only unregister, entry list and track data requests are sent");
  const b = Buffer.alloc(5);
  b.writeUInt8(kind, 0);
  b.writeInt32LE(connId, 1);
  return b;
}

/** Encoders used only by the tests, to build the datagrams ACC would send. */
export const testing = { str };
