import { CSSProperties, ReactNode, useId, useRef, useState } from "react";
import { defineModule } from "../engine/registry";
import { Icon } from "../lib/icons";
import { GRIP, RAIN } from "../lib/enums";
import { MINUS, nf, NONE } from "../lib/format";
import { fv, unit } from "../lib/units";
import { useSize } from "../lib/useSize";
import { usePrefs } from "../state/prefs";
import { slopePerMin, wxSample, WxSample } from "../state/wxlog";

const HEAD = 62 + 28, CHART_MIN = 96, STRIP = 44;
const SHORT = ["Dry", "Drizzle", "Light", "Medium", "Heavy", "Storm"];
const PAST_MIN = 10;
const KEEP_MIN = 30;
const AHEAD_MIN = 30;
// Matches the bridge's rain_coming advice: wets are worth a thought from Medium rain.
const WETS_LEVEL = 3;
export const compass = (d: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((((d % 360) + 360) % 360) / 45) % 8]!;
export const tone = (l: number) => (l >= WETS_LEVEL ? "wn" : l ? "cd" : "");

/** What the rain forecast says in words: a headline, a short sub line, the colour class and the icon that go with it. */
export function forecast(rain: number[], clouds: number | null) {
  const lv = (i: number) => Math.min(5, Math.max(0, (rain[i] ?? 0) | 0));
  const worst = Math.max(lv(1), lv(2));
  const [text, cls, sub]: [string, string, string] = worst > lv(0) ? [`${RAIN[worst]} in ${lv(1) === worst ? 10 : 30} min`, "wn", "Getting wetter"]
    : worst < lv(0) ? [`Clearing to ${RAIN[worst]!.toLowerCase()} in ${lv(1) < lv(0) ? 10 : 30} min`, "dn", "Getting drier"]
    : lv(0) === 0 ? ["Dry for 30 min", "dn", "No rain forecast"] : [`${RAIN[lv(0)]} for 30 min`, tone(lv(0)), "No change forecast"];
  const icon = worst >= 5 || lv(0) >= 5 ? "cloud-lightning" : worst >= 2 || lv(0) >= 2 ? "cloud-rain" : worst >= 1 || lv(0) >= 1 ? "cloud-drizzle" : (clouds ?? 0) >= 70 ? "cloud" : "sun";
  return { lv, text, cls, sub, icon };
}
const stroke = (l: number) => (l >= WETS_LEVEL ? "var(--warn)" : l ? "var(--cold)" : "var(--t2)");

