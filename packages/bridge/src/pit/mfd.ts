import type { Plan } from "./plan.js";

export type Key = "pit" | "up" | "down" | "left" | "right" | "close";

export interface MfdSnapshot {
  status: string;
  fuel: number;
  tyre_set: number;
  pressures: number[];
  current_set: number;
  strategy_set: number;
  in_pit_lane: boolean;
  busy?: string;
}

export interface Mfd {
  read(): MfdSnapshot;
  press(key: Key, n?: number): void | Promise<void>;
  settle?(): Promise<void>;
  // a game whose pit menu is set directly, without key presses (Le Mans Ultimate)
  apply?(plan: Plan): Promise<Record<string, string>>;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
