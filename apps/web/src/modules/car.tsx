import { ReactNode } from "react";
import { defineModule } from "../engine/registry";
import type { Ctx } from "../feed/store";
import type { Json } from "../feed/types";
import { Icon } from "../lib/icons";
import { clamp, fmtLap, MINUS, nf, NONE, okMs, plural } from "../lib/format";
import { brakeState, padState, pressState, State, STATE_WORD, stateGlyph, tyreState, waterState } from "../lib/states";
import { fv, unit } from "../lib/units";
import { usePrefs } from "../state/prefs";
import { CORNERS } from "../state/plan";
import { Delta } from "./delta";
import { Kv } from "./cars";

const stCls = (s: State | string) => (s === "ok" || s === "none" ? "" : "s-" + s);
const sc = (c: Ctx) => ({ th: c.th, wet: c.wet, fuelLowLaps: c.cfg?.fuel_low_laps ?? 3 });
const psiWindow = (c: Ctx) => (c.wet ? c.th.wet_psi : c.th.dry_psi);

/** Core temperature: the average of the three bands when the game sends them, else the core value. */
const coreT = (a: Json, i: number, cap: Json) => (cap?.tyre_edge_temps ? (a.tyre_temp_inner_c[i] + a.tyre_temp_middle_c[i] + a.tyre_temp_outer_c[i]) / 3 : a.tyre_core_temp_c[i]);

// ---------- driver inputs ----------
const Meter = ({ label, cls, value, text, warn }: { label: string; cls: string; value: number; text: string; warn?: string }) => (
  <div className="cs-m"><span className="lbl">{label}</span><div className={`bar ${cls}`}><i className={warn} style={{ width: value * 100 + "%" }} /></div><span className="n">{text}</span></div>
);

export const carStatus = defineModule({
  type: "car-status", title: "Driver inputs", group: "Car", blurb: "Gear, speed, RPM, pedals, steering and the car's state flags, live.",
  size: { w: 3, h: 7, minW: 3, minH: 4 }, needs: ["reading"], requires: ["reading"], rate: 60,
  view({ ctx: c }) {
    const p = usePrefs();
    const a = c.r!.car, s = c.r!.session, max = c.r!.fixed.max_rpm || 8000, rp = clamp(a.rpm / max, 0, 1);
    const st = clamp(a.steer_angle, -1, 1);
    const chips: [boolean, string, string][] = [
      [a.pit_limiter, "gauge", "LIMITER"], [s.in_pit_lane, "square-parking", "PIT LANE"], [s.in_pit_box, "wrench", "IN BOX"], [a.tc_in_action, "activity", "TC"], [a.abs_in_action, "disc", "ABS"],
      [a.tyres_off_track > 0, "triangle-alert", `${a.tyres_off_track} WHEEL${a.tyres_off_track > 1 ? "S" : ""} OFF`], [!s.lap_is_valid, "x", "INVALID LAP"],
    ];
    return {
      body: (
        <>
          <div className="cs-top">
            <div><div className="lbl">Gear</div><div className="big xl">{a.gear < 0 ? "R" : a.gear === 0 ? "N" : String(a.gear)}</div></div>
            <div><div className="lbl">Speed</div><div className="big">{fv("speed", a.speed_kmh, p.units)}<span className="u"> {unit("speed", p.units).u}</span></div></div>
            <b className="cs-shift s-bad" hidden={!(rp > 0.92)}>SHIFT</b>
          </div>
          <Meter label="RPM" cls="rpm" value={rp} text={nf(a.rpm, 0)} warn={rp > 0.92 ? "s-bad" : rp > 0.8 ? "s-warn" : ""} />
          <Meter label="Throttle" cls="thr" value={clamp(a.throttle, 0, 1)} text={(clamp(a.throttle, 0, 1) * 100).toFixed(0) + "%"} />
          <Meter label="Brake" cls="brk" value={clamp(a.brake, 0, 1)} text={(clamp(a.brake, 0, 1) * 100).toFixed(0) + "%"} />
          <Meter label="Clutch" cls="clu" value={clamp(a.clutch, 0, 1)} text={(clamp(a.clutch, 0, 1) * 100).toFixed(0) + "%"} />
          <div className="cs-m"><span className="lbl">Steer</span><div className="cs-steer"><i style={{ left: 50 + Math.min(0, st) * 50 + "%", width: Math.abs(st) * 50 + "%" }} /></div><span className="n">{nf(a.steer_angle, 2)}</span></div>
          <div className="cs-chips">
            {chips.filter((x) => x[0]).map(([, ic, w]) => <span key={w} className={`chip ${/OFF|INVALID/.test(w) ? "alert" : "on"}`}><Icon name={ic} />{w}</span>)}
          </div>
        </>
      ),
    };
  },
});

