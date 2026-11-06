export interface GameState { installed: boolean; running: boolean; app?: "none" | "old" | "current"; csp?: boolean }
export interface Games { acc: GameState; ac: GameState }
export type Choice = "auto" | "acc" | "ac";

// A game that is running wins; otherwise the only one installed; ACC when it is not clear
export function pickGame(g: Games | null, choice: Choice): "acc" | "ac" {
  if (choice !== "auto") return choice;
  if (!g) return "acc";
  if (g.acc.running) return "acc";
  if (g.ac.running) return "ac";
  return g.ac.installed && !g.acc.installed ? "ac" : "acc";
}

export function stateText(s: GameState): string {
  return s.running ? "running now" : s.installed ? "installed" : "not found";
}
