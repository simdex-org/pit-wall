import { Rec } from "../util.js";
import { toMessages } from "./ac-plugin.js";
import type { BroadcastState, FieldSource, Sink } from "./client.js";

// Le Mans Ultimate's shared memory already holds every car; four times a second they become the messages ACC's
// broadcasting would have sent, the same way the Assetto Corsa app's packets do.
export class LmuField implements FieldSource {
  state: BroadcastState = { state: "waiting", msg: "Waiting for a session in Le Mans Ultimate", port: 0 };
  private timer: NodeJS.Timeout | null = null;

  constructor(private latest: () => Rec | null, private hint: () => Rec | null) {}

  start(sink: Sink): void {
    const seen = { track: "", ids: "", names: new Map<number, string>() };
    this.timer = setInterval(() => {
      const r = this.latest();
      if (!r || r.status < 2 || !r.cars?.length) {
        if (this.state.state === "live") Object.assign(this.state, { state: "waiting", msg: "Le Mans Ultimate is not in a session" });
        return;
      }
      Object.assign(this.state, { state: "live", msg: "Le Mans Ultimate shared memory" });
      for (const [kind, d] of toMessages({ track: r.track, config: "", cars: r.cars, t: r.lmu?.et ?? 0 }, this.hint(), seen)) sink(kind, d);
    }, 250);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
