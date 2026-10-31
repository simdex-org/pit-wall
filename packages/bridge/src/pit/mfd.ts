// What the page driver needs from an MFD, real or simulated.
export type Key = "pit" | "up" | "down" | "left" | "right" | "close";

export interface MfdSnapshot {
  status: string;
  fuel: number;
  tyre_set: number;
  pressures: number[];
  current_set: number;
  strategy_set: number;
  in_pit_lane: boolean;
  waiting_lift?: boolean;
  busy?: string;
}

export interface Mfd {
  read(): MfdSnapshot;
  press(key: Key, n?: number): void | Promise<void>;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
