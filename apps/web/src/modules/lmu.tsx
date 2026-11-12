import { defineModule } from "../engine/registry";
import { NONE, nf } from "../lib/format";

const COMPOUND = ["Soft", "Medium", "Hard", "Wet"];
const CORNERS = ["FL", "FR", "RL", "RR"];
const pct = (v: number | null | undefined, d = 1) => (v != null && v > 0 ? nf(v * 100, d) + " %" : NONE);

export const lmuEnergy = defineModule({
  type: "lmu-energy", title: "Energy and tyres (LMU only)", group: "Car",
  blurb: "Only in Le Mans Ultimate: virtual energy left, its use per lap and the laps it lasts, the hybrid battery, and each tyre's compound and tread left.",
  size: { w: 4, h: 9, minW: 3, minH: 5, maxW: 6, maxH: 12 }, needs: ["reading"], requires: ["reading"], rate: 4,
  view({ ctx: c }) {
    const l = c.r!.lmu;
    if (c.r!.game !== "lmu" || !l) return { state: { kind: "empty", msg: "Only in Le Mans Ultimate. The car on track now is in another game." } };
    const ve = l.energy > 0 ? l.energy : null, per = l.per_lap > 0 ? l.per_lap : null;
    return {
      info: [String(l.class || "").toUpperCase()].filter(Boolean),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "var(--pad)" }}>
          <dl className="kv">
            <dt>Virtual energy</dt><dd className="n">{ve != null ? pct(ve) : "not on this car"}</dd>
            <dt>Last lap</dt><dd className="n">{pct(l.last_lap, 2)}</dd>
            <dt>Per lap, last 3</dt><dd className="n">{pct(per, 2)}</dd>
            <dt>Laps it lasts</dt><dd className="n">{ve != null && per ? nf(ve / per, 1) : NONE}</dd>
            <dt>Hybrid battery</dt><dd className="n">{pct(l.battery, 0)}</dd>
          </dl>
          {ve != null ? <div className="bar fuel" title="Virtual energy left"><i style={{ width: Math.min(100, ve * 100) + "%" }} /></div> : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {CORNERS.map((k, i) => (
              <div key={k} className="c" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span className="lab">{k} · {COMPOUND[l.compounds?.[i]] ?? NONE}{l.flat?.[i] ? " · FLAT" : ""}</span>
                <span className="mid">{pct(l.tread?.[i], 0)}</span>
                <div className="bar"><i style={{ width: Math.max(0, Math.min(100, (l.tread?.[i] ?? 0) * 100)) + "%" }} /></div>
              </div>
            ))}
          </div>
          <div className="note">Tread left on each tyre. Virtual energy is the game's per-stint allowance; per lap is counted at the line, laps after a refill are left out.</div>
        </div>
      ),
    };
  },
});
