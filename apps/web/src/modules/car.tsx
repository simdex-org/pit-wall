import { ReactNode } from "react";
import { defineModule } from "../engine/registry";
import type { Ctx } from "../feed/store";
import type { Json } from "../feed/types";
import { Icon } from "../lib/icons";
import { clamp, fmtLap, fmtSector, MINUS, nf, NONE, okMs, plural } from "../lib/format";
import { bodyState, brakeState, padState, pressState, State, STATE_WORD, stateGlyph, stateLevel, suspState, tyreState, waterState } from "../lib/states";
import { fv, unit } from "../lib/units";
import { usePrefs } from "../state/prefs";
import { CORNERS } from "../state/plan";
import { Delta } from "./delta";
import { Kv } from "./cars";

const r0 = (v: unknown): number => (typeof v === "number" && isFinite(v) ? v : 0);
const stCls = (s: State | string) => (s === "ok" || s === "none" ? "" : "s-" + s);
const sc = (c: Ctx) => ({ th: c.th, wet: c.wet, fuelLowLaps: c.cfg?.fuel_low_laps ?? 3 });
const psiWindow = (c: Ctx) => (c.wet ? c.th.wet_psi : c.th.dry_psi);

/** Core temperature: the average of the three bands when the game sends them, else the core value. */
const coreT = (a: Json, i: number, cap: Json) => (cap?.tyre_edge_temps ? (a.tyre_temp_inner_c[i] + a.tyre_temp_middle_c[i] + a.tyre_temp_outer_c[i]) / 3 : a.tyre_core_temp_c[i]);

// ---------- driver inputs ----------
const pct = (v: number) => (clamp(v, 0, 1) * 100).toFixed(0);

