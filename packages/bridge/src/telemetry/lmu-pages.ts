import { openExisting } from "../win/shm.js";
import { Rec } from "../util.js";
import { decodeLmu, EnergyLaps, LMU_SIZE } from "./lmu-decode.js";
import type { Pages } from "./pages.js";

export class LmuPages implements Pages {
  private m = openExisting("LMU_Data", LMU_SIZE);
  private energy = new EnergyLaps();
  private index = 0;
  private last0 = { session: -2, laps: 0 };
  last: Rec | null = null;

  read(): Rec {
    const b = this.m();
    // no mapping yet: the game is closed, or its Enable Plugins switch is off
    if (!b) return (this.last = { status: 0 });
    const r = decodeLmu(b);
    // no session counter in the game: a new session type, or the lap count going back down, is a new session
    if (r.status === 2 && (r.session !== this.last0.session || r.laps < this.last0.laps)) {
      if (this.last0.session !== -2) this.index++;
    }
    if (r.status === 2) this.last0 = { session: r.session, laps: r.laps };
    r.session_index = this.index;
    this.energy.apply(r);
    return (this.last = r);
  }
}
