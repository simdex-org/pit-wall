import type { FieldSource } from "./broadcast/client.js";
import { AcPlugin } from "./broadcast/ac-plugin.js";
import { Client } from "./broadcast/client.js";
import { enable, readConfig } from "./broadcast/config.js";
import { FakeField } from "./broadcast/fake-field.js";
import { Field } from "./broadcast/field.js";
import { CTX, FAST, FIELD, fieldErr, log, STATE } from "./state.js";
import { saveLayout } from "./tracks.js";
import { CLASSES } from "./config.js";
import type { Pages } from "./telemetry/pages.js";
import type { FakePages } from "./telemetry/fake-pages.js";
import type { Telemetry } from "./telemetry/telemetry.js";
import { Rec, rnd } from "./util.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fieldExt(): [Rec, Rec | null, Rec | null] {
  const f = FIELD.f, snap = STATE.field;
  if (!f || STATE.bc.state !== "live" || !snap) return [{}, null, null];
  const me = snap.cars.find((c: Rec) => c.i === snap.me) ?? null;
  const ent = f.ent.get(snap.me) ?? {};
  const ext = { field: true, car_class: (CLASSES as readonly string[]).includes(ent.class) ? ent.class : null, track_m: snap.track_m, gap_ms: me && me.gap };
  return [ext, f.raceInfo(), me];
}

const filing = { past: 0, waiting: 0, used: 0 };
function fileField(tel: Telemetry): void {
  const id = tel.past[tel.past.length - 1]?.id ?? 0;
  if (id !== filing.past) filing.past = filing.waiting = id;
  const f = FIELD.f;
  if (filing.waiting && f?.ended && f.endedSeq !== filing.used) {
    tel.attachField(filing.waiting, rnd(f.ended));
    filing.used = f.endedSeq; filing.waiting = 0;
  }
}

function tick(pages: Pages | FakePages, tel: Telemetry, sim: boolean, n: number, rate: number, fromField: boolean): Rec | false | null {
  let raw: Rec;
  try { raw = pages.read(); } catch { return null; }
  const live = raw.status === 2 || raw.status === 3;
  if (!live) return false;
  let ext: Rec = {}, race: Rec | null = null, me: Rec | null = null;
  try { [ext, race, me] = fieldExt(); } catch (e) { fieldErr(e); }
  tel.config = STATE.config;
  if (fromField && me) {
    const behind = STATE.field.cars.find((c: Rec) => c.pos === me!.pos + 1);
    Object.assign(raw, { position: me.pos, gap_ahead: me.int || 0, gap_behind: behind?.int || 0 });
  }
  const reading = tel.update(raw, ext);
  const summary = n % Math.floor(rate / 10) === 0 ? tel.summary(raw, race) : null;
  const f = FIELD.f;
  if (summary && f && Object.keys(ext).length) {
    const st = summary.strategy;
    try {
      const now = st.options.find((o: Rec) => o.id === "now_f");
      const loss = (now ? now.loss_s : st.drive_loss_s) * 1000;
      st.rejoin = f.rejoin(f.me, loss);
      for (const o of st.options) { const rj = f.rejoin(f.me, o.loss_s * 1000); o.rejoin_pos = rj && rj.pos; }
      CTX.loss_ms = loss;
    } catch (e) { st.rejoin = null; fieldErr(e); }
  }
  if (summary) {
    const ml = reading.reading.session.missing_mandatory_pits;
    const cfgM = STATE.config.strategy.mandatory_stops;
    CTX.mandatory = cfgM !== null ? cfgM : ml !== null ? ml + tel.stops.length : null;
  }
  CTX.hint = { id: raw.me, sidx: raw.session_index, session: raw.session, len: raw.track_len, laps: raw.laps, spl: raw.track_pos, name: raw.name, xyz: raw.xyz, kmh: raw.speed, coords: raw.coords };
  reading.reading.xz = Object.entries(raw.coords ?? {}).flatMap(([i, q]) => [Number(i), (q as number[])[0], (q as number[])[1]]);
  STATE.reading = rnd(reading); STATE.t_reading = Date.now() / 1000; STATE.lap = raw.laps + 1;
  if (summary) { STATE.summary = rnd(summary); STATE.t_summary = Date.now() / 1000; }
  fileField(tel);
  if (tel.lapsVer !== STATE.laps_ver) {
    STATE.laps = rnd(tel.laps); STATE.past = rnd(tel.past); STATE.laps_ver = tel.lapsVer;
    const lay = sim ? null : tel.bestLayout();
    if (lay) saveLayout(raw.track, lay);
  }
  for (const [sev, cat, text] of tel.events) log(sev, cat, text, cat === "LAP" ? raw.laps : undefined);
  tel.events.length = 0;
  STATE.ver++;
  return raw;
}