export const carStatus = defineModule({
  type: "car-status", title: "Driver inputs", group: "Car", blurb: "Gear, speed, RPM, pedals, steering and the car's state flags, live.",
  size: { w: 3, h: 7, minW: 3, minH: 4 }, needs: ["reading"], requires: ["reading"], rate: 60,
  view({ ctx: c, size }) {
    const p = usePrefs();
    const a = c.r!.car, s = c.r!.session, max = c.r!.fixed.max_rpm || 8000, rp = clamp(a.rpm / max, 0, 1);
    const st = clamp(a.steer_angle, -1, 1), deg = Math.round(st * (c.r!.fixed.max_steer_deg || 270) / 2);
    const gear = a.gear < 0 ? "R" : a.gear === 0 ? "N" : String(a.gear);
    const sp = fv("speed", a.speed_kmh, p.units), su = unit("speed", p.units).u;
    const tag = (on: boolean, t: string, cls: string) => on ? <span key={t} className={"tag " + cls}>{t}</span> : null;
    const info = [
      tag(true, "ABS", a.abs_in_action ? "wn" : "n"), tag(true, "TC", a.tc_in_action ? "wn" : "n"),
      tag(!!a.pit_limiter, "LIMITER", "wn"), tag(!!s.in_pit_lane, "PIT LANE", "n"), tag(!!s.in_pit_box, "IN BOX", "n"), tag(a.tyres_off_track > 0, `${a.tyres_off_track} OFF`, "up"), tag(!s.lap_is_valid, "INVALID", "up"),
    ];
    const large = size.h >= 6;
    const dir = (l: string, v: number, cls: string) => (
      <div className="fc" style={{ alignItems: "center", gap: 4, flex: 1 }} key={l}>
        <span className="v" style={{ fontSize: 10.5 }}>{l === "STR" ? `${deg < 0 ? MINUS : ""}${Math.abs(deg)}°` : pct(v)}</span>
        <div style={{ width: 14, height: 36, background: "var(--ln)", position: "relative" }}><div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: (l === "STR" ? Math.abs(st) * 100 : clamp(v, 0, 1) * 100) + "%", background: cls }} /></div>
        <span className="lab" style={{ fontSize: 9 }}>{l}</span>
      </div>
    );
    if (!large) {
      return {
        flush: true, info,
        body: (
          <div className="cells" style={{ height: "100%" }}>
            <div className="c" style={{ flex: "none", width: 80 }}><span className="lab">Gear</span><span className="big">{gear}</span></div>
            <div className="c"><span className="lab">Speed</span><span className="big">{sp}</span><span className="v di">{su} · {nf(a.rpm, 0)} rpm</span></div>
            <div className="c" style={{ flex: "none", width: 150, padding: "6px 12px", flexDirection: "row", alignItems: "center", gap: 0 }}>
              {dir("THR", a.throttle, "var(--ok)")}{dir("BRK", a.brake, "var(--bad)")}{dir("STR", st, "var(--warn)")}
            </div>
          </div>
        ),
      };
    }
    const bar = (l: string, v: number, cls: string, text: string) => (
      <div className="f" style={{ gap: 10 }} key={l}><span className="lab" style={{ width: 28 }}>{l}</span><div className={"bar tall tk sp " + cls}><i style={{ width: clamp(v, 0, 1) * 100 + "%" }} /></div><span className="v" style={{ width: 40, textAlign: "right" }}>{text}</span></div>
    );
    return {
      flush: true, info,
      body: (
        <>
          <div className="f" style={{ flex: "none", borderBottom: "1px solid var(--ln)", gap: 0 }}>
            <div className="c" style={{ width: 96, flex: "none", padding: "var(--pad)", borderRight: "1px solid var(--ln)", display: "flex", flexDirection: "column", gap: 6 }}><span className="lab">Gear</span><span className="big" style={{ fontSize: 44, lineHeight: "40px" }}>{gear}</span></div>
            <div className="c" style={{ flex: 1, padding: "var(--pad)", borderRight: "1px solid var(--ln)", display: "flex", flexDirection: "column", gap: 6 }}><span className="lab">Speed</span><span className="big" style={{ fontSize: 34 }}>{sp}<span className="u">{su}</span></span></div>
            <div className="c" style={{ width: 120, flex: "none", padding: "var(--pad)", display: "flex", flexDirection: "column", gap: 6 }}><span className="lab">RPM</span><span className="big" style={{ fontSize: 26 }}>{nf(a.rpm, 0)}</span></div>
          </div>
          <div className="f" style={{ gap: 10, padding: "10px var(--pad) 0" }}>
            <span className="lab" style={{ width: 28 }}>Rev</span>
            <div className="bar tall tk sp"><i style={{ width: rp * 100 + "%", background: "var(--tx)" }} /><span style={{ position: "absolute", left: "92%", right: 0, top: 0, bottom: 0, background: "#ff5c6c55" }} /></div>
            <span className="v di" style={{ width: 40, textAlign: "right" }}>{nf(max, 0)}</span>
          </div>
          <div className="fc" style={{ padding: "10px var(--pad) 0", gap: 8 }}>
            {bar("Thr", a.throttle, "ok", pct(a.throttle))}{bar("Brk", a.brake, "bd", pct(a.brake))}
            <div className="f" style={{ gap: 10 }}><span className="lab" style={{ width: 28 }}>Str</span>
              <div className="bar tall sp" style={{ background: "var(--ln)" }}><i style={{ left: st < 0 ? 50 + st * 50 + "%" : "50%", width: Math.abs(st) * 50 + "%", background: "var(--warn)" }} /><span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--t3)" }} /></div>
              <span className="v" style={{ width: 40, textAlign: "right" }}>{deg < 0 ? MINUS : ""}{Math.abs(deg)}°</span></div>
          </div>
        </>
      ),
    };
  },
});