/** Rain level over the last 10 minutes (solid), then ACC's two forecast points at +10 and +30 min (hatched). Levels, not chances: ACC sends no probability. */
function RainChart({ log, now, fc, w, h }: { log: WxSample[]; now: number; fc: [number, number]; w: number; h: number }) {
  const hatch = useId();
  const L = 58, R = 14, T = 26, B = 24, pw = w - L - R, ph = h - T - B;
  const x = (min: number) => L + ((min + PAST_MIN) / (PAST_MIN + AHEAD_MIN)) * pw;
  const y = (lv: number) => T + ph - (lv / 5) * ph;
  const recent = log.filter((s) => now - s.t <= PAST_MIN * 60000);
  const lvNow = log.length ? log[log.length - 1]!.rain : 0;
  const past = recent.map((s) => `${x((s.t - now) / 60000).toFixed(1)},${y(s.rain).toFixed(1)}`).join(" ");
  const pts: [number, number, string][] = [[0, lvNow, "middle"], [10, fc[0], "middle"], [30, fc[1], "end"]];
  const line = pts.map(([m, l]) => `${x(m).toFixed(1)},${y(l).toFixed(1)}`).join(" ");
  const label = (l: number, m: number) => (l >= 4 && m === 30 ? y(l) + 16 : y(l) - 9);
  return (
    <svg width={w} height={h} style={{ display: "block" }} role="img" aria-label={`Rain level: ${SHORT[lvNow]} now, ${SHORT[fc[0]]} in 10 minutes, ${SHORT[fc[1]]} in 30 minutes`}>
      <defs>
        <pattern id={hatch} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1={0} y1={0} x2={0} y2={6} stroke="var(--cold)" strokeWidth={1.5} opacity={0.5} /></pattern>
      </defs>
      <rect x={x(0)} y={T} width={x(AHEAD_MIN) - x(0)} height={ph} fill="var(--p2)" opacity={0.5} />
      {SHORT.map((n, l) => (
        <g key={l}>
          <line x1={L} x2={w - R} y1={y(l)} y2={y(l)} stroke={l === 0 ? "var(--ln2)" : "var(--ln)"} strokeWidth={1} />
          <text x={L - 8} y={y(l) + 3.5} textAnchor="end" fontSize={10} fill={l === WETS_LEVEL ? "var(--warn)" : "var(--t3)"}>{n}</text>
        </g>
      ))}
      <line x1={L} x2={w - R} y1={y(WETS_LEVEL)} y2={y(WETS_LEVEL)} stroke="var(--warn)" strokeWidth={1} strokeDasharray="2 4" />
      <text x={L + 6} y={y(WETS_LEVEL) - 5} fontSize={9.5} fill="var(--warn)">Wets from here</text>
      {[-10, -5, 0, 10, 20, 30].map((m) => (
        <text key={m} x={x(m)} y={h - 7} textAnchor="middle" fontSize={10} fill={m === 0 ? "var(--tx)" : "var(--t3)"}>{m === 0 ? "Now" : (m > 0 ? "+" : MINUS) + Math.abs(m) + " min"}</text>
      ))}
      <polygon points={`${x(0)},${y(0)} ${line} ${x(30)},${y(0)}`} fill={`url(#${hatch})`} />
      {recent.length > 1 ? <>
        <polygon points={`${x((recent[0]!.t - now) / 60000)},${y(0)} ${past} ${x(0)},${y(0)}`} fill="var(--t2)" opacity={0.18} />
        <polyline points={past} fill="none" stroke="var(--t2)" strokeWidth={1.75} />
      </> : null}
      <polyline points={line} fill="none" stroke="var(--cold)" strokeWidth={1.75} strokeDasharray="5 4" />
      <line x1={x(0)} x2={x(0)} y1={T - 10} y2={T + ph} stroke="var(--tx)" strokeWidth={1} />
      {pts.map(([m, l, a]) => (
        <g key={m}>
          <rect x={x(m) - 4} y={y(l) - 4} width={8} height={8} fill={stroke(l)} stroke="var(--mbg)" strokeWidth={1.5} />
          <text x={x(m)} y={label(l, m)} textAnchor={a as "middle" | "end"} fontSize={11} fontWeight={600} fill={l >= WETS_LEVEL ? "var(--warn)" : "var(--tx)"}>{SHORT[l]}</text>
        </g>
      ))}
    </svg>
  );
}

const STEPS = [0.5, 1, 2, 5, 10, 20];