// ---------- lap timer ----------
export const lapTimer = defineModule({
  type: "lap-timer", title: "Lap", group: "Car", blurb: "The lap in progress, live delta, last, best and the game's estimate.",
  size: { w: 3, h: 5, minW: 3, minH: 4 }, needs: ["reading", "summary"], requires: ["reading"], rate: 15,
  view({ ctx: c }) {
    const s = c.r!.session, a = c.r!.car, inv = !s.lap_is_valid;
    const best = c.s && c.s.best_ms != null ? c.s.best_ms : okMs(s.best_lap_ms) ? s.best_lap_ms : null;
    const d = a.reference_delta_s == null ? null : a.reference_delta_s * 1000;
    const sb = best != null && c.field?.best?.ms === best;
    return {
      body: (
        <div data-loc={s.in_pit_lane ? "pit" : inv ? "invalid" : "track"} style={{ display: "contents" }}>
          <div className="lbl">Lap {s.lap_number || NONE} · sector {(s.current_sector | 0) + 1}/{c.r!.fixed.sector_count || 3}</div>
          <div className="lt-top">
            <div className="big">{inv ? <><span className="t-inv">{fmtLap(s.current_lap_ms)}</span> <b className="tag inv">INV</b></> : fmtLap(s.current_lap_ms)}</div>
            <div className="lt-d"><span className="lbl">Δ live</span><b className="n"><Delta ms={d} /></b></div>
          </div>
          <div className="sub lt-sub">
            <span>Last <b className="n">{fmtLap(s.last_lap_ms)}</b></span>
            <span>Best <b className="n">{best == null ? NONE : sb ? <span className="t-best">◆ {fmtLap(best)}</span> : fmtLap(best)}</b></span>
            <span>Est <b className="n">{fmtLap(s.estimated_lap_ms)}</b></span>
          </div>
        </div>
      ),
    };
  },
});

// ---------- tyres: the car from above ----------
/** A value as a marker inside its window, which is shaded. */
function Gauge({ v, lo, hi, min, max, s }: { v: number; lo: number; hi: number; min: number; max: number; s: State }) {
  const pc = (x: number) => clamp(((x - min) / (max - min)) * 100, 0, 100);
  return <div className="tg"><i style={{ left: pc(lo) + "%", width: pc(hi) - pc(lo) + "%" }} /><b className={stCls(s)} style={{ left: pc(v) + "%" }} /></div>;
}

function TyreTiles({ c, brakes }: { c: Ctx; brakes: boolean }) {
  const p = usePrefs(), u = p.units;
  const r = c.r!, a = r.car, cap = r.capabilities ?? {}, s = r.session, ctx = sc(c);
  const [tlo, thi] = c.th.tyre_c, [plo, phi] = psiWindow(c);
  const wet = !!s.rain_tyres;
  const tile = (i: number) => {
    const front = i < 2, core = coreT(a, i, cap), pr = a.tyre_pressure_psi[i], bt = a.brake_temp_c[i];
    const bw = c.th.brake_c[front ? "front" : "rear"] ?? c.th.brake_c.front;
    const [blo, bhi] = bw;
    const ts = tyreState(core, ctx), ps = pressState(pr, ctx), bs = brakeState(bt, front ? "front" : "rear", ctx);
    const all = [ts, ps, bs];
    const w = all.includes("bad") ? "bad" : all.includes("warn") ? "warn" : all.includes("cold") ? "cold" : "ok";
    const word = all.map((x) => STATE_WORD[x]).find(Boolean) ?? "";
    return (
      <div className={`tz-c ${stCls(w)}`} key={i}>
        <div className="tz-h"><b>{CORNERS[i]}</b><span className="tz-w">{word}</span></div>
        <div className={`tz-v ${stCls(ts)}`}>{fv("temp", core, u)}<span className="u">{unit("temp", u).u}</span><i>{stateGlyph(ts)}</i></div>
        <Gauge v={core} lo={tlo} hi={thi} min={Math.max(0, tlo - 30)} max={thi + 30} s={ts} />
        <div className="tz-r"><span>Pressure</span><b className={stCls(ps)}>{fv("press", pr, u)}{stateGlyph(ps)} <span className="u">{unit("press", u).u}</span></b></div>
        <Gauge v={pr} lo={plo} hi={phi} min={plo - 2} max={phi + 2.5} s={ps} />
        {brakes ? (
          <div className="tz-br">
            <div className="tz-r"><span>Brake</span><b className={stCls(bs)}>{fv("temp", bt, u)}{stateGlyph(bs)} <span className="u">{unit("temp", u).u}</span></b></div>
            <Gauge v={bt} lo={blo} hi={bhi - 100} min={0} max={bhi + 150} s={bs} />
          </div>
        ) : null}
      </div>
    );
  };
  return (
    <div className="tz">
      <div className="tz-bar"><span className={"tz-comp" + (wet ? " wet" : "")}>{wet ? "WET" : "DRY"}</span><span>Set {s.tyre_set || NONE}</span></div>
      <div className="tz-grid">{[0, 1, 2, 3].map(tile)}</div>
    </div>
  );
}

