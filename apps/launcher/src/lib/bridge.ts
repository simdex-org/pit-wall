import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { Games } from "./games";

export interface BridgeInfo {
  addresses: string[];
  broadcastPort: number;
}

export const start = (args: string[]) => invoke<void>("bridge_start", { args });
export const stop = () => invoke<void>("bridge_stop");
export const quit = () => invoke<void>("quit_app");
const tool = (args: string[]) => invoke<string>("bridge_tool", { args });

export async function info(): Promise<BridgeInfo> {
  return JSON.parse(await tool(["--info"]));
}

export async function games(): Promise<Games> {
  return JSON.parse(await tool(["--games"]));
}

export const installAcApp = () => tool(["--install-ac-app"]);

export const enableFieldTiming = () => tool(["--enable-broadcast"]);

export function onLine(fn: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>("bridge-line", (e) => fn(e.payload));
}

export function onExit(fn: (code: number) => void): Promise<UnlistenFn> {
  return listen<number>("bridge-exit", (e) => fn(e.payload));
}

export function onCloseRequested(fn: () => void): Promise<UnlistenFn> {
  return listen("close-requested", fn);
}
