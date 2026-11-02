import { ReactNode, useEffect, useRef, useState } from "react";
import { link } from "../feed/connection";
import { useFeed } from "../feed/useFeed";
import type { Json } from "../feed/types";
import { DEFAULT_THRESHOLDS } from "../lib/states";
import { Icon } from "../lib/icons";
import { fv, UNITS, unit } from "../lib/units";
import { lsDel, lsRaw, lsSet } from "../lib/storage";
import { isObj } from "../lib/text";
import { accessKey, post, say } from "../state/bridge";
import { DEFAULT_PREFS, HZ, KPI_IDS, KpiId, prefs, usePrefs } from "../state/prefs";
import { recorder } from "../state/recorder";
import { Section, ui, useUi } from "../state/ui";
import { oldThresholds, resolveOldThresholds } from "../state/migrate";
import { AppearanceEditor } from "./AppearanceEditor";
import { ask } from "./confirm";
import { KPI_LABEL } from "./KpiStrip";

const SECTIONS: [Section, string][] = [["conn", "Connection"], ["units", "Units"], ["th", "Thresholds"], ["strat", "Strategy inputs"], ["layout", "Layout"], ["ap", "Appearance"], ["tpl", "Templates"], ["data", "Data"], ["about", "About"]];
const CLASSES = ["GT3", "GT4", "GT2", "GTC", "TCX"];

type StratField = [key: string, label: string, min: number, max: number, step: number, nullable: boolean, unit: string];
const STRAT_FIELDS: StratField[] = [
  ["reserve_laps", "Reserve fuel", 0, 10, 0.5, false, "laps"], ["laps_override", "Laps to go, by hand", 1, 999, 1, true, "laps"],
  ["pit_loss_s", "Pit lane loss, driving (until a stop is measured)", 0, 200, 0.1, false, "s"], ["refuel_s_per_l", "Refuel time", 0, 5, 0.01, false, "s/L"],
  ["tyre_s", "Tyre change time", 0, 120, 0.5, false, "s"], ["min_stationary_s", "Minimum stationary time", 0, 200, 0.5, false, "s"],
  ["mandatory_stops", "Mandatory stops (server rule)", 0, 9, 1, true, ""], ["pit_window_open_min", "Pit window opens", 0, 1440, 1, true, "min after green"],
  ["pit_window_close_min", "Pit window closes", 0, 1440, 1, true, "min after green"],
];

const KeyNote = () => (accessKey.value ? null : <p className="note"><Icon name="lock" /> Needs the access key: set it under Connection.</p>);

/** Posts shared settings to the bridge; returns the line to show. */
async function postConfig(body: unknown, ok: string): Promise<string> {
  const r = await post("/config", body);
  return r.ok ? ok : r.status === 403 ? "Wrong or missing access key." : r.status === 0 ? r.text : r.status === 404 ? "This bridge does not take shared settings yet." : "Refused: " + r.text.slice(0, 120);
}

function Connection() {
  const c = useFeed();
  const p = usePrefs();
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const [, bump] = useState(0);
  const bc = c.bc;
  return (
    <>
      <h3 className="mt">Connection</h3>
      <dl className="kv">
        <dt>Bridge</dt><dd className="n">{location.host}</dd>
        <dt>Link</dt><dd>{c.live ? "live" : c.stale ? "stale" : "offline"} · {c.hz} Hz</dd>
      </dl>
      <label className="fld"><span>Live rate</span>
        <select value={p.hz} onChange={(e) => { prefs.update({ hz: +e.target.value as (typeof HZ)[number] }); link.connect(+e.target.value); setMsg(`Live rate ${e.target.value} Hz.`); }}>
          {HZ.map((v) => <option key={v} value={v}>{v} Hz{v === 60 ? " (about 2 Mbit/s)" : ""}</option>)}
        </select>
      </label>
      <p className="note">Lower rates use less of the VPN. Laps, strategy and timing are unaffected.</p>
      <h3 className="mt">Access key</h3>
      <p>{accessKey.value ? <b className="tag">SET</b> : <b className="tag low">MISSING</b>} The key printed by the bridge on the driver's PC. Needed to send pit plans and change shared thresholds.</p>
      <div className="split">
        <input type="password" autoComplete="off" spellCheck={false} placeholder="Paste the key" aria-label="Access key" value={key} onChange={(e) => setKey(e.target.value)} />
        <button type="button" className="btn" onClick={() => { const v = key.trim(); if (!v) return; accessKey.value = v; lsSet("pitwall.pitkey", v); setKey(""); setMsg("Access key saved in this browser."); bump((n) => n + 1); }}>Save</button>
        {accessKey.value ? <button type="button" className="btn" onClick={() => { accessKey.value = ""; lsDel("pitwall.pitkey"); lsDel("engineer.pitkey"); setMsg("Access key removed from this browser."); bump((n) => n + 1); }}>Forget</button> : null}
      </div>
      <h3 className="mt">Field timing</h3>
      <p>{bc ? <><b className="tag">{String(bc.state || "off").toUpperCase()}</b> {bc.msg}{bc.port ? ` · port ${bc.port}` : ""}</> : "This bridge does not report field timing."}</p>
      <p className="note">Other cars come from ACC's broadcasting port, on the driver's PC only. To turn it on there, use the switch in the Pit Wall window (or <code>pitwall-bridge --enable-broadcast</code>), then restart ACC.</p>
      <p className="note set-msg" role="status">{msg}</p>
    </>
  );
}

