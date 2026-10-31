import { invoke } from "@tauri-apps/api/core";

const tool = (args: string[]) => invoke<string>("bridge_tool", { args });

export type UpdateCheck = { available: boolean; installed: string | null; latest: string | null };

export async function checkForUpdate(): Promise<UpdateCheck> {
  return JSON.parse(await tool(["--update-check"]));
}

export const installUpdate = () => tool(["--update"]);