/** Track or air temperature over the last 30 minutes. The range never gets tighter than 4 degrees, so a steady value reads as steady. */
function TempChart({ log, now, k, f, tu, color, w, h }: { log: WxSample[]; now: number; k: "track" | "air"; f: (v: number) => number; tu: string; color: string; w: number; h: number }) {
  const L = 52, R = 56, T = 14, B = 24, pw = w - L - R, ph = h - T - B;
  const vals = log.map((s) => f(s[k]));
  const lo = Math.min(...vals), hi = Math.max(...vals), mid = (lo + hi) / 2, span = Math.max(hi - lo, 4) * 1.2;
  const step = STEPS.find((s) => span / s <= 5) ?? 20;
  const y0 = Math.floor((mid - span / 2) / step) * step, y1 = Math.ceil((mid + span / 2) / step) * step;
  const x = (min: number) => L + ((min + KEEP_MIN) / KEEP_MIN) * pw;
  const y = (v: number) => T + ph - ((v - y0) / (y1 - y0)) * ph;
  const ticks: number[] = [];
  for (let v = y0; v <= y1 + 1e-9; v += step) ticks.push(v);
  const pts = log.map((s) => [x((s.t - now) / 60000), y(f(s[k]))] as const);
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} style={{ display: "block" }} role="img" aria-label={`${k === "track" ? "Track" : "Air"} temperature, last 30 minutes`}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={w - R} y1={y(v)} y2={y(v)} stroke="var(--ln)" strokeWidth={1} />
          <text x={L - 8} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--t3)">{Number.isInteger(v) ? v : v.toFixed(1)}{tu}</text>
        </g>
      ))}
      {[-30, -20, -10, 0].map((m) => (
        <text key={m} x={x(m)} y={h - 7} textAnchor={m === -30 ? "start" : m === 0 ? "end" : "middle"} fontSize={10} fill={m === 0 ? "var(--tx)" : "var(--t3)"}>{m === 0 ? "Now" : MINUS + Math.abs(m) + " min"}</text>
      ))}
      <line x1={x(0)} x2={x(0)} y1={T - 6} y2={T + ph} stroke="var(--tx)" strokeWidth={1} />
      {pts.length > 1 ? <polyline points={pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ")} fill="none" stroke={color} strokeWidth={2} /> : null}
      {last ? <>
        <rect x={last[0] - 4} y={last[1] - 4} width={8} height={8} fill={color} stroke="var(--mbg)" strokeWidth={1.5} />
        <text x={last[0] + 10} y={last[1] + 4} fontSize={12} fontWeight={600} fill={color}>{Math.round(vals[vals.length - 1]!)}{tu}</text>
      </> : null}
    </svg>
  );
}

/** The arrow points where the wind blows to; the text beside it says where it comes from. */
function Wind({ dir, ms }: { dir: number; ms: number | null }) {
  const a = ((dir + 180) * Math.PI) / 180, c = 40, r = 26;
  const at = (k: number, ang: number): [number, number] => [c + Math.sin(ang) * k, c - Math.cos(ang) * k];
  const tip = at(r, a), tail = at(-r * 0.6, a), l = at(r - 9, a - 0.45), rt = at(r - 9, a + 0.45);
  return (
    <svg width={80} height={80} role="img" aria-label={`Wind from ${compass(dir)}`}>
      <circle cx={c} cy={c} r={r + 8} fill="none" stroke="var(--ln)" />
      {["N", "E", "S", "W"].map((n, i) => { const [tx, ty] = at(r + 8, (i * Math.PI) / 2); return <text key={n} x={tx} y={ty + 3.5} textAnchor="middle" fontSize={9} fill="var(--t3)" stroke="var(--mbg)" strokeWidth={4} paintOrder="stroke">{n}</text>; })}
      {ms != null ? <>
        <line x1={tail[0]} y1={tail[1]} x2={tip[0]} y2={tip[1]} stroke="var(--tx)" strokeWidth={2} />
        <polygon points={`${tip[0]},${tip[1]} ${l[0]},${l[1]} ${rt[0]},${rt[1]}`} fill="var(--tx)" />
      </> : null}
    </svg>
  );
}

