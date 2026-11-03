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
  busy?: string;
}

export interface Mfd {
  read(): MfdSnapshot;
  press(key: Key, n?: number): void | Promise<void>;
  /** Resolves when the values read() returns have stopped changing after a key. */
  settle?(): Promise<void>;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
