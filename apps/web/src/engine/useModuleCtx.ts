import { useEffect, useRef, useState } from "react";
import type { Ctx } from "../feed/store";
import { feed } from "../feed/store";
import { aux } from "./versions";
import type { Channel, ModuleDef } from "./types";

type AuxCh = "sel" | "rec" | "tick" | "units" | "theme" | "resize";

const FEED: Partial<Record<Channel, (c: Ctx) => unknown[]>> = {
  reading: (c) => [c.r, c.ages.r, c.live, c.stale, c.wet, c.from],
  summary: (c) => [c.s, c.st, c.ages.s],
  field: (c) => [c.field, c.cars, c.me, c.mode, c.bc, c.ages.field],
  entries: (c) => [c.entries],
  laps: (c) => [c.laps, c.past, c.view],
  config: (c) => [c.cfg, c.th],
  pit: (c) => [c.pit, c.pitJob, c.pitLog],
  focus: (c) => [c.focus, c.focusCar],
  log: (c) => [c.log],
};

const AUX = new Set<Channel>(["sel", "rec", "tick", "units", "theme", "resize"]);

/** Everything a module reads, as one flat list that changes identity-wise exactly when the module has something new to draw. */
function signature(channels: Channel[], c: Ctx): unknown[] {
  const out: unknown[] = [];
  for (const ch of channels) {
    if (AUX.has(ch)) out.push(aux.version(ch as AuxCh));
    else out.push(...(FEED[ch]?.(c) ?? []));
  }
  return out;
}

const same = (a: unknown[], b: unknown[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The context a module draws from: the latest one, handed over only when a channel the module needs (or waits for) changed,
 * and never faster than the module's own rate. This is the page's whole render scheduler.
 */
export function useModuleCtx(def: ModuleDef): Ctx {
  const [ctx, setCtx] = useState<Ctx>(feed.get);
  const channels = useRef<Channel[]>([]);
  channels.current = [...new Set([...def.needs, ...def.requires])];
  const seen = useRef<{ sig: unknown[]; at: number }>({ sig: signature(channels.current, ctx), at: performance.now() });

  useEffect(() => {
    let timer = 0;
    const check = () => {
      const c = feed.get();
      const sig = signature(channels.current, c);
      if (same(sig, seen.current.sig)) return;
      const wait = 1000 / def.rate - (performance.now() - seen.current.at);
      if (wait > 0) {
        if (!timer) timer = window.setTimeout(() => { timer = 0; check(); }, Math.ceil(wait));
        return;
      }
      seen.current = { sig, at: performance.now() };
      setCtx(c);
    };
    const offFeed = feed.subscribe(check), offAux = aux.subscribe(check);
    check();
    return () => { offFeed(); offAux(); clearTimeout(timer); };
  }, [def]);

  return ctx;
}