// ---------- lap timer ----------
export const lapTimer = defineModule({
  type: "lap-timer", title: "Lap", group: "Car", blurb: "The lap in progress, live delta, last, best and the game's estimate.",
  size: { w: 3, h: 6, minW: 3, minH: 4 }, needs: ["reading", "summary", "laps", "field"], requires: ["reading"], rate: 15,
  view({ ctx: c, size }) {
    const s = c.r!.session, a = c.r!.car, inv = !s.lap_is_valid;
    const best = c.s && c.s.best_ms != null ? c.s.best_ms : okMs(s.best_lap_ms) ? s.best_lap_ms : null;
    const d = a.reference_delta_s == null ? null : a.reference_delta_s * 1000;
    const sb = best != null && c.field?.best?.ms === best;
    const last = c.laps.length ? c.laps[c.laps.length - 1] : null;
    const large = size.h >= 5, compact = size.h <= 4;
    const nSec = r0(c.r!.fixed.sector_count) || 3, now = s.current_sector | 0, done = (c.s?.lap_sectors_ms as number[] | undefined) ?? [];
    const lapsDone = c.laps.filter((l) => l.valid !== false && Array.isArray(l.s) && l.s.length === nSec);
    const pb = (k: number) => Math.min(...lapsDone.map((l) => (l.s as number[])[k]!).filter((v) => v > 0), Infinity);
    const sbest = (k: number) => Math.min(...[...c.cars.values()].map((x) => (x.best_s ?? [])[k] ?? 0).filter((v) => v > 0), Infinity);
    const prev = c.laps.slice().reverse().find((l) => Array.isArray(l.s) && l.s.length === nSec)?.s as number[] | undefined; // until this lap overwrites them
    const sectors = (
      <div className="cells" style={{ borderTop: "1px solid var(--ln)", flex: "none" }}>
        {Array.from({ length: nSec }, (_, k) => {
          const v = done[k], live = k === now && done.length === k && !inv, mark = v != null && v === sbest(k) ? "◆ " : v != null && v === pb(k) && lapsDone.length >= 3 ? "● " : "";
          const vs = Number.isFinite(pb(k)) && v != null ? v - pb(k) : null;
          return (
            <div className="c" key={k} aria-current={live ? "step" : undefined} style={compact ? { flexDirection: "row", alignItems: "center", gap: 6, padding: "4px var(--pad)" } : { gap: 4 }}>
              <span className="lab">S{k + 1}</span>
              {v != null ? <span className={(compact ? "v " : "mid ") + (mark === "◆ " ? "b" : mark ? "p" : "")}>{mark}{fmtSector(v)}</span>
                : live ? <span className={(compact ? "v " : "mid ") + "ac"}>{fmtSector(s.current_lap_ms - done.reduce((a, b) => a + b, 0))}</span> : <span className={(compact ? "v " : "mid ") + "mu"} title={prev?.[k] != null ? "Last lap" : undefined}>{prev?.[k] != null ? fmtSector(prev[k]) : NONE}</span>}
              {!compact && size.h >= 7 && vs != null && Math.abs(vs) >= 1 ? <span className="v"><Delta ms={vs} /></span> : null}
            </div>
          );
        })}
      </div>
    );
    const delta = d == null || !isFinite(d) ? <span className="big">{NONE}</span> : <span className={"big " + (d < -5 ? "dn" : d > 5 ? "up" : "")}>{d < -5 ? "▼" : d > 5 ? "▲" : ""} {(Math.abs(d) / 1000).toFixed(3)}</span>;
    const cur = <span className={"big" + (inv ? " iv" : "")}>{fmtLap(s.current_lap_ms).replace(/^(\d):/, "$1:")}</span>;
    return {
      flush: true,
      info: large ? [`LAP ${s.lap_number || NONE}`] : [],
      body: (
        <>
          <div className={large ? "cells h" : "cells"} style={large ? { borderBottom: 0 } : { flex: 1, minHeight: 0 }}>
            <div className="c"><span className="lab">Current</span>{cur}</div>
            <div className="c"><span className="lab">{large ? "Live delta" : "Delta"}</span>{delta}</div>
          </div>
          {sectors}
          {large ? (
            <div style={{ padding: "0 var(--pad) var(--pad)" }}>
              <div className="r" data-p="1"><span>Last</span><span className={last && last.valid === false ? "iv" : last && last.ms === best ? "p" : ""}>{last && last.ms === best ? "● " : ""}{fmtLap(s.last_lap_ms)}</span></div>
              <div className="r" data-p="2"><span>Best</span><span className={sb ? "b" : ""}>{sb ? "◆ " : ""}{best == null ? NONE : fmtLap(best)}</span></div>
              <div className="r" data-p="3"><span>Game estimate</span><span className="mu">{fmtLap(s.estimated_lap_ms)}</span></div>
            </div>
          ) : null}
        </>
      ),
    };
  },
});

// ---------- tyres ----------
/** A value inside its window: the window is shaded, the marker is the value. */
function Gz({ v, lo, hi, min, max, cls }: { v: number; lo: number; hi: number; min: number; max: number; cls: string }) {
  const pc = (x: number) => clamp(((x - min) / (max - min)) * 100, 0, 100);
  return <div className="gz sp" style={{ margin: 0, flex: "none", width: "100%" }}><b style={{ left: pc(lo) + "%", width: pc(hi) - pc(lo) + "%" }} /><i className={cls} style={{ left: pc(v) + "%" }} /></div>;
}

const NAMES = ["Front left", "Front right", "Rear left", "Rear right"];

