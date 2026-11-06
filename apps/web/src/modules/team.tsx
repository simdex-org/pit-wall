import { useState } from "react";
import { defineModule } from "../engine/registry";
import { fmtClock, NONE } from "../lib/format";
import { useRacePlan } from "../state/racePlan";
import { driverOf, nameOf, swapAt, team, useTeam } from "../state/team";

const hm = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;

export const stintDrivers = defineModule({
  type: "stint-drivers", title: "Stint drivers", group: "Strategy",
  blurb: "Who is in the car, who is next and when. Stint rules, Fuel & stints, Pit stops and the pit page all follow the drivers set here.",
  size: { w: 4, h: 10, minW: 3, minH: 6, maxH: 16 }, needs: ["reading", "summary"],
  view({ ctx: c }) {
    const tm = useTeam(), rp = useRacePlan();
    const [edit, setEdit] = useState(false);
    const s = c.r?.session;
    const stint = ((c.s?.stops as unknown[] | undefined) ?? []).length + 1;
    const now = driverOf(tm, stint), swap = swapAt(tm, stint);
    const pace = (c.st?.my_pace_ms || c.st?.lap_ref_ms || 0) / 1000;
    const left = s && s.stint_time_left_ms >= 0 ? s.stint_time_left_ms : null;
    const maxMs = tm.maxStintMin ? tm.maxStintMin * 60000 : 0;
    const used = left != null && maxMs > 0 ? Math.max(0, Math.min(100, (1 - left / maxMs) * 100)) : null;
    const multi = tm.drivers > 1, editing = edit || !multi;
    const setNow = (d: number) => team.set({ first: (((d - Math.floor((stint - 1) / tm.spd)) % tm.drivers) + tm.drivers) % tm.drivers });
    const mine = (d: number) => (rp ? rp.stints.filter((t) => driverOf(tm, t.n) === d) : []);
    const stepper = (label: string, v: number, on: (n: number) => void) => (
      <div className="sd-tile"><span className="lab">{label}</span>
        <span className="stp"><button type="button" className="btn" aria-label={`Fewer: ${label}`} disabled={v <= 1} onClick={() => on(v - 1)}>−</button><b>{v}</b><button type="button" className="btn" aria-label={`More: ${label}`} disabled={v >= 10} onClick={() => on(v + 1)}>+</button></span></div>
    );

    if (editing) {
      return {
        flush: true,
        info: [multi ? `${tm.drivers} DRIVERS` : "SOLO"],
        body: (
          <div className="sd">
            <div className="sd-set">
              {stepper("Drivers", tm.drivers, (n) => team.set({ names: Array.from({ length: n }, (_, i) => tm.names[i] ?? "") }))}
              {multi ? stepper("Stints in a row", tm.spd, (n) => team.set({ spd: n })) : null}
              <label className="sd-tile" title="Longest time one driver may drive in a row. Fuel & stints plans around it. Empty = no limit.">
                <span className="lab">Max stint, min</span>
                <input className="inp" type="text" inputMode="numeric" autoComplete="off" placeholder="none" aria-label="Max stint in minutes" value={tm.maxStintMin ?? ""} onChange={(e) => team.set({ maxStintMin: parseInt(e.target.value.replace(/\D/g, ""), 10) || null })} />
              </label>
            </div>
            {multi ? (
              <>
                <div className="sd-sec"><span className="lab">Drivers · tap a number to put them in the car</span></div>
                <div className="sd-drvs">
                  {Array.from({ length: tm.drivers }, (_, d) => (
                    <div key={d} className={"sd-drv" + (d === now ? " cur" : "")}>
                      <button type="button" className="sd-pick" aria-pressed={d === now} aria-label={d === now ? `Driver ${d + 1} is in the car` : `Put driver ${d + 1} in the car`} title="Who is in the car now. Use it when the stops made so far do not match." onClick={() => setNow(d)}>{d + 1}</button>
                      <input className="inp" type="text" maxLength={20} placeholder={`Driver ${d + 1}`} aria-label={`Driver ${d + 1} name`} value={tm.names[d] ?? ""} onChange={(e) => team.set({ names: tm.names.map((x, i) => (i === d ? e.target.value : x)) })} />
                      {d === now ? <span className="tag">IN CAR</span> : null}
                    </div>
                  ))}
                </div>
              </>
            ) :<div className="sd-note">Driving solo. Add a second driver and the stops, stints and the pit page say who drives.</div>}
            {multi ? <div className="sd-foot"><button type="button" className="btn pr" onClick={() => setEdit(false)}>Done</button></div> : null}
          </div>
        ),
      };
    }

    const upcoming = rp ? rp.stints.filter((t) => t.n >= stint).slice(0, 5) : Array.from({ length: 4 }, (_, k) => ({ n: stint + k, from: 0, to: 0, laps: 0 }));
    const cur = rp?.stints.find((t) => t.n === stint);
    return {
      flush: true,
      info: [`${tm.drivers} DRIVERS`],
      body: (
        <div className="sd">
          <div className="sd-hero">
            <span className="lab">In the car</span>
            <div className="sd-name">{nameOf(tm, now)}</div>
            <div className="sd-meta"><span>Stint {stint}{cur ? ` · until lap ${cur.to}` : ""}</span>{left != null ? <span>{fmtClock(left)} left</span> : null}</div>
            {used != null ? <div className="bar tk ac"><i style={{ width: used + "%" }} /></div> : null}
          </div>
          <div className="sd-next"><span className="lab">Next</span><span>{swap ? `${nameOf(tm, swap.to)} takes over` : "Same driver, fuel only"}</span></div>
          <div className="sd-sec"><span className="lab">Coming up</span></div>
          {upcoming.map((t) => {
            const laps = t.laps;
            return (
              <div key={t.n} className={"sd-line" + (t.n === stint ? " cur" : "")}>
                <span>{t.n}</span><span>{nameOf(tm, driverOf(tm, t.n))}</span>
                <span>{rp ? `L${t.from}–${t.to}${pace > 0 ? ` · ${hm(laps * pace)}` : ""}` : NONE}</span>
              </div>
            );
          })}
          {!rp ? <div className="sd-note">Set a race plan in Fuel & stints to see laps and times.</div> : (
            <>
              <div className="sd-sec"><span className="lab">In the car, whole race</span></div>
              <div className="sd-tot">{Array.from({ length: tm.drivers }, (_, d) => <div key={d}><b>{nameOf(tm, d)}</b><span>{pace > 0 ? hm(mine(d).reduce((a, t) => a + t.laps, 0) * pace) : `${mine(d).length} stints`}</span></div>)}</div>
            </>
          )}
          <div className="sd-foot"><button type="button" className="btn" onClick={() => setEdit(true)}>Edit drivers</button></div>
        </div>
      ),
    };
  },
});
