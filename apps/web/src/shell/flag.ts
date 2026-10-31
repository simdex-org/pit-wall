import type { Ctx } from "../feed/store";

const FLAGS = ["none", "blue", "yellow", "black", "white", "chequered", "penalty", "green", "orange"];

export type FlagName = "chequered" | "red" | "black" | "penalty" | "blue" | "yellow" | "orange" | "white" | "green";

/**
 * The flag out, for the Flag cell, which takes its colour: the driver's flag first, then the track's. Chequered stays latched until
 * the session ends or the game drops; green only announces a start or restart, for five seconds.
 */
export class FlagTracker {
  private chequeredKey: string | null = null;
  private greenSince = 0;

  now(c: Ctx, clock = performance.now()): FlagName | null {
    const r = c.r;
    if (!r || !c.stale || r.session.status === "Off") { this.chequeredKey = null; return null; }
    const s = r.session, g = s.global_flags ?? {}, f = FLAGS[s.flag], key = `${s.session_index}/${s.kind}`;
    if (this.chequeredKey && this.chequeredKey !== key) this.chequeredKey = null; // a new session
    if (f === "chequered" || g.chequered) this.chequeredKey = key;
    if (this.chequeredKey) return "chequered";
    if (g.red) return "red";
    if (f === "black" || f === "penalty") return f;
    if (f === "blue") return "blue";
    if (f === "yellow" || g.yellow || g.y1 || g.y2 || g.y3) return "yellow";
    if (f === "orange") return "orange";
    if (f === "white" || g.white) return "white";
    if (f === "green" || g.green) {
      this.greenSince = this.greenSince || clock;
      return clock - this.greenSince < 5000 ? "green" : null;
    }
    this.greenSince = 0;
    return null;
  }
}
