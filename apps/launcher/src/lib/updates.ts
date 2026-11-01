import { invoke } from "@tauri-apps/api/core";

const tool = (args: string[]) => invoke<string>("bridge_tool", { args });

export type UpdateCheck = { available: boolean; installedVersion: string | null; latestVersion: string | null };

export async function checkForUpdate(): Promise<UpdateCheck> {
  return JSON.parse(await tool(["--update-check"]));
}

/** Downloads the new installer or exe, then the launcher closes and runs it. */
export async function installUpdate(): Promise<void> {
  const { file } = JSON.parse(await tool(["--update"])) as { file: string };
  await invoke("apply_update", { file });
}