export const tyres = defineModule({
  type: "tyres", title: "Tyres", group: "Car", blurb: "Pressures, core temperatures and brakes at each corner, and the next stop's correction.",
  size: { w: 4, h: 9, minW: 3, minH: 6 }, needs: ["reading", "summary", "config", "units"], requires: ["reading"], rate: 5,
  options: [
    { key: "corrections", label: "Show the next stop's correction", type: "toggle", def: true },
    { key: "brakes", label: "Show brakes", type: "toggle", def: true },
  ],
  view({ ctx: c, opts, size }) {
    const p = usePrefs(), u = p.units;
    const r = c.r!, a = r.car, pl = c.s?.press_line, cap = r.capabilities ?? {}, ctx = sc(c);
    const [lo, hi] = psiWindow(c), mid = (lo + hi) / 2;
    const [tlo, thi] = c.th.tyre_c;
    const ps = (a.tyre_pressure_psi as number[]).map((v) => pressState(v, ctx));
    const ts = [0, 1, 2, 3].map((i) => tyreState(coreT(a, i, cap), ctx));
    const bs = (a.brake_temp_c as number[]).map((t, i) => brakeState(t, i < 2 ? "front" : "rear", ctx));
    const pu = unit("press", u), tu = unit("temp", u).u;
    const worstOf = (...x: State[]) => (x.includes("bad") ? 2 : x.some((y) => y === "warn" || y === "cold") ? 1 : 0);
    const large = size.w >= 4 && size.h >= 8;
    const lapsOn = c.s ? c.s.stint_laps : null;
    const pcls = (s: State) => (s === "ok" ? "" : s === "bad" ? "up" : s === "cold" ? "cd" : "wn");
    const corr = (i: number) => (pl && Array.isArray(pl.psi) ? mid - (pl.psi as number[])[i]! : null);
    const setCold = (i: number) => { const cx = corr(i); return cx == null ? null : (a.tyre_pressure_psi as number[])[i]! + cx; };
    const alert: [number] = [worstOf(...ps, ...ts, ...(opts.brakes ? bs : []))];
    if (!large && size.h >= 6) {
      const num = (label: string, cls: string, v: string, unitS: string, tag?: string, centre?: boolean) => {
        const extra = <><span className="u" style={{ fontSize: 10, marginLeft: 2 }}>{unitS}</span>{tag ? <span className="v" style={{ fontSize: 10.5, marginLeft: 4 }}>{tag}</span> : null}</>;
        return (
          <div className="fc" style={{ gap: 1, minWidth: 0, alignItems: centre ? "center" : "flex-start" }}>
            <span className="v di" style={{ fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase" }}>{label}</span>
            <span className={"big " + cls} style={{ fontSize: size.w < 4 ? 20 : 24, whiteSpace: "nowrap", position: "relative" }}>
              {v}{centre ? <span style={{ position: "absolute", left: "100%", bottom: 1, whiteSpace: "nowrap", lineHeight: 1 }}>{extra}</span> : extra}
            </span>
          </div>
        );
      };
      return {
        flush: true, alert, info: [`SET ${r.session.tyre_set || NONE}`, `HOT ${fv("press", lo, u)}–${fv("press", hi, u)}`],
        body: (
          <div className="fc" style={{ flex: 1, minHeight: 0 }}>
            {CORNERS.map((n, i) => {
              const sc0 = setCold(i), cx = corr(i), dd = (a.tyre_pressure_psi as number[])[i]! - mid;
              const pd = ps[i] === "ok" ? "" : `${dd > 0 ? "▲ +" : "▼ " + MINUS}${Math.abs(pu.f(dd) - pu.f(0)).toFixed(pu.d)}`;
              return (
                <div key={n} className="f" style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "2px 12px", gap: 8, alignItems: "center", borderBottom: "1px solid var(--ln)" }}>
                  <div className="fc" style={{ width: 52, gap: 2, flex: "none", whiteSpace: "nowrap" }}>
                    <span className="v" style={{ fontWeight: 600 }}>{n}</span>
                    {opts.corrections && size.h >= 7 && sc0 != null ? <span className="v ac" style={{ fontSize: 10.5 }}>set {fv("press", sc0, u)}</span> : null}
                    {opts.corrections && size.h >= 8 && cx != null && Math.abs(cx) >= 0.05 ? <span className={"v " + (cx < 0 ? "dn" : "up")} style={{ fontSize: 10.5 }}>{cx < 0 ? "▼" : "▲"} {Math.abs(pu.f(cx) - pu.f(0)).toFixed(pu.d)}</span> : null}
                  </div>
                  <div style={{ flex: 1.9, minWidth: 0 }}>{num("Pressure", pcls(ps[i]!), fv("press", (a.tyre_pressure_psi as number[])[i], u), pu.u, pd)}</div>
                  <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>{num("Core", pcls(ts[i]!), fv("temp", coreT(a, i, cap), u), tu, ts[i] === "ok" ? "" : STATE_WORD[ts[i]!] ?? "", true)}</div>
                  <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>{opts.brakes ? num("Brake", pcls(bs[i]!), fv("temp", (a.brake_temp_c as number[])[i], u), tu, bs[i] === "ok" ? "" : STATE_WORD[bs[i]!] ?? "", true) : null}</div>
                </div>
              );
            })}
          </div>
        ),
      };
    }
    if (!large) {
      return {
        flush: true, alert, info: [`SET ${r.session.tyre_set || NONE}`],
        body: (
          <table className="t">
            <thead><tr><th className="l">Corner</th><th>{pu.u}</th><th>Core °{tu.replace("°", "")}</th><th>Brake °{tu.replace("°", "")}</th><th>Set cold</th></tr></thead>
            <tbody>
              {CORNERS.map((n, i) => (
                <tr key={n}><td className="l">{n}</td><td className={pcls(ps[i]!)}>{fv("press", (a.tyre_pressure_psi as number[])[i], u)}{stateGlyph(ps[i]!)}</td><td className={pcls(ts[i]!)}>{fv("temp", coreT(a, i, cap), u)}</td><td className={pcls(bs[i]!)}>{fv("temp", (a.brake_temp_c as number[])[i], u)}</td><td className="ac">{setCold(i) != null ? fv("press", setCold(i), u) : NONE}</td></tr>
              ))}
            </tbody>
          </table>
        ),
      };
    }
    const row = (label: string, val: string, unitS: string, g: React.ReactNode, tail: React.ReactNode) => (
      <div className="fc" style={{ gap: 4 }}><div className="f" style={{ gap: 8 }}><span className="lab" style={{ width: 40 }}>{label}</span><span className="v" style={{ fontSize: 12.5 }}>{val}<span className="u">{unitS}</span></span><span style={{ marginLeft: "auto" }}>{tail}</span></div>{g}</div>
    );
    return {
      flush: true, alert,
      info: [`SET ${r.session.tyre_set || NONE}${lapsOn != null ? ` · ${lapsOn} LAPS` : ""}`, `HOT ${fv("press", lo, u)}–${fv("press", hi, u)}`],
      body: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 4, padding: 6, flex: 1, minHeight: 0 }}>
          {[0, 1, 2, 3].map((i) => {
            const front = i < 2, core = coreT(a, i, cap), pr = (a.tyre_pressure_psi as number[])[i]!, bt = (a.brake_temp_c as number[])[i]!;
            const bw = c.th.brake_c[front ? "front" : "rear"] ?? c.th.brake_c.front, [blo, bhi] = bw;
            const cx = corr(i), sc0 = setCold(i), dd = pr - mid;
            return (
              <div className="dk" key={i} style={{ padding: "7px 12px", gap: 6, justifyContent: "space-between" }}>
                <div><span className="lab" style={{ color: "var(--t2)" }}>{NAMES[i]}</span>{opts.corrections && sc0 != null ? <span className="v ac">set {fv("press", sc0, u)} <span className={cx! < 0 ? "dn" : "up"}>{Math.abs(cx!) < 0.05 ? "" : `${cx! < 0 ? "▼" : "▲"} ${Math.abs(pu.f(cx!) - pu.f(0)).toFixed(pu.d)}`}</span></span> : null}</div>
                {row("Press", fv("press", pr, u), pu.u, <Gz v={pr} lo={lo} hi={hi} min={lo - 2} max={hi + 2.5} cls={ps[i] === "ok" ? "" : "w"} />, <span className={"v " + (ps[i] === "ok" ? "di" : pcls(ps[i]!))} style={{ whiteSpace: "nowrap" }}>{ps[i] === "ok" ? "ok" : `${dd > 0 ? "▲ +" : "▼ " + MINUS}${Math.abs(pu.f(dd) - pu.f(0)).toFixed(pu.d)}`}</span>)}
                {row("Core", fv("temp", core, u), tu, <Gz v={core} lo={tlo} hi={thi} min={Math.max(0, tlo - 30)} max={thi + 30} cls={ts[i] === "ok" ? "" : "w"} />, <span className={"v " + (ts[i] === "ok" ? "di" : pcls(ts[i]!))} style={{ whiteSpace: "nowrap" }}>{ts[i] === "ok" ? "ok" : STATE_WORD[ts[i]!] ?? ""}</span>)}
                {opts.brakes ? row("Brake", fv("temp", bt, u), tu, <Gz v={bt} lo={blo} hi={bhi - 100} min={0} max={bhi + 150} cls={bs[i] === "ok" ? "" : "w"} />, <span className={"v " + (bs[i] === "ok" ? "di" : pcls(bs[i]!))} style={{ whiteSpace: "nowrap" }}>{bs[i] === "ok" ? "ok" : STATE_WORD[bs[i]!] ?? ""}</span>) : null}
              </div>
            );
          })}
        </div>
      ),
    };
  },
});