function Units() {
  const p = usePrefs();
  const sel = (k: "speed" | "temp" | "press", label: string) => (
    <label className="fld"><span>{label}</span>
      <select value={p.units[k]} onChange={(e) => prefs.update({ units: { ...p.units, [k]: e.target.value } as typeof p.units })}>
        {Object.entries(UNITS[k]).map(([v, u]) => <option key={v} value={v}>{u.u}</option>)}
      </select>
    </label>
  );
  return <><h3 className="mt">Units</h3>{sel("speed", "Speed (also wind)")}{sel("temp", "Temperature")}{sel("press", "Pressure")}<p className="note">Display only: the bridge and the shared thresholds stay in km/h, °C and psi.</p></>;
}

type Pair = [number, number];
function Thresholds() {
  const c = useFeed();
  const p = usePrefs();
  const [cls, setCls] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [old, setOld] = useState(!!oldThresholds());
  const klass = cls ?? (c.r?.fixed.car_class as string | undefined) ?? "GT3";
  const T = c.cfg?.thresholds as Record<string, Json> | undefined, t = (T ? T[klass] ?? T.GT3 : DEFAULT_THRESHOLDS) as Json;
  const copy = klass !== "GT3" && !!T && JSON.stringify(T[klass]) === JSON.stringify(T.GT3);
  const dis = !accessKey.value;
  const form = useRef<HTMLDivElement>(null);

  const pair = (id: string, label: string, kind: "press" | "temp", v: Pair) => (
    <div className="fld pair" key={id}>
      <span>{label}</span>
      {[0, 1].map((i) => <input key={i} type="number" step="any" data-th={`${id}.${i}`} data-k={kind} data-v={v[i]} defaultValue={fv(kind, v[i], p.units)} disabled={dis} aria-label={`${label}, ${i ? "high" : "low"}`} />)}
    </div>
  );

  const save = async () => {
    const o: Json = {};
    let bad = "";
    for (const i of form.current!.querySelectorAll<HTMLInputElement>("[data-th]")) {
      const v = parseFloat(i.value);
      if (!isFinite(v)) { bad = "Every threshold needs a number."; break; }
      // An untouched field sends its stored value: converting the rounded display value back would drift it (bar/kPa to psi).
      const kind = i.dataset.k as "press" | "temp" | undefined;
      const val = i.dataset.v != null && i.value === i.defaultValue ? +i.dataset.v : kind ? +unit(kind, p.units).b(v).toFixed(2) : v;
      const path = i.dataset.th!.split(".");
      if (path[0] === "fuel_low_laps") continue;
      let q: Json = o;
      for (let j = 0; j < path.length - 1; j++) q = q[path[j]!] = q[path[j]!] ?? (isFinite(+path[j + 1]!) ? [] : {});
      q[path[path.length - 1]!] = val;
    }
    if (bad) return setMsg(bad);
    const fl = parseFloat(form.current!.querySelector<HTMLInputElement>('[data-th="fuel_low_laps"]')!.value);
    setMsg(await postConfig({ thresholds: { [klass]: o }, fuel_low_laps: isFinite(fl) ? fl : 3 }, `Saved for ${klass}: everyone watching sees the change.`));
  };

  return (
    <div ref={form} key={klass + JSON.stringify(t) + JSON.stringify(p.units)}>
      <h3 className="mt">Thresholds <span className="note">shared</span></h3>
      {old ? (
        <div className="banner"><Icon name="info" /><span>This browser had custom thresholds.</span>
          <button type="button" className="btn" onClick={async () => { if (await resolveOldThresholds(true, c)) setOld(false); }}>Send to bridge</button>
          <button type="button" className="btn" onClick={async () => { if (await resolveOldThresholds(false, c)) setOld(false); }}>Discard</button>
        </div>
      ) : null}
      <p className="banner"><Icon name="users" />Shared with everyone watching this bridge.</p><KeyNote />
      {T ? null : <p className="note">The bridge has not sent its config: showing the GT3 defaults.</p>}
      <label className="fld"><span>Class</span><select value={klass} onChange={(e) => { setCls(e.target.value); setMsg(""); }}>{CLASSES.map((x) => <option key={x}>{x}</option>)}</select></label>
      {copy ? <p className="note s-warn">▲ Defaults copied from GT3: check for this class.</p> : null}
      {pair("dry_psi", "Hot pressure, dry", "press", t.dry_psi)}{pair("wet_psi", "Hot pressure, wet", "press", t.wet_psi)}{pair("tyre_c", "Tyre core", "temp", t.tyre_c)}
      {pair("brake_c.front", "Front brakes, cold / hot", "temp", t.brake_c.front)}{pair("brake_c.rear", "Rear brakes, cold / hot", "temp", t.brake_c.rear)}
      {pair("water_c", "Water, warn / critical", "temp", t.water_c)}
      <label className="fld"><span>Pads low</span><input type="number" step="0.5" data-th="pad_low_mm" defaultValue={t.pad_low_mm} disabled={dis} /><span className="u">mm</span></label>
      <label className="fld"><span>Low fuel</span><input type="number" step="0.5" data-th="fuel_low_laps" defaultValue={c.cfg?.fuel_low_laps ?? 3} disabled={dis} /><span className="u">laps</span></label>
      <p className="note">Pressures in {unit("press", p.units).u}, temperatures in {unit("temp", p.units).u}. Brakes warn within 100 °C of hot.</p>
      <button type="button" className="btn primary" disabled={dis} onClick={() => void save()}>Save for {klass}</button>
      <p className="note set-msg" role="status">{msg}</p>
    </div>
  );
}

