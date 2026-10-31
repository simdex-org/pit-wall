// A simulated pit page: the self-test, and --simulate-acc for trying the dashboard without the game.
// Keep it in step with applyPlan (it mirrors ACC's row layout).
import { Key, Mfd, MfdSnapshot } from "./mfd.js";
import { CORNERS } from "./plan.js";

export interface Layout { strategy: boolean; tyres: boolean; wet: boolean; brakes: boolean; driver: boolean }

export class FakeMfd implements Mfd {
  s: Layout;
  fuel = 12.0;
  set = 3;
  p = [27.5, 27.4, 27.3, 27.2];
  pads = [2, 3];
  repair = [true, true];
  cur = 0;
  strat = 0;
  presses = 0;

  constructor(layout: Partial<Layout> = {}) {
    this.s = { strategy: true, tyres: true, wet: false, brakes: false, driver: false, ...layout };
  }

  rows(): string[] {
    const s = this.s;
    let r = ["limiter", ...(s.strategy ? ["strategy"] : []), "fuel", "tyres"];
    if (s.tyres) r = [...r, ...(s.wet ? [] : ["set"]), "compound", "all", ...CORNERS];
    return [...r, "brakes", ...(s.brakes ? ["pad0", "pad1"] : []), ...(s.driver ? ["driver"] : []), "susp", "body"];
  }

  press(key: Key, n = 1): void {
    for (let k = 0; k < n; k++) {
      this.presses++;
      if (key === "close") continue; // leaves the pit page; where the cursor is does not matter until the page is opened again
      if (key === "pit") this.cur = 0;
      else if (key === "up" || key === "down") {
        const len = this.rows().length;
        this.cur = (((this.cur + (key === "down" ? 1 : -1)) % len) + len) % len;
      } else {
        const d = key === "right" ? 1 : -1, row = this.rows()[this.cur]!;
        const r1 = (x: number) => Math.round(x * 10) / 10;
        if (row === "fuel") this.fuel = Math.min(120.0, Math.max(0.0, this.fuel + d));
        else if (row === "set") this.set = Math.min(50, Math.max(1, this.set + d));
        else if (row === "compound") { this.s.wet = d > 0; this.cur = this.rows().indexOf("compound"); }
        else if (row === "all") this.p = this.p.map((x) => r1(x + d * 0.1));
        else if ((CORNERS as readonly string[]).includes(row)) { const i = CORNERS.indexOf(row as (typeof CORNERS)[number]); this.p[i] = r1(this.p[i]! + d * 0.1); }
        else if (row === "tyres" || row === "brakes") this.s[row] = !this.s[row];
        else if (row.startsWith("pad")) { const i = Number(row[3]); this.pads[i] = Math.min(4, Math.max(1, this.pads[i]! + d)); }
        else if (row === "susp" || row === "body") { const i = row === "body" ? 1 : 0; this.repair[i] = !this.repair[i]; }
        else if (row === "strategy") { // switching strategy loads that strategy's fuel and pressures
          this.strat ^= 1;
          [this.fuel, this.p] = this.strat ? [55.0, [27.0, 27.0, 27.0, 27.0]] : [30.0, [26.0, 26.0, 26.0, 26.0]];
        }
      }
    }
  }

  read(): MfdSnapshot {
    return { status: "live", fuel: this.fuel, tyre_set: this.set, pressures: [...this.p], current_set: 3, strategy_set: 2, in_pit_lane: false }; // set 3 on the car, as in FakePages
  }
}