// ---------- tyre history ----------
export const tyreHistory = defineModule({
  type: "tyre-history", title: "Tyre history", group: "Car", blurb: "Pressures and core temperatures at the line, lap by lap.",
  size: { w: 8, h: 11, minW: 4, minH: 6 }, needs: ["laps", "units", "config"],
  view({ ctx: c, size }) {
    const p = usePrefs(), u = p.units;
    const L = c.laps.filter((l) => Array.isArray(l.psi));
    if (!L.length) return { state: { kind: "empty", msg: "Filled as laps are completed." } };
    const large = size.w >= 6;
    const rows = L.slice().reverse();
    const bl = { borderLeft: "1px solid var(--ln)" };
    return {
      flush: true,
      info: [large ? "AT THE LINE, LAP BY LAP" : `${unit("press", u).u.toUpperCase()} AT THE LINE`],
      body: large ? (
        <table className="t">
          <thead>
            <tr><th /><th colSpan={4} style={bl}>Pressure {unit("press", u).u}</th><th colSpan={4} style={bl}>Core temperature {unit("temp", u).u}</th><th style={bl} /></tr>
            <tr><th>Lap</th>{CORNERS.map((x, i) => <th key={"p" + x} style={i ? undefined : bl}>{x}</th>)}{CORNERS.map((x, i) => <th key={"t" + x} style={i ? undefined : bl}>{x}</th>)}<th style={bl}>Set</th></tr>
          </thead>
          <tbody>
            {rows.map((l, k) => {
              const cx = { th: c.th, wet: !!l.wet, fuelLowLaps: 3 };
              return (
                <tr key={l.n} className={k === 0 ? "cur" : undefined}>
                  <td className="mu">{l.n}</td>
                  {(l.psi as number[]).map((x, i) => { const s = pressState(x, cx); return <td key={"p" + i} className={pcls0(s)} style={i ? undefined : bl}>{fv("press", x, u)}{stateGlyph(s)}</td>; })}
                  {((l.core as number[] | undefined) ?? []).map((t, i) => { const s = tyreState(t, cx); return <td key={"t" + i} className={pcls0(s)} style={i ? undefined : bl}>{fv("temp", t, u)}{stateGlyph(s)}</td>; })}
                  <td style={bl}>{l.wet ? "W" : ""}{nf(l.set, 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <table className="t">
          <thead><tr><th>Lap</th>{CORNERS.map((x) => <th key={x}>{x}</th>)}<th>Set</th></tr></thead>
          <tbody>
            {rows.map((l, k) => {
              const cx = { th: c.th, wet: !!l.wet, fuelLowLaps: 3 };
              return <tr key={l.n} className={k === 0 ? "cur" : undefined}><td className="mu">{l.n}</td>{(l.psi as number[]).map((x, i) => { const s = pressState(x, cx); return <td key={i} className={pcls0(s)}>{fv("press", x, u)}{stateGlyph(s)}</td>; })}<td>{nf(l.set, 0)}</td></tr>;
            })}
          </tbody>
        </table>
      ),
    };
  },
});
const pcls0 = (s: State) => (s === "ok" ? "" : s === "bad" ? "up" : s === "cold" ? "cd" : "wn");

// ---------- brakes ----------
export const brakes = defineModule({
  type: "brakes", title: "Brakes", group: "Car", blurb: "Pad and disc thickness, wear per lap, laps left on the pads, and temperatures.",
  size: { w: 4, h: 6, minW: 3, minH: 5 }, needs: ["reading", "summary", "config", "units"], requires: ["reading"],
  view({ ctx: c, size }) {
    const p = usePrefs(), u = p.units, ctx = sc(c);
    const a = c.r!.car, stint = (c.s?.stint as Json[] | undefined) ?? [];
    const first = stint.length ? stint[0]!.pads : null, last = stint.length ? stint[stint.length - 1]!.pads : null, low = c.th.pad_low_mm;
    const wear = (i: number): number | null => (first && last && stint.length > 1 ? (first[i] - last[i]) / (stint.length - 1) : null);
    const pads = a.brake_pad_mm as number[], temps = a.brake_temp_c as number[], disc = a.brake_disc_mm as number[];
    const tstate = (t: number, i: number) => brakeState(t, i < 2 ? "front" : "rear", ctx);
    const large = size.w >= 4 && size.h >= 6;
    const left = (i: number) => { const w = wear(i); return w != null && w > 0 ? Math.floor((pads[i]! - low) / w) : null; };
    return {
      flush: true,
      info: [large ? "PADS AND DISCS" : "PADS"],
      alert: [Math.max(...pads.map((v) => (padState(v, ctx) === "bad" ? 2 : 0)), ...temps.map((t, i) => { const s = tstate(t, i); return s === "bad" ? 2 : s === "warn" ? 1 : 0; }))],
      body: (
        <table className="t">
          <thead><tr><th className="l">Corner</th><th>Pad mm</th>{large ? <><th>Disc mm</th><th>Wear /lap</th></> : null}<th>Laps left</th><th>{large ? `Temp °${unit("temp", u).u.replace("°", "")}` : "Temp"}</th></tr></thead>
          <tbody>
            {CORNERS.map((n, i) => {
              const ps = padState(pads[i]!, ctx), ts = tstate(temps[i]!, i), lf = left(i);
              return (
                <tr key={n}>
                  <td className="l">{large ? NAMES[i] : n}</td><td className={pcls0(ps)}>{nf(pads[i], 1)}{stateGlyph(ps)}</td>
                  {large ? <><td>{nf(disc[i], 1)}</td><td>{wear(i) != null ? nf(wear(i), 2) : NONE}</td></> : null}
                  <td className={lf != null && lf < 20 ? "wn" : ""}>{lf ?? NONE}</td><td className={pcls0(ts)}>{fv("temp", temps[i], u)}{stateGlyph(ts)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ),
    };
  },
});

// ---------- electronics ----------
export const electronics = defineModule({
  type: "electronics", title: "Electronics", group: "Car", blurb: "Brake bias, TC, ABS, engine map, lights and wipers.",
  size: { w: 4, h: 5, minW: 3, minH: 4 }, needs: ["reading"], requires: ["reading"],
  view({ ctx: c, size }) {
    const a = c.r!.car, s = c.r!.session;
    const large = size.w >= 4 && size.h >= 5;
    const cell = (l: string, v: ReactNode) => <div className="c" key={l}><span className="lab">{l}</span>{large ? <span className="big">{v}</span> : <span className="mid">{v}</span>}</div>;
    const bb = a.brake_bias != null ? <>{nf(a.brake_bias, 1)}{large ? <span className="u">%</span> : null}</> : NONE;
    return {
      flush: true,
      info: large ? [`LIGHTS ${(["off", "low", "high"][a.lights_stage | 0] ?? NONE).toUpperCase()}`, `WIPERS ${a.wiper ? nf(a.wiper, 0) : "OFF"}`] : [],
      body: (
        <div className="cells" style={{ height: "100%" }}>
          {cell(large ? "Brake bias" : "BB", bb)}{cell("TC", nf(a.tc_level, 0))}{cell("ABS", nf(a.abs_level, 0))}{cell(large ? "Engine map" : "Map", nf(s.engine_map, 0))}
        </div>
      ),
    };
  },
});

// ---------- damage & engine ----------
export const ZONES = ["Front", "Rear", "Left", "Right", "Centre"];

/** The nine zones as the car seen from above, front at the top; each card carries a bar and a state. */
function DamageCards({ dmg, sus }: { dmg: number[]; sus: number[] }) {
  const body = (i: number, label: string): [string, number, string] => { const v = dmg[i] ?? 0; return [label, v, bodyState(v)]; };
  const susp = (i: number): [string, number, string] => { const v = sus[i] ?? 0; return ["Susp " + CORNERS[i], v, suspState(v)]; };
  const cells = [susp(0), body(0, "Front"), susp(1), body(2, "Left"), body(4, "Roof"), body(3, "Right"), susp(2), body(1, "Rear"), susp(3)];
  const K: Record<string, [string, string, string]> = { none: ["o", "", "ok"], ok: ["o", "", "ok"], warn: ["w", "wn", "wn"], bad: ["b", "up", "bd"] };
  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gridTemplateRows: "repeat(3,1fr)", gap: 4, padding: 6, borderRight: "1px solid var(--ln)", minWidth: 0 }}>
      {cells.map(([label, v, st]) => {
        const [dk, tx, bar] = K[st]!, isS = label.startsWith("Susp");
        return (
          <div className={"dk " + dk} key={label}>
            <div><span className="lab">{label}</span><span className={"v " + tx}>{st === "ok" || st === "none" ? "" : "▲ "}{isS ? v.toFixed(2) : nf(v, 0)}</span></div>
            <div className={"bar " + bar}><i style={{ width: Math.min(100, isS ? v * 100 : v / 2) + "%" }} /></div>
          </div>
        );
      })}
    </div>
  );
}

export const damage = defineModule({
  type: "damage", title: "Damage and engine", group: "Car", blurb: "Bodywork and suspension damage, water and exhaust temperature.",
  size: { w: 4, h: 6, minW: 3, minH: 5 }, needs: ["reading", "config", "units"], requires: ["reading"],
  options: [{ key: "view", label: "View", type: "select", choices: [["auto", "Auto"], ["cards", "Cards"], ["table", "Table"]], def: "auto" }],
  view({ ctx: c, opts, size }) {
    const p = usePrefs(), u = p.units;
    const a = c.r!.car, dmg = ((a.damage as number[] | undefined) ?? []).slice(0, 5), sus = (a.suspension_damage as number[] | undefined) ?? [];
    const bs = dmg.map((v) => bodyState(v)), ss = sus.map((v) => suspState(v)), any = [...bs, ...ss].some((s) => s === "warn" || s === "bad"), ws = waterState(a.water_temp_c, sc(c));
    const mode = opts.view === "auto" ? (size.w >= 4 && size.h >= 6 ? "cards" : "table") : (opts.view as string);
    const tu = unit("temp", u).u;
    const water = <><span className={stCls(ws)}>{fv("temp", a.water_temp_c, u)}{stateGlyph(ws)}</span><span className="u"> {tu}</span></>;
    const exhaust = <>{fv("temp", a.exhaust_temp_c, u)}<span className="u"> {tu}</span></>;
    const cls = (s: State) => (s === "bad" ? "up" : s === "warn" ? "wn" : "");
    const zoneRows: [string, number, number][] = [["Front", dmg[0] ?? 0, sus[0] ?? 0], ["Rear", dmg[1] ?? 0, sus[2] ?? 0], ["Left", dmg[2] ?? 0, sus[1] ?? 0], ["Right", dmg[3] ?? 0, sus[3] ?? 0]];
    return {
      flush: true,
      alert: [Math.max(stateLevel(ws), ...bs.map(stateLevel), ...ss.map(stateLevel))],
      info: mode === "cards" ? ["FRONT AT THE TOP"] : [],
      body: mode === "cards" ? (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <DamageCards dmg={dmg} sus={sus} />
          <div className="fc" style={{ width: 170, flex: "none", padding: 8 }}><span className="lab">Engine</span><div><div className="r"><span>Water</span><span>{water}</span></div><div className="r"><span>Exhaust</span><span>{exhaust}</span></div></div></div>
        </div>
      ) : (
        <table className="t">
          <thead><tr><th className="l">Zone</th><th>Body</th><th>Susp.</th></tr></thead>
          <tbody>
            {zoneRows.filter(([, b, sp]) => bodyState(b) !== "ok" || suspState(sp) !== "ok").map(([z, b, sp]) => <tr key={z}><td className="l">{z}</td><td className={cls(bodyState(b))}>{bodyState(b) === "ok" ? "" : "▲ "}{nf(b, 0)}</td><td className={cls(suspState(sp))}>{suspState(sp) === "ok" ? "" : "▲ "}{nf(sp, 2)}</td></tr>)}
            {!any ? <tr><td className="l">Damage</td><td colSpan={2} className="dn">none</td></tr> : null}
            <tr><td className="l">Water · exhaust</td><td colSpan={2}>{fv("temp", a.water_temp_c, u)} · {fv("temp", a.exhaust_temp_c, u)} {tu}</td></tr>
          </tbody>
        </table>
      ),
    };
  },
});

