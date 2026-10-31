import type { Channel } from "./types";

type AuxChannel = Extract<Channel, "sel" | "rec" | "tick" | "units" | "theme" | "resize">;

/**
 * Version counters for the channels that do not come from the bridge feed (selection, recordings, the one-second tick, units,
 * theme, resize). A module that needs one re-renders when its counter moves.
 */
class Aux {
  private v: Record<AuxChannel, number> = { sel: 0, rec: 0, tick: 0, units: 0, theme: 0, resize: 0 };
  private subs = new Set<() => void>();

  version = (c: AuxChannel): number => this.v[c];

  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  };

  bump(c: AuxChannel): void {
    this.v[c]++;
    for (const fn of this.subs) fn();
  }
}

export const aux = new Aux();
export const AUX_CHANNELS: readonly Channel[] = ["sel", "rec", "tick", "units", "theme", "resize"];
