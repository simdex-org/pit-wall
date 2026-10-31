import { useSyncExternalStore } from "react";
import { feed } from "./store";
import type { Payload } from "./types";

class Link {
  up = false;
  private es: EventSource | null = null;
  private subs = new Set<() => void>();

  get = (): boolean => this.up;

  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  };

  private set(up: boolean): void {
    if (up === this.up) return;
    this.up = up;
    for (const fn of this.subs) fn();
  }

  /** (Re)opens the stream at a rate of 5, 10, 15, 30 or 60 readings a second. */
  connect(hz: number): void {
    this.es?.close();
    const es = (this.es = new EventSource(`/events?hz=${hz}`));
    es.onmessage = (e) => {
      try { feed.receive(JSON.parse(e.data) as Payload); } catch { /* a broken frame is skipped */ }
    };
    es.onopen = () => this.set(true);
    es.onerror = () => this.set(false);
  }
}

export const link = new Link();
export const useLink = (): boolean => useSyncExternalStore(link.subscribe, link.get);