export async function accLoop(pages: Pages | FakePages, tel: Telemetry, sim: boolean, game = "ACC"): Promise<never> {
  let n = 0, said: boolean | null = null, due = performance.now();
  for (;;) {
    const rate = FAST.n ? 60 : 30;
    due = Math.max(due + 1000 / rate, performance.now() - 100);
    await sleep(Math.max(0, due - performance.now()));
    const raw = tick(pages, tel, sim, ++n, rate, sim || game !== "ACC");
    if (raw === null) continue;
    if (!!raw !== said) {
      console.log(raw ? `${game}: ${raw.car} at ${raw.track}, ${raw.name} driving` : `${game}: waiting for a session on this PC`);
      said = !!raw;
    }
  }
}

export interface FieldArgs { game: "acc" | "ac"; broadcastPort?: number; broadcastPassword?: string; simulateAcc: boolean; simSession: "race" | "quali" | "practice" | "weekend" }

function makeSink(field: Field) {
  const last = { t: 0, key: null as string | null };
  const handle = (kind: number, d: Rec) => {
    if (kind === 2 && Date.now() / 1000 - last.t >= 0.25) {
      last.t = STATE.t_field = Date.now() / 1000;
      const snap = rnd(field.snapshot(CTX.hint, CTX.mandatory, CTX.loss_ms));
      const key = JSON.stringify({ ...snap, t: undefined });
      if (key !== last.key) { last.key = key; STATE.field = snap; STATE.field_ver++; STATE.ver++; }
    }
    field.on(kind, d);
    if (kind === 4 || kind === 5 || kind === 6) {
      const ent = rnd(field.entries());
      if (JSON.stringify(ent) !== JSON.stringify(STATE.entries)) { STATE.entries = ent; STATE.entries_ver++; STATE.ver++; }
    }
    for (const [sev, cat, text] of field.events) log(sev, cat, text);
    field.events.length = 0;
  };
  return (kind: number, d: Rec) => {
    try { handle(kind, d); } catch (e) { fieldErr(e); }
  };
}

export function startField(args: FieldArgs, pages: FakePages | null): void {
  const off = (msg: string) => { STATE.bc = { state: "off", msg, port: 0 }; console.log(msg); };
  if (args.broadcastPort === 0) return off("Field timing off (--broadcast-port 0).");
  let src: FieldSource, f: Field;
  if (args.game === "ac" && !args.simulateAcc) {
    src = new AcPlugin(() => CTX.hint); f = new Field();
  } else if (args.simulateAcc) {
    if (!pages) return off("Field timing off: no simulated session.");
    const ff = new FakeField(pages);
    src = ff; f = ff;
  } else {
    let cfg = { port: 0, password: "", command_password: "" };
    const load = () => { cfg = { ...cfg, ...readConfig() }; };
    try { load(); } catch {  }
    if (args.broadcastPort === undefined && !cfg.port) {
      console.log(enable());
      try { load(); } catch (e) {
        return off(`Field timing off: could not read broadcasting.json (${(e as Error).message}). Open ACC once, to the main menu, then restart Pit Wall.`);
      }
    }
    const port = args.broadcastPort ?? cfg.port;
    if (!port) return off("Field timing off: broadcasting.json has updListenerPort 0.");
    const pw = args.broadcastPassword ?? cfg.password;
    src = new Client(port, pw); f = new Field();
  }
  FIELD.f = f; FIELD.src = src; STATE.bc = src.state;
  src.start(makeSink(f));
  console.log("Field timing: " + (args.game === "ac" && !args.simulateAcc ? "listening for the Pit Wall app in Assetto Corsa on 127.0.0.1:" + src.state.port : args.simulateAcc ? `simulated ${pages?.world.cars.length ?? 20}-car field${args.simSession === "race" ? "" : ` (${args.simSession === "quali" ? "qualifying" : args.simSession})`}` : `listening to ACC's broadcasting on 127.0.0.1:${(src as Client).state.port}`));
}