function Strategy() {
  const c = useFeed();
  const st = (c.cfg?.strategy ?? {}) as Json;
  const [msg, setMsg] = useState("");
  const form = useRef<HTMLDivElement>(null);
  const dis = !accessKey.value;

  const save = async () => {
    const out: Json = {};
    for (const i of form.current!.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-st]")) {
      const k = i.dataset.st!;
      if (k === "fuel_and_tyres") { out[k] = i.value; continue; }
      const f = STRAT_FIELDS.find((x) => x[0] === k)!, v = i.value.trim();
      if (v === "") { if (f[5]) out[k] = null; else return setMsg(`${f[1]} needs a number.`); continue; }
      const n = parseFloat(v);
      if (!isFinite(n) || n < f[2] || n > f[3]) return setMsg(`${f[1]}: ${f[2]} to ${f[3]}.`);
      out[k] = f[4] === 1 ? Math.round(n) : n;
    }
    if ((out.pit_window_open_min == null) !== (out.pit_window_close_min == null)) return setMsg("Pit window: set both times, or neither.");
    setMsg(await postConfig({ strategy: out }, "Strategy inputs saved: everyone watching sees the change."));
  };

  return (
    <div ref={form} key={JSON.stringify(st)}>
      <h3 className="mt">Strategy inputs <span className="note">shared</span></h3>
      <p className="banner"><Icon name="users" />Shared with everyone watching this bridge. The fuel and stop figures everywhere come from these.</p><KeyNote />
      {STRAT_FIELDS.map(([k, l, lo, hi, step, nul, u]) => (
        <label className="fld" key={k}><span>{l}</span><input type="number" data-st={k} min={lo} max={hi} step={step} defaultValue={st[k] == null ? "" : st[k]} placeholder={nul ? "not set" : undefined} disabled={dis} /><span className="u">{u}</span></label>
      ))}
      <label className="fld"><span>Fuel and tyres at a stop</span>
        <select data-st="fuel_and_tyres" defaultValue={st.fuel_and_tyres} disabled={dis}>
          <option value="parallel">At once (longest counts)</option><option value="sequential">One by one (added)</option>
        </select>
      </label>
      <p className="note">Pit window: both or neither. Empty fields mean "not set": the bridge uses what ACC reports.</p>
      <button type="button" className="btn primary" disabled={dis} onClick={() => void save()}>Save</button>
      <p className="note set-msg" role="status">{msg}</p>
    </div>
  );
}

function Layout() {
  const p = usePrefs();
  const on = p.kpi, rest = KPI_IDS.filter((k) => !on.includes(k));
  const move = (k: KpiId, d: number) => { const a = on.slice(), i = a.indexOf(k), j = i + d; if (i < 0 || j < 0 || j >= a.length) return; a.splice(j, 0, a.splice(i, 1)[0]!); prefs.update({ kpi: a }); };
  return (
    <>
      <h3 className="mt">KPI strip</h3>
      <label className="fld check"><input type="checkbox" checked={p.kpiOn} onChange={(e) => prefs.update({ kpiOn: e.target.checked })} /><span>Show the KPI strip</span></label>
      <ul className="kpi-pick">
        {[...on, ...rest].map((k) => (
          <li key={k}>
            <label className="check"><input type="checkbox" checked={on.includes(k)} onChange={(e) => prefs.update({ kpi: e.target.checked ? [...on, k] : on.filter((x) => x !== k) })} /><span>{KPI_LABEL[k]}</span></label>
            {on.includes(k) ? <><button type="button" className="btn icon" aria-label={`Move ${KPI_LABEL[k]} left`} onClick={() => move(k, -1)}>←</button><button type="button" className="btn icon" aria-label={`Move ${KPI_LABEL[k]} right`} onClick={() => move(k, 1)}>→</button></> : null}
          </li>
        ))}
      </ul>
      <p className="note">Cells drop from the end when the window is too narrow.</p>
      <h3 className="mt">Engineer bar</h3>
      <label className="fld check"><input type="checkbox" checked={p.sound} onChange={(e) => prefs.update({ sound: e.target.checked })} /><span>Beep on new critical advice</span></label>
    </>
  );
}

