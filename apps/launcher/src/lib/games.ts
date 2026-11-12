export interface GameState { installed: boolean; running: boolean; app?: "none" | "old" | "current"; csp?: boolean }
export interface Games { acc: GameState; ac: GameState; lmu: GameState }
export type Game = "acc" | "ac" | "lmu";
export type Choice = "auto" | Game;

// A game that is running wins; otherwise the only one installed; ACC when it is not clear
export function pickGame(g: Games | null, choice: Choice): Game {
  if (choice !== "auto") return choice;
  if (!g) return "acc";
  const games = ["acc", "ac", "lmu"] as const;
  const running = games.find((k) => g[k].running);
  if (running) return running;
  const installed = games.filter((k) => g[k].installed);
  return installed.length === 1 ? installed[0]! : "acc";
}

export function stateText(s: GameState): string {
  return s.running ? "running now" : s.installed ? "installed" : "not found";
}
