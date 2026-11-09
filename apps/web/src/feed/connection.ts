import { useSyncExternalStore } from "react";
import { accessKey } from "../state/bridge";
import { feed } from "./store";
import type { Payload } from "./types";

// How the bridge answered the access key: none sent, accepted, wrong, or too many wrong tries for now
export type Auth = "none" | "ok" | "wrong" | "blocked" | "unknown";

class Link {
  up = false;
  auth: Auth = "unknown";
  private rejected = "";
  private es: EventSource | null = null;
  private token: object = {};
  private subs = new Set<() => void>();

  get = (): boolean => this.up;
  getAuth = (): Auth => this.auth;

  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  };

  private set(up: boolean): void {
    if (up === this.up) return;
    this.up = up;
    for (const fn of this.subs) fn();
  }

  private setAuth(a: Auth): void {
    if (a === this.auth) return;
    this.auth = a;
    for (const fn of this.subs) fn();
  }

  // Each wrong key counts against this address on the bridge, so a key it refused is not sent again until it changes
  private async signIn(): Promise<void> {
    const key = accessKey.value;
    if (!key) return this.setAuth("none");
    if (key === this.rejected) return;
    try {
      const r = await fetch("/auth", { method: "POST", headers: { "X-Pit-Key": key } });
      if (r.status === 403) this.rejected = key;
      this.setAuth(r.ok ? "ok" : r.status === 403 ? "wrong" : r.status === 429 ? "blocked" : "unknown");
    } catch {  }
  }

  connect(hz: number): void {
    this.es?.close();
    const token = (this.token = {});
    void this.signIn().then(() => { if (token === this.token) this.open(hz); });
  }

  private open(hz: number): void {
    const es = (this.es = new EventSource(`/events?hz=${hz}`));
    es.onmessage = (e) => {
      try { feed.receive(JSON.parse(e.data) as Payload); } catch {  }
    };
    es.onopen = () => this.set(true);
    es.onerror = () => {
      this.set(false);
      if (es.readyState === EventSource.CLOSED) setTimeout(() => { if (this.es === es) this.connect(hz); }, 3000);
    };
  }
}

export const link = new Link();
export const useLink = (): boolean => useSyncExternalStore(link.subscribe, link.get);
export const useAuth = (): Auth => useSyncExternalStore(link.subscribe, link.getAuth);