function Data() {
  const [msg, setMsg] = useState("");
  return (
    <>
      <h3 className="mt">Data</h3>
      <div className="split">
        <button type="button" className="btn" onClick={() => recorder.exportSession()}>Export session</button>
        <label className="btn">Import laps<input type="file" accept=".json,application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setMsg(await recorder.importLaps(f)); }} /></label>
      </div>
      <p className="note">The session file holds the laps, traces, log and notes this page has. Imported laps appear in the lap picker.</p>
      <h3 className="mt">This browser</h3>
      <button type="button" className="btn" onClick={() => {
        const { lastWs } = prefs.get();
        prefs.update({ ...structuredClone(DEFAULT_PREFS), lastWs });
        link.connect(DEFAULT_PREFS.hz);
        setMsg("Units, live rate and layout are back to their defaults.");
      }}>Reset settings to default</button>
      <p className="note">Units, live rate, KPI strip and beep only. Shared thresholds and strategy inputs live on the bridge and stay as they are.</p>
      <button type="button" className="btn" onClick={async () => {
        if ((await ask("Reset everything Pit Wall keeps in this browser? Your templates, appearances and notes will be gone.", [["r", "Reset", true], ["", "Cancel"]])) !== "r") return;
        try { for (const k of Object.keys(localStorage)) if (k.startsWith("pitwall.") || k === "engineer.pitkey") localStorage.removeItem(k); localStorage.setItem("pitwall.migrated", "1"); } catch { /* storage blocked */ }
        location.replace(location.pathname);
      }}>Reset everything in this browser</button>
      <p className="note">Removes your templates, appearances, units, notes, pit plan draft and the access key from this browser. Nothing on the bridge changes.</p>
      <p className="note set-msg" role="status">{msg}</p>
    </>
  );
}

const About = () => (
  <>
    <h3 className="mt">About</h3>
    <p><b>Pit Wall</b>: race engineering for Assetto Corsa Competizione.</p>
    <ul className="note"><li>Barlow Semi Condensed: SIL Open Font License 1.1.</li><li>Lucide icons: ISC License.</li><li>three.js: MIT License.</li><li>Track outlines: © OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright). The Nürburgring 24h layout is traced from Wikimedia Commons, CC BY-SA 3.0.</li></ul>
  </>
);

/** The full-screen settings: a list of sections on the left. */
export function Settings() {
  const { settings, section } = useUi();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!settings) return;
    nav.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); ui.closeSettings(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settings]);
  if (!settings) return <section id="settings" role="dialog" aria-modal="true" aria-label="Settings" hidden />;

  const pane: Record<Section, ReactNode> = {
    conn: <Connection />, units: <Units />, th: <Thresholds />, strat: <Strategy />, layout: <Layout />, ap: <AppearanceEditor />,
    tpl: <><h3 className="mt">Templates</h3><p>A template is a set of workspaces. Make your own, share them by export and import.</p><button type="button" className="btn primary" onClick={() => ui.openTemplates()}>Manage templates…</button></>,
    data: <Data />, about: <About />,
  };
  const step = (d: number) => { const i = SECTIONS.findIndex((s) => s[0] === section); ui.section(SECTIONS[(i + d + SECTIONS.length) % SECTIONS.length]![0]); };

  return (
    <section id="settings" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="set">
        <header className="set-h"><h2>Settings</h2><button type="button" className="btn icon" aria-label="Close settings" title="Close (Esc)" onClick={() => ui.closeSettings()}><Icon name="x" /></button></header>
        <nav className="set-nav" role="tablist" aria-orientation="vertical" ref={nav}
          onKeyDown={(e) => { const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0; if (!d) return; e.preventDefault(); step(d); requestAnimationFrame(() => nav.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()); }}>
          {SECTIONS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={k === section} onClick={() => ui.section(k)}>{l}</button>)}
        </nav>
        <div className="set-pane" role="tabpanel" id="setPane">{pane[section]}</div>
      </div>
    </section>
  );
}

void lsRaw; void isObj;