/** Gives its child the size of the box it fills; it measures itself, so it works when it mounts later. */
function Fit({ style, children }: { style?: CSSProperties; children: (w: number, h: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  return <div ref={ref} style={{ position: "relative", ...style }}>{w > 0 ? <div style={{ position: "absolute", inset: 0 }}>{children(w, h)}</div> : null}</div>;
}

const Trend = ({ v, unitText, d = 1 }: { v: number | null; unitText: string; d?: number }) =>
  v == null || Math.abs(v) < 0.05 ? <span className="v mu">steady</span> : <span className={"v " + (v > 0 ? "up" : "dn")}>{v > 0 ? "▲" : "▼"} {Math.abs(v).toFixed(d)} {unitText}</span>;

/** A named percentage with a bar. */
const Meter = ({ lab, pct, note }: { lab: string; pct: number | null; note: ReactNode }) => (
  <div className="wx-m">
    <div className="fb"><span className="lab">{lab}</span><span className="mid">{pct != null ? nf(pct, 0) : NONE}<span className="u">%</span></span></div>
    <div className="bar" role="meter" aria-label={lab} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}><i style={{ width: (pct ?? 0) + "%" }} /></div>
    <span className="v mu">{note}</span>
  </div>
);

export const weatherCenter = defineModule({
  type: "weather-center", title: "Weather", group: "Strategy",
  blurb: "Rain forecast chart, track wetness and clouds, grip, temperature trends and wind.",
  options: [{ key: "chart", label: "Chart", type: "select", choices: [["rain", "Rain forecast"], ["track", "Track temperature"], ["air", "Air temperature"]], def: "rain" }],
  size: { w: 8, h: 14, minW: 4, minH: 8 }, needs: ["reading", "field", "tick"], requires: ["reading"],
  view({ ctx: c, opts }) {
    const p = usePrefs();
    const root = useRef<HTMLDivElement>(null);
    const rb = useSize(root);
    const [shown, setShown] = useState<string | null>(null);
    const which = shown ?? (opts.chart === "track" || opts.chart === "air" ? opts.chart : "rain");
    const s = c.r!.session, car = c.r!.car, wx = c.field?.weather ?? null;
    const wet = wx?.wet != null ? wx.wet * 100 : null, clouds = wx?.clouds != null ? wx.clouds * 100 : null;
    const rain = Array.isArray(s.rain) ? (s.rain as number[]) : [];
    const { lv, text, cls, sub, icon } = forecast(rain, clouds);
    const t = Date.now();
    const wind = s.wind_speed_kmh != null ? s.wind_speed_kmh / 3.6 : null;
    const log = wxSample({ t, rain: lv(0), wet, clouds, track: car.road_temp_c, air: car.air_temp_c, wind });
    const tu = unit("temp", p.units).u, deg = tu === "°F" ? 1.8 : 1;
    const f = (v: number) => (tu === "°F" ? v * 1.8 + 32 : v);
    const grip = s.track_grip | 0, gripName = GRIP[grip] ?? NONE;
    const per = (pick: (x: WxSample) => number | null, k = 1) => { const v = slopePerMin(log, pick); return v == null ? null : v * k; };
    const gripTone = grip >= 3 ? (grip >= 5 ? "wn" : "cd") : "";
    const W = rb.w, H = rb.h, two = W >= 560 && H >= 230;
    const cols = !two && W >= 420 ? 2 : 1;
    const rem = two ? H : H - HEAD - CHART_MIN;
    const showNote = two ? H >= 330 : false;
    const budget = (two ? H : rem) * cols;
    const range = (pick: (x: WxSample) => number) => {
      const v = log.map((x) => f(pick(x)));
      const lo = Math.round(Math.min(...v)), hi = Math.round(Math.max(...v));
      return lo === hi ? null : `${lo} to ${hi}${tu}`;
    };
    const temp = () => (
      <div className="wx-sec" key="temp">
        <div className="wx-temp">
          {([["Track", "wn", car.road_temp_c, (x: WxSample) => x.track], ["Air", "cd", car.air_temp_c, (x: WxSample) => x.air]] as const).map(([name, tcls, v, pick]) => (
            <div key={name} className="fc" style={{ gap: 5 }}>
              <span className="lab">{name}</span>
              <span className={"big " + tcls}>{fv("temp", v, p.units, 0)}<span className="u">{tu}</span></span>
              <Trend v={per(pick, deg)} unitText={tu + "/min"} />
              {range(pick) ? <span className="v di">30 min: {range(pick)}</span> : null}
            </div>
          ))}
        </div>
      </div>
    );
    const sections: Record<string, [number, ReactNode]> = {
      cond: [124, <div className="wx-sec" key="cond">
        <Meter lab="Track wetness" pct={wet} note={wet != null ? (wet < 5 ? "dry surface" : wet < 40 ? "damp patches" : wet < 75 ? "wet" : "soaked") : "needs field timing"} />
        <Meter lab="Cloud cover" pct={clouds} note={clouds != null ? (clouds < 30 ? "clear" : clouds < 70 ? "broken" : "overcast") : "needs field timing"} />
      </div>],
      temp: [104, temp()],
      wind: [104, <div className="wx-sec" key="wind">
        <span className="lab">Wind</span>
        <div className="wx-wind">
          <Wind dir={s.wind_direction_deg || 0} ms={wind} />
          <div className="fc">
            <span className="mid">{wind != null ? nf(wind, 1) : NONE}<span className="u">m/s</span></span>
            <span className="v mu">from {compass(s.wind_direction_deg || 0)} {nf(s.wind_direction_deg, 0)}°</span>
          </div>
        </div>
      </div>],
      grip: [66, <div className="wx-sec" key="grip">
        <div className="fb"><span className="lab">Grip</span><span className={"mid " + gripTone}>{gripName}</span></div>
        <div className="wx-scale" aria-hidden>{GRIP.map((n, i) => <i key={n} className={i === grip ? "on " + gripTone : ""} />)}</div>
        <div className="wx-names" aria-hidden>{GRIP.map((n, i) => <span key={n} className={i === grip ? "on" : ""}>{n}</span>)}</div>
      </div>],
    };
    // Most useful first; each section is kept only while the module still has the height for it. Display order is fixed.
    let used = 0;
    const keep = new Set<string>();
    for (const id of ["cond", "temp", "wind", "grip"]) {
      const need = sections[id]![0];
      if (used + need <= budget) { used += need; keep.add(id); }
    }
    const strip = !keep.size;
    const hideChart = H > 0 && H - HEAD < CHART_MIN + STRIP;
    return {
      alert: [lv(1) >= WETS_LEVEL && !c.wet ? 1 : 0],
      info: [`GRIP ${String(gripName).toUpperCase()}`, RAIN[lv(0)] ?? NONE],
      flush: true,
      body: (
        <div ref={root} className={"wx" + (two ? "" : " n")} style={{ "--cols": cols } as CSSProperties}>
          <div className="wx-main">
            <div className="wx-head">
              <span className={cls}><Icon name={icon} size={W < 300 ? 24 : 34} /></span>
              <div style={{ minWidth: 0 }}>
                <div className={"hl " + cls}>{text}</div>
                <div className="sub v">{sub} · now {RAIN[lv(0)]!.toLowerCase()}</div>
              </div>
              {W >= 300 ? <div className="tags"><span className={"tag" + (c.wet ? " wn" : " n")}>{c.wet ? "Wets" : "Slicks"}</span></div> : null}
            </div>
            {hideChart ? null : (
              <div className="wx-tabs" role="group" aria-label="Chart">
                {([["rain", "Rain"], ["track", "Track"], ["air", "Air"]] as const).map(([id, name]) => (
                  <button key={id} type="button" aria-pressed={which === id} onClick={() => setShown(id)}>{name}</button>
                ))}
              </div>
            )}
            {hideChart ? null : (
              <Fit style={{ flex: 1, minHeight: CHART_MIN }}>{(w, h) => which === "rain"
                ? <RainChart log={log} now={t} fc={[lv(1), lv(2)]} w={w} h={h} />
                : <TempChart log={log} now={t} k={which as "track" | "air"} f={f} tu={tu} color={which === "track" ? "var(--warn)" : "var(--cold)"} w={w} h={h} />}</Fit>
            )}
            {strip || hideChart ? (
              <div className="wx-strip">
                {wet != null ? <span><i>Wet</i> {nf(wet, 0)}%</span> : null}
                {clouds != null ? <span><i>Cloud</i> {nf(clouds, 0)}%</span> : null}
                <span><i>Track</i> {fv("temp", car.road_temp_c, p.units, 0)}{tu}</span>
                <span><i>Air</i> {fv("temp", car.air_temp_c, p.units, 0)}{tu}</span>
                <span><i>Wind</i> {wind != null ? nf(wind, 1) : NONE} m/s {compass(s.wind_direction_deg || 0)}</span>
                <span><i>Grip</i> {gripName}</span>
              </div>
            ) : null}
            {showNote ? <div className="wx-note">{which === "rain" ? "Solid line: recorded while this page is open. Hatched: ACC's forecast at +10 and +30 min. ACC sends levels, not chances." : "Recorded while this page is open. ACC sends no temperature forecast."}</div> : null}
          </div>
          {keep.size && !hideChart ? <div className="wx-side">{["cond", "temp", "wind", "grip"].filter((id) => keep.has(id)).map((id) => sections[id]![1])}</div> : null}
        </div>
      ),
    };
  },
});