const worst = (ss: State[]) => (ss.includes("bad") ? 2 : ss.some((s) => s === "warn" || s === "cold") ? 1 : 0);

export const tyres = defineModule({
  type: "tyres", title: "Tyres", group: "Car", blurb: "Pressures, core temperatures and brakes on a car seen from above, and the next stop's correction.",
  size: { w: 4, h: 12, minW: 3, minH: 6 }, needs: ["reading", "summary", "config", "units"], requires: ["reading"], rate: 5,
  options: [
    { key: "corrections", label: "Show the next stop's correction", type: "toggle", def: true },
    { key: "brakes", label: "Show brakes", type: "toggle", def: true },
  ],
  view({ ctx: c, opts }) {
    const p = usePrefs(), u = p.units;
    const r = c.r!, a = r.car, pl = c.s?.press_line, cap = r.capabilities ?? {}, ctx = sc(c);
    const [lo, hi] = psiWindow(c), mid = (lo + hi) / 2;
    const ps = (a.tyre_pressure_psi as number[]).map((v) => pressState(v, ctx));
    const ts = [0, 1, 2, 3].map((i) => tyreState(coreT(a, i, cap), ctx));
    const bs = (a.brake_temp_c as number[]).map((t, i) => brakeState(t, i < 2 ? "front" : "rear", ctx));
    const cell = (v: string, s: State, i: number) => <td key={i} className={`n ${stCls(s)}`}>{v}{stateGlyph(s)}{s === "cold" && v !== NONE ? <span className="note"> COLD</span> : null}</td>;
    const pu = unit("press", u);
    const rows: [string, ReactNode[]][] = [];
    if (pl) rows.push(["Avg at line", (pl.psi as number[]).map((x, i) => cell(fv("press", x, u), pressState(x, ctx), i))]);
    if (opts.corrections && pl) {
      rows.push(["Next stop", (pl.psi as number[]).map((x, i) => {
        const d = mid - x, v = pu.f(d) - pu.f(0);
        return <td className="n" key={i}>{Math.abs(d) < 0.05 ? "0" : (d > 0 ? "▲ +" : "▼ " + MINUS) + Math.abs(v).toFixed(pu.d)}</td>;
      })]);
    }
    return {
      info: `stint ${c.s ? plural(c.s.stint_laps, "lap") : NONE} · window ${fv("press", lo, u)}–${fv("press", hi, u)} ${pu.u} (${r.fixed.car_class || "GT3"} ${c.wet ? "wet" : "dry"})`,
      alert: [worst(ps.concat(ts, opts.brakes ? bs : []))], // one alert per module: the tab badge counts problems, not corners
      body: (
        <>
          <TyreTiles c={c} brakes={!!opts.brakes} />
          <table className="tt ty-t" hidden={!rows.length}>
            <thead><tr><th />{CORNERS.map((x) => <th className="n" key={x}>{x}</th>)}</tr></thead>
            <tbody>{rows.map(([l, v]) => <tr key={l}><td>{l}</td>{v}</tr>)}</tbody>
          </table>
          <p className="note">ACC publishes core temperature only (no inner, middle or outer) and no tyre wear: Pace shows what the tyres cost in lap time.</p>
        </>
      ),
    };
  },
});

// ---------- tyre history ----------
export const tyreHistory = defineModule({
  type: "tyre-history", title: "Tyre history", group: "Car", blurb: "Pressures and core temperatures at the line, lap by lap.",
  size: { w: 8, h: 11, minW: 4, minH: 6 }, needs: ["laps", "units", "config"],
  view({ ctx: c }) {
    const p = usePrefs(), u = p.units;
    const L = c.laps.filter((l) => Array.isArray(l.psi));
    if (!L.length) return { state: { kind: "empty", msg: "Filled as laps are completed." } };
    return {
      info: `${plural(L.length, "lap")} · ${unit("press", u).u}, ${unit("temp", u).u}`,
      body: (
        <table className="tt th">
          <thead>
            <tr>
              <th className="n">Lap</th><th className="n">Set</th>
              {CORNERS.map((x) => <th className="n" key={"p" + x}>{x} {unit("press", u).u}</th>)}
              {CORNERS.map((x) => <th className="n" key={"t" + x}>{x} {unit("temp", u).u}</th>)}
              <th className="n">Track {unit("temp", u).u}</th>
            </tr>
          </thead>
          <tbody>
            {L.slice().reverse().map((l) => {
              const cx = { th: c.th, wet: !!l.wet, fuelLowLaps: 3 };
              return (
                <tr key={l.n}>
                  <td className="n">{l.n}</td><td className="n">{l.wet ? "W" : "D"}{nf(l.set, 0)}</td>
                  {(l.psi as number[]).map((x, i) => { const s = pressState(x, cx); return <td key={"p" + i} className={`n ${stCls(s)}`}>{fv("press", x, u)}{stateGlyph(s)}</td>; })}
                  {((l.core as number[] | undefined) ?? []).map((t, i) => { const s = tyreState(t, cx); return <td key={"t" + i} className={`n ${stCls(s)}`}>{fv("temp", t, u)}{stateGlyph(s)}</td>; })}
                  <td className="n">{fv("temp", l.track_c, u, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ),
    };
  },
});

// ---------- brakes ----------
export const brakes = defineModule({
  type: "brakes", title: "Brakes", group: "Car", blurb: "Pad and disc thickness, wear per lap, laps left on the pads, and temperatures.",
  size: { w: 4, h: 6, minW: 3, minH: 5 }, needs: ["reading", "summary", "config", "units"], requires: ["reading"],
  view({ ctx: c }) {
    const p = usePrefs(), u = p.units, ctx = sc(c);
    const a = c.r!.car, stint = (c.s?.stint as Json[] | undefined) ?? [];
    const first = stint.length ? stint[0]!.pads : null, last = stint.length ? stint[stint.length - 1]!.pads : null, low = c.th.pad_low_mm;
    const wear = (i: number): number | null => (first && last && stint.length > 1 ? (first[i] - last[i]) / (stint.length - 1) : null);
    const pads = a.brake_pad_mm as number[], temps = a.brake_temp_c as number[];
    const tstate = (t: number, i: number) => brakeState(t, i < 2 ? "front" : "rear", ctx);
    return {
      info: `pads F ${nf(a.front_pad_compound, 0)} · R ${nf(a.rear_pad_compound, 0)}${stint.length > 1 ? ` · over ${stint.length} laps` : ""}`,
      alert: [Math.max(...pads.map((v) => (padState(v, ctx) === "bad" ? 2 : 0)), ...temps.map((t, i) => { const s = tstate(t, i); return s === "bad" ? 2 : s === "warn" ? 1 : 0; }))],
      body: (
        <table className="tt br">
          <thead><tr><th />{CORNERS.map((x) => <th className="n" key={x}>{x}</th>)}</tr></thead>
          <tbody>
            <tr>
              <td>Pad mm</td>
              {pads.map((v, i) => {
                // The bar sits under the figure; its tick is the pads-low line.
                const s = padState(v, ctx), scale = Math.max(30, first ? first[i] : v);
                return (
                  <td className="n pad" key={i}>
                    <span className={stCls(s)}>{nf(v, 1)}{stateGlyph(s)}</span>
                    <div className="gauge"><i className={stCls(s)} style={{ width: clamp((v / scale) * 100, 0, 100).toFixed(1) + "%" }} /><b style={{ left: clamp((low / scale) * 100, 0, 100).toFixed(1) + "%" }} title={`${low} mm: pads low`} /></div>
                  </td>
                );
              })}
            </tr>
            <tr><td>Wear / lap</td>{pads.map((_, i) => { const w = wear(i); return <td className="n" key={i}>{w == null ? NONE : nf(w, 3)}</td>; })}</tr>
            <tr><td>Laps left</td>{pads.map((v, i) => { const w = wear(i); return <td className="n" key={i}>{w != null && w > 0.0005 ? nf(Math.max(0, (v - low) / w), 0) : NONE}</td>; })}</tr>
            <tr><td>Disc mm</td>{(a.brake_disc_mm as number[]).map((v, i) => <td className="n" key={i}>{nf(v, 1)}</td>)}</tr>
            <tr>
              <td>Temp {unit("temp", u).u}</td>
              {temps.map((t, i) => { const s = tstate(t, i); return <td className="n" key={i}><span className={stCls(s)}>{fv("temp", t, u)}{stateGlyph(s)}</span></td>; })}
            </tr>
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
  view({ ctx: c }) {
    const a = c.r!.car, s = c.r!.session;
    return {
      body: (
        <Kv className="cols2" rows={[
          ["Brake bias", a.brake_bias != null ? <>{nf(a.brake_bias, 1)}<span className="u"> %</span></> : NONE], ["TC", nf(a.tc_level, 0)], ["TC cut", nf(s.tc_cut, 0)], ["ABS", nf(a.abs_level, 0)],
          ["Engine map", nf(s.engine_map, 0)], ["Rain lights", a.rain_lights ? "on" : "off"], ["Lights", ["off", "low", "high"][a.lights_stage | 0] ?? NONE], ["Wiper", nf(a.wiper, 0)],
        ]} />
      ),
    };
  },
});

// ---------- damage & engine ----------
export const ZONES = ["Front", "Rear", "Left", "Right", "Centre"];

// A GT3 from above, nose up. Zones are rects clipped to the silhouette; the corners are the tyres (suspension damage).
const BODY = "M120 22C142 22 152 28 158 44C164 58 168 74 168 96C168 118 160 130 158 150C158 170 168 190 170 220C172 250 168 280 160 300C154 312 142 316 120 316C98 316 86 312 80 300C72 280 68 250 70 220C72 190 82 170 82 150C80 130 72 118 72 96C72 74 76 58 82 44C88 28 98 22 120 22Z";
const SPLIT = "M72 16Q120 6 168 16L164 26Q120 20 76 26Z", WING = "M60 316H180V332H60Z";

function Zone({ i, x, y, w, h, tx, ty, an, v }: { i: number; x: number; y: number; w: number; h: number; tx: number; ty: number; an: "middle" | "end" | "start"; v: number }) {
  return (
    <g className={v > 0 ? "s-bad" : undefined}>
      <rect className="dz" x={x} y={y} width={w} height={h} clipPath="url(#dm-clip)" style={{ fillOpacity: v > 0 ? +(0.3 + 0.5 * Math.min(v / 100, 1)).toFixed(2) : 0 }} />
      <text x={tx} y={ty} textAnchor={an}>{nf(v, 1)}</text><text className="cn" x={tx} y={ty + 12} textAnchor={an}>{ZONES[i]!.toUpperCase()}</text>
    </g>
  );
}

function Wheel({ i, x, y, h, tx, an, v }: { i: number; x: number; y: number; h: number; tx: number; an: "end" | "start"; v: number }) {
  return (
    <g className={v > 0 ? "s-bad" : undefined}>
      <rect className="dm-t" x={x} y={y} width="22" height={h} rx="6" />
      <rect className="dz" x={x} y={y} width="22" height={h} rx="6" style={{ fillOpacity: v > 0 ? +(0.3 + 0.5 * Math.min(v / 100, 1)).toFixed(2) : 0 }} />
      <text x={tx} y={y + h / 2 - 2} textAnchor={an}>{nf(v, 2)}</text><text className="cn" x={tx} y={y + h / 2 + 10} textAnchor={an}>{CORNERS[i]}</text>
    </g>
  );
}

function DamageCar({ dmg, sus, water, exhaust, ws }: { dmg: number[]; sus: number[]; water: ReactNode; exhaust: ReactNode; ws: State }) {
  void ws;
  return (
    <div className="dm-car">
      <svg viewBox="0 0 240 340" role="img" aria-label="Car damage by zone">
        <defs><clipPath id="dm-clip"><path d={BODY} /><path d={SPLIT} /><path d={WING} /></clipPath></defs>
        <Wheel i={0} x={56} y={62} h={46} tx={50} an="end" v={sus[0] || 0} /><Wheel i={1} x={162} y={62} h={46} tx={190} an="start" v={sus[1] || 0} />
        <Wheel i={2} x={56} y={222} h={52} tx={50} an="end" v={sus[2] || 0} /><Wheel i={3} x={162} y={222} h={52} tx={190} an="start" v={sus[3] || 0} />
        <path className="dm-b" d={BODY} /><path className="dm-b" d={SPLIT} /><path className="dm-b" d={WING} />
        <Zone i={0} x={0} y={0} w={240} h={125} tx={120} ty={98} an="middle" v={dmg[0] || 0} /><Zone i={1} x={0} y={214} w={240} h={126} tx={120} ty={262} an="middle" v={dmg[1] || 0} />
        <Zone i={2} x={0} y={125} w={98} h={89} tx={74} ty={170} an="end" v={dmg[2] || 0} /><Zone i={3} x={142} y={125} w={98} h={89} tx={166} ty={170} an="start" v={dmg[3] || 0} />
        <Zone i={4} x={98} y={125} w={44} h={89} tx={120} ty={174} an="middle" v={dmg[4] || 0} />
        <g className="dm-d">
          <path d="M102 130H138L144 156H96ZM98 156H142V196H98ZM98 196H142L137 214H103Z" />
          <path d="M98 54L114 62M142 54L126 62M120 30V70" /><path d="M92 37L106 32M148 37L134 32" /><path d="M90 306L106 308M150 306L134 308" />
          <path d="M78 56C74 70 74 90 78 106M162 56C166 70 166 90 162 106M74 226C76 250 74 272 80 292M166 226C164 250 166 272 160 292" />
          <ellipse cx="78" cy="134" rx="6" ry="3.5" /><ellipse cx="162" cy="134" rx="6" ry="3.5" /><path d="M60 316V332M180 316V332" />
        </g>
      </svg>
      <div className="dm-chips"><span><Icon name="droplets" />Water <b className="dm-w n">{water}</b></span><span><Icon name="flame" />Exhaust <b className="dm-x n">{exhaust}</b></span></div>
    </div>
  );
}

export const damage = defineModule({
  type: "damage", title: "Damage & engine", group: "Car", blurb: "Bodywork and suspension damage, water and exhaust temperature.",
  size: { w: 4, h: 6, minW: 3, minH: 5 }, needs: ["reading", "config", "units"], requires: ["reading"],
  options: [{ key: "view", label: "View", type: "select", choices: [["table", "Table"], ["car", "Car drawing"]], def: "table" }],
  view({ ctx: c, opts }) {
    const p = usePrefs(), u = p.units;
    const a = c.r!.car, dmg = ((a.damage as number[] | undefined) ?? []).slice(0, 5), sus = (a.suspension_damage as number[] | undefined) ?? [];
    const any = dmg.some((v) => v > 0) || sus.some((v) => v > 0), ws = waterState(a.water_temp_c, sc(c));
    const carView = opts.view === "car";
    const tu = unit("temp", u).u;
    const water = <><span className={stCls(ws)}>{fv("temp", a.water_temp_c, u)}{stateGlyph(ws)}</span><span className="u"> {tu}</span></>;
    const exhaust = <>{fv("temp", a.exhaust_temp_c, u)}<span className="u"> {tu}</span></>;
    return {
      alert: [any || ws === "bad" ? 2 : ws === "warn" ? 1 : 0],
      body: (
        <>
          <div className="dm-ok" hidden={carView && !any}>
            {any ? <span className="s-bad"><Icon name="octagon-alert" /><b>Damage</b> <span className="note">level (0 = none)</span></span> : <span className="s-ok"><Icon name="circle-check" /><b>No damage</b></span>}
          </div>
          {carView ? <DamageCar dmg={dmg} sus={sus} water={water} exhaust={exhaust} ws={ws} /> : (
            // No damage: only the engine rows, not nine zeros repeating the headline.
            <div className="dm-cols">
              <Kv className="dm-body" rows={[...(any ? ZONES.map((z, i): [ReactNode, ReactNode, string] => [z, nf(dmg[i], 1), dmg[i]! > 0 ? "s-bad" : ""]) : []), ["Water", <>{fv("temp", a.water_temp_c, u)}<span className="u"> {tu}</span>{stateGlyph(ws)}</>, stCls(ws)]]} />
              <Kv className="dm-sus" rows={[...(any ? CORNERS.map((z, i): [ReactNode, ReactNode, string] => [`Susp. ${z}`, nf(sus[i], 2), sus[i]! > 0 ? "s-bad" : ""]) : []), ["Exhaust", exhaust]]} />
            </div>
          )}
        </>
      ),
    };
  },
});

